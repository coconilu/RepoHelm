import { type ChildProcess, spawn } from "node:child_process";
import { buildChildEnv } from "./env.js";
import type { LlmToolSpec } from "../llm.js";
import { killProcessTree } from "../process-tree.js";

export const PROCESS_START_TOOL = "start_process";
export const PROCESS_READ_TOOL = "read_process";
export const PROCESS_STOP_TOOL = "stop_process";
export const PROCESS_LIST_TOOL = "list_processes";

/**
 * Long-running / background process tools for worker sub-agents. Unlike
 * `run_command` (which blocks until the command exits), these start a process,
 * buffer its output, and let the agent poll or stop it — enabling dev servers,
 * watchers and other long tasks. Execution is gated by the same `isAllowed`
 * predicate as `run_command` (default deny-all).
 */
export const processToolSpecs: LlmToolSpec[] = [
  {
    type: "function",
    function: {
      name: PROCESS_START_TOOL,
      description:
        "Start a long-running command in the background (e.g. a dev server or watcher) inside the project worktree. Returns a handle; use read_process to poll output and stop_process to terminate. Only allowlisted commands are permitted.",
      parameters: {
        type: "object",
        required: ["command"],
        additionalProperties: false,
        properties: { command: { type: "string", description: "The shell command to start." } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: PROCESS_READ_TOOL,
      description: "Read buffered stdout/stderr and the running state of a background process by handle.",
      parameters: {
        type: "object",
        required: ["handle"],
        additionalProperties: false,
        properties: {
          handle: { type: "string", description: "Handle returned by start_process." },
          clear: { type: "boolean", description: "Drain the buffer after reading (default false)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: PROCESS_STOP_TOOL,
      description: "Terminate a background process by handle.",
      parameters: {
        type: "object",
        required: ["handle"],
        additionalProperties: false,
        properties: { handle: { type: "string", description: "Handle returned by start_process." } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: PROCESS_LIST_TOOL,
      description: "List background processes started in this run with their handle, command and running state.",
      parameters: { type: "object", required: [], additionalProperties: false, properties: {} }
    }
  }
];

export interface ProcessToolOptions {
  /** Returns true if the command may run. Defaults to deny-all. */
  isAllowed?: (command: string) => boolean | Promise<boolean>;
  /** Max bytes of stdout/stderr retained per process. */
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface ProcessToolHandler {
  handle(name: string, args: Record<string, unknown>): Promise<string>;
  /** Kill every process started in this run. Call when the worker loop ends. */
  dispose(): Promise<void>;
}

interface ProcEntry {
  command: string;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  running: boolean;
  exitCode: number | null;
}

const DEFAULT_MAX_OUTPUT = 32_000;

export function buildProcessToolHandlers(root: string, options: ProcessToolOptions = {}): ProcessToolHandler {
  const isAllowed = options.isAllowed ?? (() => false);
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const procs = new Map<string, ProcEntry>();
  let counter = 0;

  const disposeAll = () => {
    for (const entry of procs.values()) {
      if (entry.running) {
        killProcessTree(entry.child, "SIGKILL");
      }
    }
  };

  options.signal?.addEventListener("abort", disposeAll, { once: true });

  function start(command: string): ProcEntry {
    const child = spawn("sh", ["-lc", command], {
      cwd: root,
      env: buildChildEnv(),
      // New process group so we can signal the whole tree (the shell plus any
      // children it spawns — dev servers, watchers), not just the top-level sh.
      detached: true
    });
    const entry: ProcEntry = { command, child, stdout: "", stderr: "", running: true, exitCode: null };
    const cap = (current: string, chunk: Buffer): string =>
      current.length >= maxOutput ? current : (current + chunk.toString()).slice(0, maxOutput);
    child.stdout?.on("data", (chunk: Buffer) => {
      entry.stdout = cap(entry.stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      entry.stderr = cap(entry.stderr, chunk);
    });
    child.on("error", (error) => {
      entry.stderr = cap(entry.stderr, Buffer.from(`\n${error.message}`));
      entry.running = false;
    });
    child.on("close", (code) => {
      entry.running = false;
      entry.exitCode = code;
    });
    child.stdin?.end();
    return entry;
  }

  return {
    async handle(name, args) {
      if (name === PROCESS_START_TOOL) {
        if (options.signal?.aborted) {
          return JSON.stringify({ ok: false, error: "process start cancelled" });
        }
        const command = String(args.command ?? "").trim();
        if (!command) return JSON.stringify({ ok: false, error: "command is required" });
        if (!(await isAllowed(command))) {
          const subject = command.split(/\s+/)[0] ?? command;
          return JSON.stringify({ ok: false, error: `command not permitted: ${subject}` });
        }
        const handle = `proc-${++counter}`;
        procs.set(handle, start(command));
        return JSON.stringify({ ok: true, handle, command });
      }

      if (name === PROCESS_READ_TOOL) {
        const handle = String(args.handle ?? "");
        const entry = procs.get(handle);
        if (!entry) return JSON.stringify({ ok: false, error: `unknown process handle: ${handle}` });
        const payload = {
          ok: true,
          handle,
          command: entry.command,
          running: entry.running,
          exitCode: entry.exitCode,
          stdout: entry.stdout,
          stderr: entry.stderr
        };
        if (args.clear === true) {
          entry.stdout = "";
          entry.stderr = "";
        }
        return JSON.stringify(payload);
      }

      if (name === PROCESS_STOP_TOOL) {
        const handle = String(args.handle ?? "");
        const entry = procs.get(handle);
        if (!entry) return JSON.stringify({ ok: false, error: `unknown process handle: ${handle}` });
        if (entry.running) killProcessTree(entry.child, "SIGTERM");
        return JSON.stringify({ ok: true, handle, stopped: true });
      }

      if (name === PROCESS_LIST_TOOL) {
        const processes = [...procs.entries()].map(([handle, entry]) => ({
          handle,
          command: entry.command,
          running: entry.running,
          exitCode: entry.exitCode
        }));
        return JSON.stringify({ ok: true, processes });
      }

      return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
    },

    async dispose() {
      options.signal?.removeEventListener("abort", disposeAll);
      disposeAll();
    }
  };
}
