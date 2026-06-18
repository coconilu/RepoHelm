import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSandboxRuntime,
  LocalWorktreeSandboxRuntime,
  normalizeSandboxRuntimeId
} from "./sandbox.js";
import type { SandboxEvent } from "./sandbox.js";

async function worktree(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rh-sandbox-"));
}

async function collect(events: AsyncIterable<SandboxEvent>): Promise<SandboxEvent[]> {
  const out: SandboxEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
}

async function collectWithTimeout(events: AsyncIterable<SandboxEvent>): Promise<SandboxEvent[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      collect(events),
      new Promise<SandboxEvent[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error("sandbox run did not settle")), 1_000);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("SandboxRuntime", () => {
  it("normalizes legacy and reserved runtime ids", () => {
    expect(normalizeSandboxRuntimeId("local")).toBe("local-worktree");
    expect(normalizeSandboxRuntimeId("local-worktree")).toBe("local-worktree");
    expect(normalizeSandboxRuntimeId("external")).toBe("cubesandbox");
    expect(normalizeSandboxRuntimeId("cubesandbox")).toBe("cubesandbox");
    expect(normalizeSandboxRuntimeId(undefined)).toBe("local-worktree");
  });

  it("runs commands in a local worktree session and emits stdout, stderr, and exit", async () => {
    const root = await worktree();
    await writeFile(join(root, "marker.txt"), "inside", "utf8");
    const runtime = new LocalWorktreeSandboxRuntime();
    const session = await runtime.prepare({ worktreePath: root });

    const events = await collect(
      runtime.run(session, {
        command: "cat marker.txt; echo warn 1>&2"
      })
    );

    expect(events.some((event) => event.type === "stdout" && event.data.includes("inside"))).toBe(true);
    expect(events.some((event) => event.type === "stderr" && event.data.includes("warn"))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "exit", exitCode: 0 });
  });

  it("copies artifacts out of the worktree without allowing path escape", async () => {
    const root = await worktree();
    await writeFile(join(root, "result.txt"), "artifact", "utf8");
    const runtime = new LocalWorktreeSandboxRuntime();
    const session = await runtime.prepare({ worktreePath: root });

    const [artifact] = await runtime.copyOut(session, ["result.txt"]);

    expect(artifact?.path).toBe("result.txt");
    expect(artifact?.content.toString("utf8")).toBe("artifact");
    await expect(runtime.copyOut(session, ["../secret.txt"])).rejects.toThrow(/escapes worktree/);
  });

  it("creates a reserved cubesandbox adapter that fails clearly until configured", async () => {
    const runtime = createSandboxRuntime("cubesandbox");

    expect(runtime.id).toBe("cubesandbox");
    await expect(runtime.prepare({ worktreePath: await worktree() })).rejects.toThrow(/reserved but not configured/);
  });

  it("cleans up and completes when a command cannot be spawned", async () => {
    const root = await worktree();
    const runtime = new LocalWorktreeSandboxRuntime();
    const session = await runtime.prepare({ worktreePath: join(root, "missing") });
    const listeners = new Set<unknown>();
    const signal = {
      aborted: false,
      addEventListener: vi.fn((_type: string, listener: unknown) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: unknown) => listeners.delete(listener))
    } as unknown as AbortSignal;

    const events = await collectWithTimeout(
      runtime.run(session, { command: "echo unreachable", timeoutMs: 50, signal })
    );

    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(signal.removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(listeners.size).toBe(0);
  });
});
