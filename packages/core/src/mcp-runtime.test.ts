import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpToolset } from "./mcp-runtime.js";

async function writeFakeMcpServer(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rh-mcp-runtime-"));
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
    send(msg.id, { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] });
    return;
  }
  if (msg.method === "tools/call") {
    send(msg.id, { content: [{ type: "text", text: "echo:" + msg.params.arguments.text }] });
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

describe("createMcpToolset", () => {
  it("loads tools from an approved stdio MCP server and calls them", async () => {
    const server = await writeFakeMcpServer();
    const toolset = await createMcpToolset([
      {
        id: "docs",
        name: "Docs",
        transport: "stdio",
        command: process.execPath,
        args: [server]
      }
    ]);

    expect(toolset.specs.map((spec) => spec.function.name)).toContain("mcp_docs_echo");
    const raw = await toolset.handle("mcp_docs_echo", { text: "hello" });

    expect(raw).toContain("echo:hello");
    await toolset.dispose();
  });
});
