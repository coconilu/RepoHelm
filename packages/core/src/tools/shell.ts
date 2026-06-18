import { createSandboxRuntime, type SandboxRuntime } from "../sandbox.js";
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
  /** Returns true if the command may run. Defaults to deny-all. May be async so
   *  callers can record an audit entry while deciding. */
  isAllowed?: (command: string) => boolean | Promise<boolean>;
  timeoutMs?: number;
  /** Max bytes of stdout/stderr to keep in the tool result. */
  maxOutputBytes?: number;
  runtime?: SandboxRuntime;
  signal?: AbortSignal;
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
  const runtime = options.runtime ?? createSandboxRuntime("local-worktree");

  return {
    async handle(name, args) {
      if (name !== SHELL_RUN_TOOL) {
        return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
      }
      const command = String(args.command ?? "").trim();
      if (!command) {
        return JSON.stringify({ ok: false, error: "command is required" });
      }
      if (!(await isAllowed(command))) {
        const name = command.split(/\s+/)[0] ?? command;
        return JSON.stringify({ ok: false, error: `command not permitted: ${name}` });
      }
      if (options.signal?.aborted) {
        return JSON.stringify({ ok: false, command, error: "command cancelled" });
      }
      return runCommand(command, root, timeoutMs, maxOutput, runtime, options.signal);
    }
  };
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  maxOutput: number,
  runtime: SandboxRuntime,
  signal?: AbortSignal
): Promise<string> {
  const session = await runtime.prepare({ worktreePath: cwd });
  let stdout = "";
  let stderr = "";
  const cap = (current: string, data: string): string =>
    current.length >= maxOutput ? current : (current + data).slice(0, maxOutput);
  try {
    for await (const event of runtime.run(session, { command, timeoutMs, signal })) {
      if (event.type === "stdout") {
        stdout = cap(stdout, event.data);
      } else if (event.type === "stderr") {
        stderr = cap(stderr, event.data);
      } else if (event.type === "error") {
        return JSON.stringify({ ok: false, command, error: event.message, stdout, stderr });
      } else if (event.type === "exit") {
        if (event.cancelled) {
          return JSON.stringify({ ok: false, command, error: "command cancelled", stdout, stderr });
        }
        if (event.timedOut) {
          return JSON.stringify({ ok: false, command, error: `command timed out after ${timeoutMs}ms`, stdout, stderr });
        }
        return JSON.stringify({
          ok: event.exitCode === 0,
          command,
          exitCode: event.exitCode,
          stdout: stdout.slice(0, maxOutput),
          stderr: stderr.slice(0, maxOutput)
        });
      }
    }
    return JSON.stringify({ ok: false, command, error: "sandbox command ended without an exit event", stdout, stderr });
  } finally {
    await runtime.dispose(session);
  }
}
