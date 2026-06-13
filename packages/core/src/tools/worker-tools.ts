import type { LlmToolSpec } from "../llm.js";
import { buildEditToolHandler, EDIT_TOOL, editToolSpec } from "./edit.js";
import { buildFsToolHandlers, fsToolSpecs } from "./fs.js";
import { buildSearchToolHandler, SEARCH_TOOL, searchToolSpec } from "./search.js";
import { buildShellToolHandler, SHELL_RUN_TOOL, shellToolSpec } from "./shell.js";

export interface WorkerToolOptions {
  /** Gate for `run_command`. Defaults to deny-all (commands won't run). May be
   *  async so the caller can record an audit entry per command. */
  isAllowed?: (command: string) => boolean | Promise<boolean>;
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
  const edit = buildEditToolHandler(root);
  const shell = buildShellToolHandler(root, {
    isAllowed: options.isAllowed,
    timeoutMs: options.commandTimeoutMs
  });
  const search = buildSearchToolHandler(root);

  // Union of files touched via write_file (fs) and edit_file (edit), so the
  // orchestrator's material-output check sees every change regardless of tool.
  const written = new Set<string>();
  const mergeWritten = () => {
    for (const path of fs.written) written.add(path);
    for (const path of edit.written) written.add(path);
  };

  return {
    specs: [...fsToolSpecs, editToolSpec, searchToolSpec, shellToolSpec],
    written,
    async handle(name, args) {
      let output: string;
      if (name === SHELL_RUN_TOOL) {
        output = await shell.handle(name, args);
      } else if (name === SEARCH_TOOL) {
        output = await search.handle(name, args);
      } else if (name === EDIT_TOOL) {
        output = await edit.handle(name, args);
      } else {
        output = await fs.handle(name, args);
      }
      mergeWritten();
      return output;
    }
  };
}
