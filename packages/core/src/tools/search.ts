import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import type { LlmToolSpec } from "../llm.js";

export const SEARCH_TOOL = "search_files";

/**
 * Code-search tool handed to worker sub-agents so they can locate relevant code
 * in an existing repo before editing it, rather than generating from scratch.
 * Confined to the worktree root; skips VCS/build/dependency directories.
 *
 * Supports three modes:
 *  - literal content search (default),
 *  - regular-expression content search (`regex: true`),
 *  - find-files-by-name when only a `filePattern` glob is given (no `query`).
 * `filePattern` (glob with `*`, `?`, `**`) further restricts which files are
 * searched in the content modes.
 */
export const searchToolSpec: LlmToolSpec = {
  type: "function",
  function: {
    name: SEARCH_TOOL,
    description:
      "Search the project worktree for code. Provide `query` for a content search (literal, or a regular expression when `regex` is true) and/or `filePattern` (a glob like \"**/*.ts\") to restrict files. With only `filePattern` and no `query`, returns the matching file paths (find files by name). Use this to locate relevant code before changing it.",
    parameters: {
      type: "object",
      required: [],
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Text or regular expression to search file contents for." },
        regex: { type: "boolean", description: "Interpret `query` as a JavaScript regular expression (default false)." },
        filePattern: {
          type: "string",
          description: "Glob (e.g. \"**/*.ts\", \"src/*.tsx\") restricting which files are searched, or listed when no query is given."
        },
        path: {
          type: "string",
          description: "Optional file or directory (relative to the worktree root) to scope the search."
        },
        maxResults: { type: "number", description: "Maximum number of matches/files to return (default 50)." }
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

/** Convert a glob (`*`, `?`, `**`) into an anchored RegExp matching a relative path. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**` matches across path separators (any number of chars).
        out += ".*";
        i++;
        // Swallow a `/` immediately after `**/` so `**/x` also matches `x`.
        if (glob[i + 1] === "/") i++;
      } else {
        // `*` matches anything except a path separator.
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (".+^${}()|[]\\".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`^${out}$`);
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

  function matcher(query: string, regex: boolean): (line: string) => boolean {
    if (regex) {
      const re = new RegExp(query);
      return (line) => re.test(line);
    }
    return (line) => line.includes(query);
  }

  async function searchFile(
    abs: string,
    test: (line: string) => boolean,
    matches: SearchMatch[],
    max: number
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      return; // unreadable
    }
    if (content.includes(NUL)) return; // skip binary files
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && matches.length < max; i++) {
      if (test(lines[i]!)) {
        matches.push({ file: relative(root, abs) || abs, line: i + 1, text: lines[i]!.trim().slice(0, 300) });
      }
    }
  }

  return {
    async handle(name, args) {
      if (name !== SEARCH_TOOL) {
        return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
      }
      const query = typeof args.query === "string" ? args.query : "";
      const filePattern = typeof args.filePattern === "string" && args.filePattern ? args.filePattern : undefined;
      const useRegex = args.regex === true;
      if (!query && !filePattern) {
        return JSON.stringify({ ok: false, error: "query or filePattern is required" });
      }
      const max = typeof args.maxResults === "number" && args.maxResults > 0 ? args.maxResults : DEFAULT_MAX_RESULTS;

      let fileFilter: ((rel: string) => boolean) | undefined;
      if (filePattern) {
        const re = globToRegExp(filePattern);
        fileFilter = (rel) => re.test(rel);
      }

      try {
        const target = resolveSafe(typeof args.path === "string" ? args.path : "");
        const info = await stat(target);

        // Find-files-by-name mode: a glob with no content query.
        if (!query) {
          const files: string[] = [];
          if (info.isFile()) {
            const rel = relative(root, target);
            if (!fileFilter || fileFilter(rel)) files.push(rel);
          } else {
            for await (const file of walk(target)) {
              if (files.length >= max) break;
              const rel = relative(root, file);
              if (!fileFilter || fileFilter(rel)) files.push(rel);
            }
          }
          return JSON.stringify({ ok: true, files });
        }

        let test: (line: string) => boolean;
        try {
          test = matcher(query, useRegex);
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: `invalid regular expression: ${error instanceof Error ? error.message : String(error)}`
          });
        }

        const matches: SearchMatch[] = [];
        if (info.isFile()) {
          const rel = relative(root, target);
          if (!fileFilter || fileFilter(rel)) {
            await searchFile(target, test, matches, max);
          }
        } else {
          for await (const file of walk(target)) {
            if (matches.length >= max) break;
            if (fileFilter && !fileFilter(relative(root, file))) continue;
            await searchFile(file, test, matches, max);
          }
        }
        return JSON.stringify({ ok: true, query, matches });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}
