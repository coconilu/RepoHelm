import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkerToolset, buildWorkerToolsetAsync } from "./worker-tools.js";

async function worktree(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rh-worker-tools-"));
}

async function writeFakeMcpServer(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rh-worker-mcp-"));
  const file = join(dir, "fake-mcp.mjs");
  await writeFile(
    file,
    `
let buffer = Buffer.alloc(0);
function send(id, result) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
}
function handle(msg) {
  if (msg.method === "initialize") {
    send(msg.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake" } });
    return;
  }
  if (msg.method === "tools/list") {
    send(msg.id, { tools: [{ name: "lookup", description: "Lookup docs", inputSchema: { type: "object", properties: { query: { type: "string" } } } }] });
    return;
  }
  if (msg.method === "tools/call") {
    send(msg.id, { content: [{ type: "text", text: "docs:" + msg.params.arguments.query }] });
  }
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString();
    const match = header.match(/content-length:\\s*(\\d+)/i);
    const length = Number(match?.[1] || 0);
    const start = headerEnd + 4;
    const end = start + length;
    if (buffer.length < end) return;
    const body = buffer.slice(start, end).toString();
    buffer = buffer.slice(end);
    const msg = JSON.parse(body);
    if (msg.id !== undefined) handle(msg);
  }
});
`,
    "utf8"
  );
  return file;
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

  it("exposes approved MCP tools through the async worker toolset", async () => {
    const root = await worktree();
    const server = await writeFakeMcpServer();
    const toolset = await buildWorkerToolsetAsync(root, {
      mcpServers: [
        {
          id: "docs",
          name: "Docs",
          transport: "stdio",
          command: process.execPath,
          args: [server]
        }
      ]
    });

    try {
      expect(toolset.specs.map((spec) => spec.function.name)).toContain("mcp_docs_lookup");
      expect(await toolset.handle("mcp_docs_lookup", { query: "sandbox" })).toContain("docs:sandbox");
    } finally {
      await toolset.dispose();
    }
  });
});
