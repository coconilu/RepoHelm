import { spawn, type ChildProcess } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { buildChildEnv } from "./tools/env.js";
import type { SandboxRuntimeId } from "./types.js";

export interface SandboxPrepareInput {
  worktreePath: string;
}

export interface SandboxSession {
  id: string;
  runtimeId: SandboxRuntimeId;
  worktreePath: string;
  createdAt: string;
}

export interface SandboxCommand {
  command: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

export type SandboxEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; exitCode: number | null; signal?: NodeJS.Signals | null; timedOut?: boolean; cancelled?: boolean }
  | { type: "error"; message: string };

export interface SandboxArtifact {
  path: string;
  content: Buffer;
}

export interface SandboxRuntime {
  readonly id: SandboxRuntimeId;
  prepare(input: SandboxPrepareInput): Promise<SandboxSession>;
  run(session: SandboxSession, command: SandboxCommand): AsyncIterable<SandboxEvent>;
  copyOut(session: SandboxSession, paths: string[]): Promise<SandboxArtifact[]>;
  dispose(session: SandboxSession): Promise<void>;
}

let sessionSeq = 0;

function nextSessionId(runtimeId: SandboxRuntimeId): string {
  sessionSeq += 1;
  return `${runtimeId}-${Date.now()}-${sessionSeq}`;
}

export function normalizeSandboxRuntimeId(value: unknown): SandboxRuntimeId {
  if (value === "cubesandbox" || value === "external") {
    return "cubesandbox";
  }
  return "local-worktree";
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  try {
    if (pid) {
      process.kill(-pid, signal);
      return;
    }
  } catch {
    // Process group may already be gone; fall back to direct signalling.
  }
  try {
    child.kill(signal);
  } catch {
    // best effort
  }
}

async function assertInside(root: string, path: string): Promise<string> {
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith("..\\") || (rel === "" && abs !== root)) {
    throw new Error(`sandbox copyOut path escapes worktree: ${path}`);
  }
  await stat(abs);
  return abs;
}

export class LocalWorktreeSandboxRuntime implements SandboxRuntime {
  readonly id = "local-worktree" as const;

  async prepare(input: SandboxPrepareInput): Promise<SandboxSession> {
    return {
      id: nextSessionId(this.id),
      runtimeId: this.id,
      worktreePath: resolve(input.worktreePath),
      createdAt: new Date().toISOString()
    };
  }

  async *run(session: SandboxSession, command: SandboxCommand): AsyncIterable<SandboxEvent> {
    if (command.signal?.aborted) {
      yield { type: "exit", exitCode: null, signal: null, cancelled: true };
      return;
    }
    const child = spawn("sh", ["-lc", command.command], {
      cwd: session.worktreePath,
      env: buildChildEnv({ ...process.env, ...(command.env ?? {}) }),
      detached: true
    });

    const queue: SandboxEvent[] = [];
    let notify: (() => void) | undefined;
    let closed = false;
    let timedOut = false;
    let cancelled = false;

    const push = (event: SandboxEvent) => {
      queue.push(event);
      notify?.();
      notify = undefined;
    };
    const wait = () =>
      new Promise<void>((resolveWait) => {
        notify = resolveWait;
      });

    const onAbort = () => {
      cancelled = true;
      killTree(child, "SIGTERM");
    };
    command.signal?.addEventListener("abort", onAbort, { once: true });

    const timer = command.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child, "SIGKILL");
        }, command.timeoutMs)
      : undefined;

    child.stdout?.on("data", (chunk: Buffer) => push({ type: "stdout", data: chunk.toString() }));
    child.stderr?.on("data", (chunk: Buffer) => push({ type: "stderr", data: chunk.toString() }));
    child.on("error", (error) => push({ type: "error", message: error.message }));
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      command.signal?.removeEventListener("abort", onAbort);
      push({ type: "exit", exitCode: code, signal, timedOut, cancelled });
      closed = true;
    });
    child.stdin?.end();

    while (!closed || queue.length > 0) {
      if (queue.length === 0) {
        await wait();
        continue;
      }
      yield queue.shift()!;
    }
  }

  async copyOut(session: SandboxSession, paths: string[]): Promise<SandboxArtifact[]> {
    const artifacts: SandboxArtifact[] = [];
    for (const path of paths) {
      const abs = await assertInside(session.worktreePath, path);
      artifacts.push({ path, content: await readFile(abs) });
    }
    return artifacts;
  }

  async dispose(_session: SandboxSession): Promise<void> {
    // The local-worktree runtime is process-scoped; run() cleans up each command.
  }
}

export class CubeSandboxRuntime implements SandboxRuntime {
  readonly id = "cubesandbox" as const;

  async prepare(_input: SandboxPrepareInput): Promise<SandboxSession> {
    throw new Error("CubeSandbox runtime adapter is reserved but not configured.");
  }

  async *run(_session: SandboxSession, _command: SandboxCommand): AsyncIterable<SandboxEvent> {
    throw new Error("CubeSandbox runtime adapter is reserved but not configured.");
  }

  async copyOut(_session: SandboxSession, _paths: string[]): Promise<SandboxArtifact[]> {
    throw new Error("CubeSandbox runtime adapter is reserved but not configured.");
  }

  async dispose(_session: SandboxSession): Promise<void> {
    // no-op until the adapter is configured
  }
}

export function createSandboxRuntime(id: unknown): SandboxRuntime {
  const runtimeId = normalizeSandboxRuntimeId(id);
  return runtimeId === "cubesandbox" ? new CubeSandboxRuntime() : new LocalWorktreeSandboxRuntime();
}
