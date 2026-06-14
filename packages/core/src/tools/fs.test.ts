import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFsToolHandlers, extractFilesFromContent, FS_READ_TOOL } from "./fs.js";

async function worktree(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rh-fs-tool-"));
}

describe("extractFilesFromContent", () => {
  it("reads a path-tagged fenced code block", () => {
    const content = ["这是实现：", "```index.html", "<h1>hi</h1>", "```"].join("\n");
    expect(extractFilesFromContent(content)).toEqual([{ path: "index.html", content: "<h1>hi</h1>" }]);
  });

  it("supports a path=… info string", () => {
    const content = ["```html path=src/app.ts", "export const x = 1;", "```"].join("\n");
    expect(extractFilesFromContent(content)).toEqual([{ path: "src/app.ts", content: "export const x = 1;" }]);
  });

  it("falls back to a 'save as `path`' prose hint before a language fence", () => {
    const content = ["把下面内容存成 `index.html` 即可:", "```html", "<!DOCTYPE html><html></html>", "```"].join("\n");
    const files = extractFilesFromContent(content);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("index.html");
  });

  it("strips a leading project-dir segment so files land at the worktree root", () => {
    const content = ["```hello1/index.html", "<h1>hi</h1>", "```"].join("\n");
    expect(extractFilesFromContent(content, "hello1")).toEqual([{ path: "index.html", content: "<h1>hi</h1>" }]);
  });

  it("defaults a self-contained HTML document to index.html", () => {
    const content = ["```html", "<!DOCTYPE html>\n<html><body>hello world</body></html>", "```"].join("\n");
    const files = extractFilesFromContent(content);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("index.html");
  });

  it("ignores fences with no inferable path", () => {
    const content = ["运行：", "```bash", "npm test", "```"].join("\n");
    expect(extractFilesFromContent(content)).toEqual([]);
  });

  it("does not treat code member references as file paths for language fences", () => {
    const content = [
      "Added a live `import` + `console.log` example.",
      "",
      "```js",
      'console.log(listQuests());',
      "```"
    ].join("\n");
    expect(extractFilesFromContent(content)).toEqual([]);
  });

  it("de-dupes by path, last write wins", () => {
    const content = ["```a.txt", "first", "```", "```a.txt", "second", "```"].join("\n");
    expect(extractFilesFromContent(content)).toEqual([{ path: "a.txt", content: "second" }]);
  });
});

describe("buildFsToolHandlers read_file", () => {
  it("returns text content for a text file", async () => {
    const root = await worktree();
    await writeFile(join(root, "notes.md"), "# hello", "utf8");
    const fs = buildFsToolHandlers(root);

    const result = JSON.parse(await fs.handle(FS_READ_TOOL, { path: "notes.md" }));

    expect(result.ok).toBe(true);
    expect(result.content).toBe("# hello");
    expect(result.encoding).toBeUndefined();
  });

  it("returns base64 + mediaType for a PNG image", async () => {
    const root = await worktree();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
    await writeFile(join(root, "logo.png"), bytes);
    const fs = buildFsToolHandlers(root);

    const result = JSON.parse(await fs.handle(FS_READ_TOOL, { path: "logo.png" }));

    expect(result.ok).toBe(true);
    expect(result.encoding).toBe("base64");
    expect(result.mediaType).toBe("image/png");
    expect(Buffer.from(result.data, "base64").equals(bytes)).toBe(true);
  });

  it("returns application/pdf for a PDF file", async () => {
    const root = await worktree();
    await writeFile(join(root, "spec.pdf"), Buffer.from("%PDF-1.4 fake", "utf8"));
    const fs = buildFsToolHandlers(root);

    const result = JSON.parse(await fs.handle(FS_READ_TOOL, { path: "spec.pdf" }));

    expect(result.ok).toBe(true);
    expect(result.encoding).toBe("base64");
    expect(result.mediaType).toBe("application/pdf");
  });
});
