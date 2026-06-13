import { spawn } from "node:child_process";
import type { LlmToolSpec } from "../llm.js";

export const SHELL_RUN_TOOL = "run_command";

/**
 * Command-execution tool handed to worker sub-agents so they can run real
 * commands (build / test / lint) inside the worktree and react to the output —
 * the feedback loop that lets an agent fix its own mistakes.
 *
 * Execution is gated by an `isAllowed` predicate (default: deny everything) so
 * the tool honours RepoHelm's command allowlist instead of running anything.
 */
export const shellToolSpec: LlmToolSpec = {
  type: "function",
  function: {
    name: SHELL_RUN_TOOL,
    description:
      "Run a shell command inside the project worktree (e.g. run tests or a build) and read its stdout, stderr and exit code. Use this to verify your changes and fix failures. Only allowlisted commands are permitted.",
    parameters: {
      type: "object",
      required: ["command"],
      additionalProperties: false,
      properties: {
        command: {
          type: "string",
          description: "The shell command to run, e.g. \"pnpm test\" or \"npm run build\"."
        }
      }
    }
  }
};

export interface ShellToolOptions {
  /** Returns true if the command may run. Defaults to deny-all. */
  isAllowed?: (command: string) => boolean;
  timeoutMs?: number;
  /** Max bytes of stdout/stderr to keep in the tool result. */
  maxOutputBytes?: number;
}

export interface ShellToolHandler {
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT = 16_000;

/** Build a command-execution handler confined to `root` (a worktree directory). */
export function buildShellToolHandler(root: string, options: ShellToolOptions = {}): ShellToolHandler {
  const isAllowed = options.isAllowed ?? (() => false);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return {
    async handle(name, args) {
      if (name !== SHELL_RUN_TOOL) {
        return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
      }
      const command = String(args.command ?? "").trim();
      if (!command) {
        return JSON.stringify({ ok: false, error: "command is required" });
      }
      if (!isAllowed(command)) {
        const name = command.split(/\s+/)[0] ?? command;
        return JSON.stringify({ ok: false, error: `command not permitted: ${name}` });
      }
      return runCommand(command, root, timeoutMs, maxOutput);
    }
  };
}

function runCommand(command: string, cwd: string, timeoutMs: number, maxOutput: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const child = spawn("sh", ["-lc", command], {
      cwd,
      env: { ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" }
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const cap = (current: string, chunk: Buffer): string =>
      current.length >= maxOutput ? current : current + chunk.toString();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (payload: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(JSON.stringify(payload));
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = cap(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = cap(stderr, chunk);
    });
    child.on("error", (error) => finish({ ok: false, command, error: error.message }));
    child.on("close", (code) => {
      if (timedOut) {
        finish({ ok: false, command, error: `command timed out after ${timeoutMs}ms`, stdout, stderr });
        return;
      }
      finish({
        ok: code === 0,
        command,
        exitCode: code,
        stdout: stdout.slice(0, maxOutput),
        stderr: stderr.slice(0, maxOutput)
      });
    });
    child.stdin?.end();
  });
}
