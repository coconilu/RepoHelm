import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import type { LlmToolSpec } from "../llm.js";

export const EDIT_TOOL = "edit_file";

/**
 * Surgical edit tool: replace an exact, context-anchored snippet inside an
 * existing file instead of rewriting the whole thing. Lets workers make precise
 * changes to large files in an existing repo (the apply_patch equivalent). An
 * ambiguous `oldText` is rejected so edits never land in the wrong place.
 */
export const editToolSpec: LlmToolSpec = {
  type: "function",
  function: {
    name: EDIT_TOOL,
    description:
      "Edit an existing file by replacing an exact snippet (`oldText`) with `newText`. Include enough surrounding context to make `oldText` unique. Prefer this over write_file for changes to existing files.",
    parameters: {
      type: "object",
      required: ["path", "oldText", "newText"],
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "File path relative to the worktree root." },
        oldText: { type: "string", description: "Exact text to replace. Must be unique unless replaceAll is true." },
        newText: { type: "string", description: "Replacement text." },
        replaceAll: { type: "boolean", description: "Replace every occurrence instead of requiring uniqueness." }
      }
    }
  }
};

export interface EditToolHandler {
  /** Worktree-relative paths that were modified. */
  readonly written: Set<string>;
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Build a surgical edit handler confined to `root` (a worktree directory). */
export function buildEditToolHandler(root: string): EditToolHandler {
  const written = new Set<string>();

  function resolveSafe(rawPath: string): { abs: string; rel: string } {
    const cleaned = String(rawPath ?? "").replace(/^[/\\]+/, "");
    const abs = normalize(join(root, cleaned));
    const rel = relative(root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`path escapes worktree: ${rawPath}`);
    }
    return { abs, rel };
  }

  return {
    written,
    async handle(name, args) {
      if (name !== EDIT_TOOL) {
        return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
      }
      try {
        const { abs, rel } = resolveSafe(String(args.path ?? ""));
        const oldText = typeof args.oldText === "string" ? args.oldText : "";
        const newText = typeof args.newText === "string" ? args.newText : "";
        const replaceAll = args.replaceAll === true;
        if (!oldText) {
          return JSON.stringify({ ok: false, error: "oldText is required" });
        }

        let content: string;
        try {
          content = await readFile(abs, "utf8");
        } catch {
          return JSON.stringify({ ok: false, error: `file not found: ${rel}` });
        }

        const occurrences = countOccurrences(content, oldText);
        if (occurrences === 0) {
          return JSON.stringify({ ok: false, error: `oldText not found in ${rel}` });
        }
        if (occurrences > 1 && !replaceAll) {
          return JSON.stringify({
            ok: false,
            error: `oldText is not unique (${occurrences} matches) in ${rel}; add surrounding context or set replaceAll`
          });
        }

        const updated = replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText);
        await writeFile(abs, updated, "utf8");
        written.add(rel);
        return JSON.stringify({ ok: true, path: rel, replacements: replaceAll ? occurrences : 1 });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}
