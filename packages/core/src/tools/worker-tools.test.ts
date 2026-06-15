import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkerToolset } from "./worker-tools.js";

async function worktree(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rh-worker-tools-"));
}

describe("buildWorkerToolset", () => {
  it("exposes file-system, command, search, process and todo tools to the worker", () => {
    const toolset = buildWorkerToolset("/tmp/x");
    const names = toolset.specs.map((spec) => spec.function.name);
    expect(names).toContain("write_file");
    expect(names).toContain("read_file");
    expect(names).toContain("run_command");
    expect(names).toContain("search_files");
    expect(names).toContain("edit_file");
    expect(names).toContain("start_process");
    expect(names).toContain("write_todos");
  });

  it("omits web tools unless enableWeb is set", () => {
    const off = buildWorkerToolset("/tmp/x").specs.map((s) => s.function.name);
    expect(off).not.toContain("web_fetch");

    const on = buildWorkerToolset("/tmp/x", { enableWeb: true }).specs.map((s) => s.function.name);
    expect(on).toContain("web_fetch");
    expect(on).toContain("web_search");
  });

  it("routes write_todos to the todo handler", async () => {
    const toolset = buildWorkerToolset("/tmp/x");
    const result = JSON.parse(await toolset.handle("write_todos", { todos: [{ content: "step 1" }] }));
    expect(result.ok).toBe(true);
    expect(result.todos[0].content).toBe("step 1");
  });

  it("disposes background processes started during the run", async () => {
    const root = await worktree();
    const toolset = buildWorkerToolset(root, { isAllowed: () => true });
    const started = JSON.parse(await toolset.handle("start_process", { command: "sleep 30" }));
    expect(started.ok).toBe(true);
    await toolset.dispose();
    // After dispose the process is killed; reading reflects it is no longer running.
    for (let i = 0; i < 50; i++) {
      const read = JSON.parse(await toolset.handle("read_process", { handle: started.handle }));
      if (!read.running) {
        expect(read.running).toBe(false);
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("process not killed by dispose");
  });

  it("routes edit_file to the edit handler and tracks the modified file as written", async () => {
    const root = await worktree();
    const toolset = buildWorkerToolset(root);
    await toolset.handle("write_file", { path: "src/a.ts", content: "const v = 1;\n" });

    const result = JSON.parse(
      await toolset.handle("edit_file", { path: "src/a.ts", oldText: "const v = 1;", newText: "const v = 2;" })
    );
    expect(result.ok).toBe(true);
    expect(toolset.written.has("src/a.ts")).toBe(true);
  });

  it("routes search_files to the search handler", async () => {
    const root = await worktree();
    const toolset = buildWorkerToolset(root);
    await toolset.handle("write_file", { path: "src/a.ts", content: "export const marker = 1;\n" });

    const result = JSON.parse(await toolset.handle("search_files", { query: "marker" }));
    expect(result.ok).toBe(true);
    expect(result.matches.map((m: { file: string }) => m.file)).toContain("src/a.ts");
  });

  it("routes write_file to the file-system handler and tracks written files", async () => {
    const root = await worktree();
    const toolset = buildWorkerToolset(root);

    const raw = await toolset.handle("write_file", { path: "src/a.ts", content: "export const a = 1;\n" });
    expect(JSON.parse(raw).ok).toBe(true);
    expect(toolset.written.has("src/a.ts")).toBe(true);
    expect(await readFile(join(root, "src/a.ts"), "utf8")).toContain("export const a = 1;");
  });

  it("routes run_command to the shell handler when the command is allowed", async () => {
    const root = await worktree();
    const toolset = buildWorkerToolset(root, { isAllowed: () => true });

    const result = JSON.parse(await toolset.handle("run_command", { command: "echo wired" }));
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("wired");
  });

  it("denies run_command by default (no allowlist) so commands are not run unsupervised", async () => {
    const root = await worktree();
    const toolset = buildWorkerToolset(root);

    const result = JSON.parse(await toolset.handle("run_command", { command: "rm -rf /" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not permitted/i);
  });
});
