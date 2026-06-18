import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
});
