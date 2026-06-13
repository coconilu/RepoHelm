import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import type { LlmToolSpec } from "../llm.js";

export const FS_WRITE_TOOL = "write_file";
export const FS_READ_TOOL = "read_file";
export const FS_LIST_TOOL = "list_files";
export const FS_SEARCH_TOOL = "search_files";
export const FS_APPLY_PATCH_TOOL = "apply_patch";
export const FS_SHELL_RUN_TOOL = "shell_run";

const execFileAsync = promisify(execFile);

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
      description: "Read an existing file from the project worktree.",
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
  },
  {
    type: "function",
    function: {
      name: FS_APPLY_PATCH_TOOL,
      description:
        "Apply a unified diff patch inside the project worktree. Context lines are verified before writing files.",
      parameters: {
        type: "object",
        required: ["patch"],
        additionalProperties: false,
        properties: {
          patch: { type: "string", description: "Unified diff patch text with ---/+++ file headers and @@ hunks." }
        }
      }
    }
  }
];

export interface ExtractedFile {
  path: string;
  content: string;
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

export interface FsToolHandlerOptions {
  commandApprovalMode?: "allowlist" | "manual";
  allowedCommands?: string[];
  shellTimeoutMs?: number;
  maxOutputBytes?: number;
}

interface ParsedCommand {
  command: string;
  args: string[];
}

interface PatchFile {
  oldPath?: string;
  newPath?: string;
  hunks: PatchHunk[];
}

interface PatchHunk {
  oldStart: number;
  oldLength: number;
  newStart: number;
  newLength: number;
  lines: Array<{ kind: "context" | "remove" | "add"; text: string }>;
}

interface PatchWritePlan {
  abs: string;
  rel: string;
  nextContent?: string;
  delete: boolean;
}

/** Build file-system tool handlers confined to `root` (a worktree directory). */
export function buildFsToolHandlers(root: string, options: FsToolHandlerOptions = {}): FsToolHandlers {
  const written = new Set<string>();
  const maxOutputBytes = boundedNumber(options.maxOutputBytes, 24_000, 1024, 200_000);
  let rootRealpath: Promise<string> | undefined;

  function resolveSafe(rawPath: string): { abs: string; rel: string } {
    const cleaned = String(rawPath ?? "").replace(/^[/\\]+/, "");
    const abs = normalize(join(root, cleaned));
    const rel = relative(root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`path escapes worktree: ${rawPath}`);
    }
    return { abs, rel: rel || "." };
  }

  async function assertRealPathInside(abs: string, rawPath: string): Promise<void> {
    rootRealpath ??= realpath(root);
    const [realRoot, realAbs] = await Promise.all([rootRealpath, realpath(abs)]);
    const rel = relative(realRoot, realAbs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`path escapes worktree: ${rawPath}`);
    }
  }

  async function safeReadFile(abs: string, rel: string): Promise<string> {
    await assertRealPathInside(abs, rel);
    return readFile(abs, "utf8");
  }

  async function assertWriteAllowed(abs: string, rel: string): Promise<void> {
    const parent = dirname(abs);
    await assertWritePathSafe(abs, rel);
    await mkdir(parent, { recursive: true });
    await assertRealPathInside(parent, rel);
  }

  async function assertWritePathSafe(abs: string, rel: string): Promise<void> {
    await assertWritableAncestorInside(dirname(abs), rel);
    try {
      await lstat(abs);
      await assertRealPathInside(abs, rel);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  async function assertWritableAncestorInside(parentAbs: string, rel: string): Promise<void> {
    let cursor = parentAbs;
    while (true) {
      const cursorRel = relative(root, cursor);
      if (cursorRel.startsWith("..") || isAbsolute(cursorRel)) {
        throw new Error(`path escapes worktree: ${rel}`);
      }
      try {
        await lstat(cursor);
        await assertRealPathInside(cursor, rel);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          throw error;
        }
        const next = dirname(cursor);
        if (next === cursor) {
          throw error;
        }
        cursor = next;
      }
    }
  }

  async function safeWriteFile(abs: string, rel: string, content: string): Promise<void> {
    await assertWriteAllowed(abs, rel);
    await writeFile(abs, content, "utf8");
  }

  async function listTextFiles(startAbs: string, startRel: string): Promise<Array<{ abs: string; rel: string }>> {
    await assertRealPathInside(startAbs, startRel);
    const entries = await readdir(startAbs, { withFileTypes: true });
    const files: Array<{ abs: string; rel: string }> = [];
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const childRel = startRel === "." ? entry.name : `${startRel}/${entry.name}`;
      const childAbs = join(startAbs, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listTextFiles(childAbs, childRel));
      } else if (entry.isFile()) {
        files.push({ abs: childAbs, rel: childRel });
      }
    }
    return files;
  }

  async function searchFiles(args: Record<string, unknown>): Promise<string> {
    const query = typeof args.query === "string" ? args.query : String(args.query ?? "");
    const { abs, rel } = resolveSafe(typeof args.path === "string" ? args.path : "");
    const glob = typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : undefined;
    const maxResults = boundedNumber(args.maxResults, 50, 1, 200);
    const regex = Boolean(args.regex);
    const caseSensitive = Boolean(args.caseSensitive);
    if (!query && !glob) {
      return JSON.stringify({ ok: false, error: "query or glob is required" });
    }
    const matcher = buildTextMatcher(query, { regex, caseSensitive });
    const globMatcher = glob ? buildGlobMatcher(glob) : undefined;
    const candidates = await collectSearchCandidates(abs, rel);
    const results: Array<{ path: string; line: number; column: number; match: string }> = [];

    for (const file of candidates) {
      if (globMatcher && !globMatcher(file.rel)) {
        continue;
      }
      let content: string;
      try {
        content = await safeReadFile(file.abs, file.rel);
      } catch {
        continue;
      }
      if (content.includes("\0")) {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        const column = matcher(line);
        if (column >= 0) {
          results.push({ path: file.rel, line: index + 1, column: column + 1, match: line });
          if (results.length >= maxResults) {
            return JSON.stringify({ ok: true, query, results, truncated: true });
          }
        }
      }
    }

    return JSON.stringify({ ok: true, query, results, truncated: false });
  }

  async function collectSearchCandidates(abs: string, rel: string): Promise<Array<{ abs: string; rel: string }>> {
    try {
      await assertRealPathInside(abs, rel);
      await readdir(abs, { withFileTypes: true });
      return listTextFiles(abs, rel);
    } catch {
      await assertRealPathInside(abs, rel);
      return [{ abs, rel }];
    }
  }

  async function applyPatch(patch: string): Promise<string> {
    const files = parseUnifiedPatch(patch);
    if (files.length === 0) {
      return JSON.stringify({ ok: false, error: "patch contains no file hunks" });
    }
    const plans: PatchWritePlan[] = [];
    for (const file of files) {
      const targetPath = file.newPath && file.newPath !== "/dev/null" ? file.newPath : file.oldPath;
      if (!targetPath || targetPath === "/dev/null") {
        return JSON.stringify({ ok: false, error: "patch target path is missing" });
      }
      const { abs, rel } = resolveSafe(stripDiffPrefix(targetPath));
      const oldContent = file.oldPath === "/dev/null" ? "" : await safeReadFile(abs, rel);
      const nextContent = applyHunks(oldContent, file.hunks, rel);
      if (file.newPath !== "/dev/null") {
        await assertWritePathSafe(abs, rel);
      }
      plans.push({ abs, rel, nextContent, delete: file.newPath === "/dev/null" });
    }

    const changed: string[] = [];
    for (const plan of plans) {
      if (plan.delete) {
        await unlink(plan.abs);
      } else {
        await safeWriteFile(plan.abs, plan.rel, plan.nextContent ?? "");
        written.add(plan.rel);
      }
      changed.push(plan.rel);
    }
    return JSON.stringify({ ok: true, changed });
  }

  async function runShellCommand(args: Record<string, unknown>): Promise<string> {
    const commandLine = typeof args.command === "string" ? args.command.trim() : "";
    if (!commandLine) {
      return JSON.stringify({ ok: false, error: "command is required" });
    }
    if (options.commandApprovalMode !== "allowlist") {
      return JSON.stringify({ ok: false, error: "shell.run requires command allowlist mode" });
    }
    const parsed = parseCommandLine(commandLine);
    if (!parsed) {
      return JSON.stringify({ ok: false, error: "could not parse command" });
    }
    const allowed = new Set(options.allowedCommands ?? []);
    if (!allowed.has(parsed.command)) {
      return JSON.stringify({ ok: false, error: `command not allowed: ${parsed.command}` });
    }
    const timeout = boundedNumber(args.timeoutMs ?? options.shellTimeoutMs, 30_000, 1_000, 120_000);
    try {
      const { stdout, stderr } = await execFileAsync(parsed.command, parsed.args, {
        cwd: root,
        timeout,
        maxBuffer: maxOutputBytes
      });
      return JSON.stringify({
        ok: true,
        command: parsed.command,
        args: parsed.args,
        stdout: truncateOutput(stdout, maxOutputBytes),
        stderr: truncateOutput(stderr, maxOutputBytes)
      });
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; code?: number | string; signal?: string };
      return JSON.stringify({
        ok: false,
        command: parsed.command,
        args: parsed.args,
        code: err.code,
        signal: err.signal,
        stdout: truncateOutput(err.stdout ?? "", maxOutputBytes),
        stderr: truncateOutput(err.stderr ?? err.message, maxOutputBytes)
      });
    }
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
          await safeWriteFile(abs, rel, content);
          written.add(rel);
          return JSON.stringify({ ok: true, path: rel, bytes: Buffer.byteLength(content, "utf8") });
        }
        if (name === FS_READ_TOOL) {
          const { abs, rel } = resolveSafe(String(args.path ?? ""));
          const content = await safeReadFile(abs, rel);
          return JSON.stringify({ ok: true, path: rel, content });
        }
        if (name === FS_LIST_TOOL) {
          const { abs, rel } = resolveSafe(String(args.path ?? ""));
          await assertRealPathInside(abs, rel);
          const entries = await readdir(abs, { withFileTypes: true });
          return JSON.stringify({
            ok: true,
            path: rel,
            entries: entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "dir" : "file" }))
          });
        }
        if (name === FS_SEARCH_TOOL) {
          return await searchFiles(args);
        }
        if (name === FS_APPLY_PATCH_TOOL) {
          return await applyPatch(typeof args.patch === "string" ? args.patch : String(args.patch ?? ""));
        }
        if (name === FS_SHELL_RUN_TOOL || name === "shell.run") {
          return await runShellCommand(args);
        }
        return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}

function buildTextMatcher(
  query: string,
  options: { regex: boolean; caseSensitive: boolean }
): (line: string) => number {
  if (options.regex) {
    const flags = options.caseSensitive ? "" : "i";
    const pattern = new RegExp(query, flags);
    return (line) => line.search(pattern);
  }
  const needle = options.caseSensitive ? query : query.toLowerCase();
  return (line) => (options.caseSensitive ? line : line.toLowerCase()).indexOf(needle);
}

function buildGlobMatcher(glob: string): (path: string) => boolean {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  let pattern = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      pattern += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      pattern += ".*";
      index += 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const regex = new RegExp(`^${pattern}$`);
  return (path) => regex.test(path.replace(/\\/g, "/"));
}

function stripDiffPrefix(path: string): string {
  return path.replace(/^(?:a|b)\//, "");
}

function parseUnifiedPatch(patch: string): PatchFile[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith("--- ")) {
      current = { oldPath: line.slice(4).trim().split(/\s+/)[0], hunks: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith("+++ ") && current) {
      current.newPath = line.slice(4).trim().split(/\s+/)[0];
      continue;
    }
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header && current) {
      const hunk: PatchHunk = {
        oldStart: Number(header[1]),
        oldLength: Number(header[2] ?? 1),
        newStart: Number(header[3]),
        newLength: Number(header[4] ?? 1),
        lines: []
      };
      i += 1;
      while (i < lines.length) {
        const hunkLine = lines[i]!;
        if (hunkLine.startsWith("\\ No newline at end of file")) {
          i += 1;
          continue;
        }
        if (hunkLine.startsWith("--- ") || hunkLine.startsWith("@@ ")) {
          i -= 1;
          break;
        }
        const prefix = hunkLine[0];
        const text = hunkLine.slice(1);
        if (prefix === " ") {
          hunk.lines.push({ kind: "context", text });
        } else if (prefix === "-") {
          hunk.lines.push({ kind: "remove", text });
        } else if (prefix === "+") {
          hunk.lines.push({ kind: "add", text });
        } else if (hunkLine.length > 0) {
          throw new Error(`invalid patch hunk line: ${hunkLine}`);
        }
        i += 1;
      }
      current.hunks.push(hunk);
    }
  }
  return files.filter((file) => file.hunks.length > 0);
}

function applyHunks(content: string, hunks: PatchHunk[], path: string): string {
  const hadFinalNewline = content.endsWith("\n");
  const original = content.length === 0 ? [] : content.replace(/\n$/, "").split("\n");
  const next: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const start = Math.max(0, hunk.oldStart - 1);
    if (start < cursor) {
      throw new Error(`overlapping patch hunks for ${path}`);
    }
    next.push(...original.slice(cursor, start));
    let index = start;
    for (const line of hunk.lines) {
      if (line.kind === "add") {
        next.push(line.text);
        continue;
      }
      if (original[index] !== line.text) {
        throw new Error(`patch context mismatch in ${path} at line ${index + 1}`);
      }
      if (line.kind === "context") {
        next.push(line.text);
      }
      index += 1;
    }
    cursor = index;
  }

  next.push(...original.slice(cursor));
  const changedHadFinalNewline = hunks.some((hunk) => hunk.lines.length > 0) ? true : hadFinalNewline;
  return next.join("\n") + (changedHadFinalNewline ? "\n" : "");
}

function parseCommandLine(commandLine: string): ParsedCommand | undefined {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let escaping = false;
  for (const char of commandLine) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote || escaping) {
    return undefined;
  }
  if (current) {
    tokens.push(current);
  }
  const [command, ...args] = tokens;
  return command ? { command, args } : undefined;
}

function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output, "utf8") <= maxBytes) {
    return output;
  }
  return `${output.slice(0, maxBytes)}\n...[truncated]`;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(numeric, max));
}
