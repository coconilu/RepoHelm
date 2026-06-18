import type { LlmToolSpec } from "../llm.js";
import { createMcpToolset } from "../mcp-runtime.js";
import type { SandboxRuntime } from "../sandbox.js";
import type { McpServerDefinition } from "../types.js";
import { buildEditToolHandler, EDIT_TOOL, editToolSpec } from "./edit.js";
import { buildFsToolHandlers, fsToolSpecs } from "./fs.js";
import {
  buildProcessToolHandlers,
  PROCESS_LIST_TOOL,
  PROCESS_READ_TOOL,
  PROCESS_START_TOOL,
  PROCESS_STOP_TOOL,
  processToolSpecs
} from "./process.js";
import { buildSearchToolHandler, SEARCH_TOOL, searchToolSpec } from "./search.js";
import { buildShellToolHandler, SHELL_RUN_TOOL, shellToolSpec } from "./shell.js";
import { buildTodoToolHandler, todoToolSpec, WRITE_TODOS_TOOL } from "./todo.js";
import { buildWebToolHandlers, type WebSearchResult, WEB_FETCH_TOOL, WEB_SEARCH_TOOL, webToolSpecs } from "./web.js";

export interface WorkerToolOptions {
  /** Gate for `run_command` and `start_process`. Defaults to deny-all (commands
   *  won't run). May be async so the caller can record an audit entry per command. */
  isAllowed?: (command: string) => boolean | Promise<boolean>;
  commandTimeoutMs?: number;
  /** Expose the `web_fetch` / `web_search` tools (network egress is opt-in). */
  enableWeb?: boolean;
  /** Injected fetch for web tools (tests / proxies). */
  webFetchImpl?: typeof fetch;
  /** Pluggable web_search backend. */
  webSearchImpl?: (query: string) => Promise<WebSearchResult[]>;
  /** Allow web_fetch to reach loopback/localhost (local dev services). */
  allowLoopback?: boolean;
  /** Resolve hostnames to IPs for the web_fetch SSRF guard (DNS-rebinding). */
  resolveHost?: (hostname: string) => Promise<string[]>;
  runtime?: SandboxRuntime;
  signal?: AbortSignal;
  mcpServers?: McpServerDefinition[];
}

export interface WorkerToolset {
  specs: LlmToolSpec[];
  /** Worktree-relative paths created/overwritten via write_file. */
  readonly written: Set<string>;
  handle(name: string, args: Record<string, unknown>): Promise<string>;
  /** Tear down any background processes started during the run. */
  dispose(): Promise<void>;
}

const PROCESS_TOOLS = new Set<string>([
  PROCESS_START_TOOL,
  PROCESS_READ_TOOL,
  PROCESS_STOP_TOOL,
  PROCESS_LIST_TOOL
]);
const WEB_TOOLS = new Set<string>([WEB_FETCH_TOOL, WEB_SEARCH_TOOL]);

/**
 * The full tool set handed to a worker sub-agent inside a worktree: file-system
 * tools (read/write/list/edit), code search, the allowlist-gated `run_command`
 * tool, background-process tools, a process-tracking todo tool, and — when
 * enabled — web access. Combining them lets the worker write code, verify it
 * (run tests, see failures, fix), run dev servers and track its own progress —
 * the agent feedback loop the bounded tool-calling iteration drives.
 */
export function buildWorkerToolset(root: string, options: WorkerToolOptions = {}): WorkerToolset {
  const fs = buildFsToolHandlers(root);
  const edit = buildEditToolHandler(root);
  const shell = buildShellToolHandler(root, {
    isAllowed: options.isAllowed,
    timeoutMs: options.commandTimeoutMs,
    runtime: options.runtime,
    signal: options.signal
  });
  const search = buildSearchToolHandler(root);
  const processes = buildProcessToolHandlers(root, { isAllowed: options.isAllowed, signal: options.signal });
  const todos = buildTodoToolHandler();
  const web = buildWebToolHandlers({
    enabled: options.enableWeb,
    fetchImpl: options.webFetchImpl,
    searchImpl: options.webSearchImpl,
    allowLoopback: options.allowLoopback,
    resolveHost: options.resolveHost
  });

  // Union of files touched via write_file (fs) and edit_file (edit), so the
  // orchestrator's material-output check sees every change regardless of tool.
  const written = new Set<string>();
  const mergeWritten = () => {
    for (const path of fs.written) written.add(path);
    for (const path of edit.written) written.add(path);
  };

  const specs = [
    ...fsToolSpecs,
    editToolSpec,
    searchToolSpec,
    shellToolSpec,
    ...processToolSpecs,
    todoToolSpec,
    ...(options.enableWeb ? webToolSpecs : [])
  ];

  return {
    specs,
    written,
    async handle(name, args) {
      let output: string;
      if (name === SHELL_RUN_TOOL) {
        output = await shell.handle(name, args);
      } else if (name === SEARCH_TOOL) {
        output = await search.handle(name, args);
      } else if (name === EDIT_TOOL) {
        output = await edit.handle(name, args);
      } else if (PROCESS_TOOLS.has(name)) {
        output = await processes.handle(name, args);
      } else if (name === WRITE_TODOS_TOOL) {
        output = await todos.handle(name, args);
      } else if (WEB_TOOLS.has(name)) {
        output = await web.handle(name, args);
      } else {
        output = await fs.handle(name, args);
      }
      mergeWritten();
      return output;
    },
    async dispose() {
      await processes.dispose();
    }
  };
}

export async function buildWorkerToolsetAsync(
  root: string,
  options: WorkerToolOptions = {}
): Promise<WorkerToolset> {
  const base = buildWorkerToolset(root, options);
  const mcpServers = options.mcpServers ?? [];
  if (mcpServers.length === 0) {
    return base;
  }
  const mcp = await createMcpToolset(mcpServers);
  return {
    specs: [...base.specs, ...mcp.specs],
    get written() {
      return base.written;
    },
    async handle(name, args) {
      if (mcp.specs.some((spec) => spec.function.name === name)) {
        return mcp.handle(name, args);
      }
      return base.handle(name, args);
    },
    async dispose() {
      await Promise.all([base.dispose(), mcp.dispose()]);
    }
  };
}
