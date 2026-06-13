import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import type { LlmToolSpec } from "../llm.js";

export const SEARCH_TOOL = "search_files";

/**
 * Code-search tool handed to worker sub-agents so they can locate relevant code
 * in an existing repo before editing it, rather than generating from scratch.
 * Confined to the worktree root; skips VCS/build/dependency directories.
 */
export const searchToolSpec: LlmToolSpec = {
  type: "function",
  function: {
    name: SEARCH_TOOL,
    description:
      "Search the project worktree for a literal text query and return matching files with line numbers. Use this to locate relevant code before changing it.",
    parameters: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Literal text to search for." },
        path: {
          type: "string",
          description: "Optional file or directory (relative to the worktree root) to scope the search."
        },
        maxResults: { type: "number", description: "Maximum number of matches to return (default 50)." }
      }
    }
  }
};

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".repohelm", "coverage", ".next"]);
const DEFAULT_MAX_RESULTS = 50;
const NUL = String.fromCharCode(0);

export interface SearchToolHandler {
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

/** Build a code-search handler confined to `root` (a worktree directory). */
export function buildSearchToolHandler(root: string): SearchToolHandler {
  function resolveSafe(rawPath: string): string {
    const cleaned = String(rawPath ?? "").replace(/^[/\\]+/, "");
    const abs = normalize(join(root, cleaned));
    const rel = relative(root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`path escapes worktree: ${rawPath}`);
    }
    return abs;
  }

  async function* walk(dir: string): AsyncGenerator<string> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        yield* walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        yield join(dir, entry.name);
      }
    }
  }

  async function searchFile(abs: string, query: string, matches: SearchMatch[], max: number): Promise<void> {
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      return; // unreadable
    }
    if (content.includes(NUL)) return; // skip binary files
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && matches.length < max; i++) {
      if (lines[i]!.includes(query)) {
        matches.push({ file: relative(root, abs) || abs, line: i + 1, text: lines[i]!.trim().slice(0, 300) });
      }
    }
  }

  return {
    async handle(name, args) {
      if (name !== SEARCH_TOOL) {
        return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
      }
      const query = String(args.query ?? "");
      if (!query) {
        return JSON.stringify({ ok: false, error: "query is required" });
      }
      const max = typeof args.maxResults === "number" && args.maxResults > 0 ? args.maxResults : DEFAULT_MAX_RESULTS;
      const matches: SearchMatch[] = [];
      try {
        const target = resolveSafe(typeof args.path === "string" ? args.path : "");
        const info = await stat(target);
        if (info.isFile()) {
          await searchFile(target, query, matches, max);
        } else {
          for await (const file of walk(target)) {
            if (matches.length >= max) break;
            await searchFile(file, query, matches, max);
          }
        }
        return JSON.stringify({ ok: true, query, matches });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}
