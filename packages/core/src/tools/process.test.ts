import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProcessToolHandlers,
  PROCESS_LIST_TOOL,
  PROCESS_READ_TOOL,
  PROCESS_START_TOOL,
  PROCESS_STOP_TOOL
} from "./process.js";

async function worktree(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rh-proc-tool-"));
}

const allowAll = () => true;

async function readUntilExited(handlers: { handle: (n: string, a: Record<string, unknown>) => Promise<string> }, handle: string) {
  for (let i = 0; i < 50; i++) {
    const result = JSON.parse(await handlers.handle(PROCESS_READ_TOOL, { handle }));
    if (!result.running) return result;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("process did not exit in time");
}

describe("buildProcessToolHandlers", () => {
  it("denies start_process by default when no allowlist is provided", async () => {
    const root = await worktree();
    const procs = buildProcessToolHandlers(root);

    const result = JSON.parse(await procs.handle(PROCESS_START_TOOL, { command: "echo hi" }));

    expect(result.ok).toBe(false);
    expect(String(result.error ?? "")).toMatch(/not permitted|denied/i);
    await procs.dispose();
  });

  it("starts a background process and reads its buffered output and exit code", async () => {
    const root = await worktree();
    const procs = buildProcessToolHandlers(root, { isAllowed: allowAll });

    const started = JSON.parse(await procs.handle(PROCESS_START_TOOL, { command: "echo background-up" }));
    expect(started.ok).toBe(true);
    expect(typeof started.handle).toBe("string");

    const result = await readUntilExited(procs, started.handle);
    expect(result.running).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("background-up");
    await procs.dispose();
  });

  it("stops a long-running process", async () => {
    const root = await worktree();
    const procs = buildProcessToolHandlers(root, { isAllowed: allowAll });

    const started = JSON.parse(await procs.handle(PROCESS_START_TOOL, { command: "sleep 30" }));
    const stopped = JSON.parse(await procs.handle(PROCESS_STOP_TOOL, { handle: started.handle }));
    expect(stopped.ok).toBe(true);

    const result = await readUntilExited(procs, started.handle);
    expect(result.running).toBe(false);
    await procs.dispose();
  });

  it("lists running processes", async () => {
    const root = await worktree();
    const procs = buildProcessToolHandlers(root, { isAllowed: allowAll });

    const started = JSON.parse(await procs.handle(PROCESS_START_TOOL, { command: "sleep 30" }));
    const list = JSON.parse(await procs.handle(PROCESS_LIST_TOOL, {}));

    expect(list.ok).toBe(true);
    expect(list.processes.some((p: { handle: string }) => p.handle === started.handle)).toBe(true);
    await procs.dispose();
  });

  it("returns an error reading an unknown handle", async () => {
    const root = await worktree();
    const procs = buildProcessToolHandlers(root, { isAllowed: allowAll });

    const result = JSON.parse(await procs.handle(PROCESS_READ_TOOL, { handle: "nope" }));
    expect(result.ok).toBe(false);
    await procs.dispose();
  });
});
