import type { LlmToolSpec } from "../llm.js";
import { buildFsToolHandlers, fsToolSpecs } from "./fs.js";
import { buildSearchToolHandler, SEARCH_TOOL, searchToolSpec } from "./search.js";
import { buildShellToolHandler, SHELL_RUN_TOOL, shellToolSpec } from "./shell.js";

export interface WorkerToolOptions {
  /** Gate for `run_command`. Defaults to deny-all (commands won't run). */
  isAllowed?: (command: string) => boolean;
  commandTimeoutMs?: number;
}

export interface WorkerToolset {
  specs: LlmToolSpec[];
  /** Worktree-relative paths created/overwritten via write_file. */
  readonly written: Set<string>;
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

/**
 * The full tool set handed to a worker sub-agent inside a worktree: file-system
 * tools (read/write/list) plus the allowlist-gated `run_command` tool. Combining
 * them lets the worker write code AND verify it (run tests, see failures, fix),
 * which is the agent feedback loop the bounded tool-calling iteration drives.
 */
export function buildWorkerToolset(root: string, options: WorkerToolOptions = {}): WorkerToolset {
  const fs = buildFsToolHandlers(root);
  const shell = buildShellToolHandler(root, {
    isAllowed: options.isAllowed,
    timeoutMs: options.commandTimeoutMs
  });
  const search = buildSearchToolHandler(root);

  return {
    specs: [...fsToolSpecs, searchToolSpec, shellToolSpec],
    written: fs.written,
    async handle(name, args) {
      if (name === SHELL_RUN_TOOL) {
        return shell.handle(name, args);
      }
      if (name === SEARCH_TOOL) {
        return search.handle(name, args);
      }
      return fs.handle(name, args);
    }
  };
}
