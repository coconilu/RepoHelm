import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSandboxRuntime } from "../sandbox.js";
import { buildShellToolHandler, SHELL_RUN_TOOL } from "./shell.js";

async function worktree(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rh-shell-tool-"));
}

const allowAll = () => true;

describe("buildShellToolHandler", () => {
  it("runs an allowed command and returns stdout with exit code 0", async () => {
    const root = await worktree();
    const handler = buildShellToolHandler(root, { isAllowed: allowAll });

    const raw = await handler.handle(SHELL_RUN_TOOL, { command: "echo hello-world" });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-world");
  });

  it("captures a non-zero exit code and stderr so the agent can react to failures", async () => {
    const root = await worktree();
    const handler = buildShellToolHandler(root, { isAllowed: allowAll });

    const raw = await handler.handle(SHELL_RUN_TOOL, {
      command: "echo boom 1>&2; exit 7"
    });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("boom");
  });

  it("denies commands by default when no allowlist is provided", async () => {
    const root = await worktree();
    const handler = buildShellToolHandler(root);

    const raw = await handler.handle(SHELL_RUN_TOOL, { command: "rm -rf /" });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not permitted|不允许|denied/i);
  });

  it("executes inside the worktree root", async () => {
    const root = await worktree();
    await writeFile(join(root, "marker.txt"), "inside-worktree", "utf8");
    const handler = buildShellToolHandler(root, { isAllowed: allowAll });

    const raw = await handler.handle(SHELL_RUN_TOOL, { command: "cat marker.txt" });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("inside-worktree");
  });

  it("enforces a timeout instead of hanging on a long command", async () => {
    const root = await worktree();
    const handler = buildShellToolHandler(root, { isAllowed: allowAll, timeoutMs: 200 });

    const raw = await handler.handle(SHELL_RUN_TOOL, { command: "sleep 5" });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(String(result.error ?? "")).toMatch(/time|超时/i);
  });

  it("cancels an in-flight command when the abort signal fires", async () => {
    const root = await worktree();
    const controller = new AbortController();
    const handler = buildShellToolHandler(root, { isAllowed: allowAll, signal: controller.signal });

    const pending = handler.handle(SHELL_RUN_TOOL, { command: "sleep 5" });
    setTimeout(() => controller.abort(), 50);
    const result = JSON.parse(await pending);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cancelled/i);
  });

  it("does not start a command when the abort signal is already fired", async () => {
    const root = await worktree();
    const controller = new AbortController();
    controller.abort();
    const handler = buildShellToolHandler(root, { isAllowed: allowAll, signal: controller.signal });

    const result = JSON.parse(await handler.handle(SHELL_RUN_TOOL, { command: "echo should-not-run" }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cancelled/i);
    expect(result.stdout ?? "").not.toContain("should-not-run");
  });

  it("returns a tool error instead of throwing when the sandbox runtime is unavailable", async () => {
    const root = await worktree();
    const handler = buildShellToolHandler(root, {
      isAllowed: allowAll,
      runtime: createSandboxRuntime("cubesandbox")
    });

    const result = JSON.parse(await handler.handle(SHELL_RUN_TOOL, { command: "echo should-not-crash" }));

    expect(result.ok).toBe(false);
    expect(result.command).toBe("echo should-not-crash");
    expect(result.error).toMatch(/reserved but not configured/i);
  });
});
