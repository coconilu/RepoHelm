import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import type { LlmToolSpec } from "../llm.js";

export const FS_WRITE_TOOL = "write_file";
export const FS_READ_TOOL = "read_file";
export const FS_LIST_TOOL = "list_files";

/**
 * File-system tools handed to worker sub-agents so they can produce *real* file
 * changes inside an isolated git worktree (rather than only describing them in prose).
 * Every path is resolved relative to, and confined within, the worktree root.
 */
export const fsToolSpecs: LlmToolSpec[] = [
  {
    type: "function",
    function: {
      name: FS_WRITE_TOOL,
      description:
        "Create or overwrite a file inside the project worktree. Use this to actually implement the requested changes — do not just describe them. Parent directories are created automatically.",
      parameters: {
        type: "object",
        required: ["path", "content"],
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            description: "File path relative to the worktree root, e.g. \"index.html\" or \"src/app.ts\"."
          },
          content: { type: "string", description: "Full file contents to write." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: FS_READ_TOOL,
      description:
        "Read an existing file from the project worktree. Text files return their `content`; images and PDFs return `{ encoding: \"base64\", mediaType, data }` for vision-capable models.",
      parameters: {
        type: "object",
        required: ["path"],
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "File path relative to the worktree root." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: FS_LIST_TOOL,
      description: "List files and directories at a path inside the project worktree.",
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Directory path relative to the worktree root. Defaults to the root." }
        }
      }
    }
  }
];

export interface ExtractedFile {
  path: string;
  content: string;
}

/**
 * Extensions read as binary media and returned base64-encoded with their media
 * type, so a vision-capable ModelKit can consume images/PDFs instead of getting
 * garbled UTF-8. Text files keep the plain `content` path.
 */
const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf"
};

function mediaTypeFor(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_TYPES[ext];
}

const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/g;
const PATH_LIKE = /[\w./-]+\.[A-Za-z0-9]+/;
const CODE_MEMBER_LIKE = /^(?:Array|Boolean|Date|JSON|Math|Number|Object|Promise|String|console|document|process|window)\./;

function cleanPathToken(token: string): string {
  return token.replace(/^['"`]|['"`]$/g, "");
}

function isPathLikeToken(token: string): boolean {
  const cleaned = cleanPathToken(token);
  return !CODE_MEMBER_LIKE.test(cleaned) && (cleaned.includes("/") || /^[\w.-]+\.[A-Za-z0-9]+$/.test(cleaned));
}

function pathFromInfoString(info: string): string | undefined {
  const tokens = info.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const tagged = token.match(/^(?:path|file|filename|title|name)=(.+)$/i);
    if (tagged?.[1]) {
      return cleanPathToken(tagged[1]);
    }
  }
  for (const token of tokens) {
    // A token that contains a slash or a dotted filename (but not a bare language tag).
    if (isPathLikeToken(token)) {
      return cleanPathToken(token);
    }
  }
  return undefined;
}

function pathFromPrecedingText(text: string): string | undefined {
  // Look at the tail of the preceding prose for a "save as `path`" style hint.
  const tail = text.slice(-220);
  const hinted = tail.match(
    /(?:存成|存为|保存为|保存到|写入|创建|新建|命名为|文件名|save(?:\s+it)?\s+(?:as|to)|create|name it)[^\n`'"]*[`'"]?([\w./-]+\.[A-Za-z0-9]+)[`'"]?/i
  );
  if (hinted?.[1]) {
    return hinted[1];
  }
  // Otherwise the last backticked path-like token in the preceding text.
  const backticked = [...tail.matchAll(/`([\w./-]+\.[A-Za-z0-9]+)`/g)];
  const pathLike = backticked.map((item) => item[1]!).filter(isPathLikeToken);
  return pathLike.length > 0 ? pathLike[pathLike.length - 1] : undefined;
}

function defaultPathForBody(info: string, body: string): string | undefined {
  const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if ((lang === "html" || /<!doctype html|<html[\s>]/i.test(body))) {
    return "index.html";
  }
  return undefined;
}

/**
 * Parse a worker's textual answer for the files it intends to create. Supports a
 * path-tagged fence convention (```<path> … ```), a "save as `path`" prose hint,
 * and a sensible default for a single self-contained HTML document.
 *
 * `projectDir` is the worktree directory basename; a leading `<projectDir>/` is
 * stripped so paths land at the project root (the worktree is that project's root).
 */
export function extractFilesFromContent(content: string, projectDir?: string): ExtractedFile[] {
  const ordered: ExtractedFile[] = [];
  let match: RegExpExecArray | null;
  let cursor = 0;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(content)) !== null) {
    const info = match[1] ?? "";
    const body = (match[2] ?? "").replace(/\n$/, "");
    const preceding = content.slice(cursor, match.index);
    cursor = FENCE_RE.lastIndex;
    let path =
      pathFromInfoString(info) ?? pathFromPrecedingText(preceding) ?? defaultPathForBody(info, body);
    if (!path) {
      continue;
    }
    path = path.replace(/^\.\//, "").replace(/^[/\\]+/, "");
    if (projectDir && (path === projectDir || path.startsWith(`${projectDir}/`))) {
      path = path.slice(projectDir.length).replace(/^\//, "");
    }
    if (path && PATH_LIKE.test(path)) {
      ordered.push({ path, content: body });
    }
  }
  // De-dupe by path; the last occurrence wins.
  const byPath = new Map<string, string>();
  for (const file of ordered) {
    byPath.set(file.path, file.content);
  }
  return [...byPath].map(([path, fileContent]) => ({ path, content: fileContent }));
}

export interface FsToolHandlers {
  /** Worktree-relative paths that were created or overwritten via write_file. */
  readonly written: Set<string>;
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

/** Build file-system tool handlers confined to `root` (a worktree directory). */
export function buildFsToolHandlers(root: string): FsToolHandlers {
  const written = new Set<string>();

  function resolveSafe(rawPath: string): { abs: string; rel: string } {
    const cleaned = String(rawPath ?? "").replace(/^[/\\]+/, "");
    const abs = normalize(join(root, cleaned));
    const rel = relative(root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`path escapes worktree: ${rawPath}`);
    }
    return { abs, rel: rel || "." };
  }

  return {
    written,
    async handle(name, args) {
      try {
        if (name === FS_WRITE_TOOL) {
          const { abs, rel } = resolveSafe(String(args.path ?? ""));
          if (!rel || rel === ".") {
            return JSON.stringify({ ok: false, error: "path is required" });
          }
          const content = typeof args.content === "string" ? args.content : String(args.content ?? "");
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, content, "utf8");
          written.add(rel);
          return JSON.stringify({ ok: true, path: rel, bytes: Buffer.byteLength(content, "utf8") });
        }
        if (name === FS_READ_TOOL) {
          const { abs, rel } = resolveSafe(String(args.path ?? ""));
          const mediaType = mediaTypeFor(rel);
          if (mediaType) {
            const buffer = await readFile(abs);
            return JSON.stringify({
              ok: true,
              path: rel,
              encoding: "base64",
              mediaType,
              bytes: buffer.byteLength,
              data: buffer.toString("base64")
            });
          }
          const content = await readFile(abs, "utf8");
          return JSON.stringify({ ok: true, path: rel, content });
        }
        if (name === FS_LIST_TOOL) {
          const { abs, rel } = resolveSafe(String(args.path ?? ""));
          const entries = await readdir(abs, { withFileTypes: true });
          return JSON.stringify({
            ok: true,
            path: rel,
            entries: entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "dir" : "file" }))
          });
        }
        return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}
