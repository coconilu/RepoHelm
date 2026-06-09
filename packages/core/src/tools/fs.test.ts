import { describe, expect, it } from "vitest";
import { extractFilesFromContent } from "./fs.js";

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

  it("de-dupes by path, last write wins", () => {
    const content = ["```a.txt", "first", "```", "```a.txt", "second", "```"].join("\n");
    expect(extractFilesFromContent(content)).toEqual([{ path: "a.txt", content: "second" }]);
  });
});
