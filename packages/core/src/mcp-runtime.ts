import { spawn, type ChildProcess } from "node:child_process";
import { buildChildEnv } from "./tools/env.js";
import type { LlmToolSpec } from "./llm.js";
import type { McpServerDefinition } from "./types.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpToolBinding {
  exposedName: string;
  serverId: string;
  toolName: string;
  spec: LlmToolSpec;
  client: StdioMcpClient;
}

export interface McpToolset {
  specs: LlmToolSpec[];
  handle(name: string, args: Record<string, unknown>): Promise<string>;
  dispose(): Promise<void>;
}

function frameMessage(message: unknown): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "tool";
}

function extractTextContent(value: unknown): string {
  if (!value || typeof value !== "object") {
    return value === undefined ? "" : String(value);
  }
  const obj = value as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  if (Array.isArray(obj.content)) {
    const text = obj.content
      .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : JSON.stringify(item)))
      .join("\n");
    return JSON.stringify({ ok: !obj.isError, content: text });
  }
  return JSON.stringify(value);
}

class StdioMcpClient {
  private child?: ChildProcess;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number | string, { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void }>();

  constructor(private readonly server: McpServerDefinition) {}

  async start(): Promise<void> {
    if (this.child) {
      return;
    }
    this.child = spawn(this.server.command, this.server.args ?? [], {
      cwd: this.server.cwd,
      env: buildChildEnv({ ...process.env, ...(this.server.env ?? {}) }),
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.stderr?.on("data", () => {
      // MCP stderr is diagnostic noise; keep it off tool output.
    });
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("close", (code) => this.rejectAll(new Error(`MCP server ${this.server.id} exited (${code})`)));

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "RepoHelm", version: "0.1.0" }
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    const response = await this.request("tools/list", {});
    const result = response.result as { tools?: McpTool[] } | undefined;
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error) {
      return JSON.stringify({ ok: false, error: response.error.message ?? "MCP tool failed" });
    }
    return extractTextContent(response.result);
  }

  async dispose(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  private request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
    this.child?.stdin?.write(frameMessage(payload));
    return promise;
  }

  private notify(method: string, params?: unknown): void {
    this.child?.stdin?.write(frameMessage({ jsonrpc: "2.0", method, params }));
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = header.match(/content-length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) {
        return;
      }
      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(body) as JsonRpcResponse;
    } catch {
      return;
    }
    if (parsed.id === undefined) {
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }
    this.pending.delete(parsed.id);
    pending.resolve(parsed);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function createMcpToolset(servers: McpServerDefinition[]): Promise<McpToolset> {
  const bindings = new Map<string, McpToolBinding>();
  const clients: StdioMcpClient[] = [];
  try {
    for (const server of servers) {
      if (server.transport !== "stdio") {
        continue;
      }
      const client = new StdioMcpClient(server);
      await client.start();
      clients.push(client);
      const tools = await client.listTools();
      for (const tool of tools) {
        const exposedName = `mcp_${sanitizeName(server.id)}_${sanitizeName(tool.name)}`.slice(0, 64);
        bindings.set(exposedName, {
          exposedName,
          serverId: server.id,
          toolName: tool.name,
          client,
          spec: {
            type: "function",
            function: {
              name: exposedName,
              description: tool.description
                ? `[MCP:${server.name}] ${tool.description}`
                : `[MCP:${server.name}] ${tool.name}`,
              parameters: tool.inputSchema ?? { type: "object", additionalProperties: true }
            }
          }
        });
      }
    }
  } catch (error) {
    await Promise.all(clients.map((client) => client.dispose()));
    throw error;
  }

  return {
    specs: [...bindings.values()].map((binding) => binding.spec),
    async handle(name, args) {
      const binding = bindings.get(name);
      if (!binding) {
        return JSON.stringify({ ok: false, error: `unknown MCP tool ${name}` });
      }
      return binding.client.callTool(binding.toolName, args);
    },
    async dispose() {
      await Promise.all(clients.map((client) => client.dispose()));
    }
  };
}
