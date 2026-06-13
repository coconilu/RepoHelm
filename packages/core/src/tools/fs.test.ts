import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildFsToolHandlers,
  extractFilesFromContent,
  FS_APPLY_PATCH_TOOL,
  FS_READ_TOOL,
  FS_SEARCH_TOOL,
  FS_SHELL_RUN_TOOL,
  FS_WRITE_TOOL,
  fsToolSpecs
} from "./fs.js";

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

describe("buildFsToolHandlers", () => {
  async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), "repohelm-fs-tools-"));
    try {
      return await fn(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("exposes apply_patch to workers", () => {
    const names = fsToolSpecs.map((spec) => spec.function.name);
    expect(names).toContain(FS_APPLY_PATCH_TOOL);
  });

  it("searches matching text files inside the worktree", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root);
      await fs.handle(FS_WRITE_TOOL, { path: "src/app.ts", content: "export const marker = 42;\n" });
      await fs.handle(FS_WRITE_TOOL, { path: "README.md", content: "marker in docs\n" });

      const result = JSON.parse(await fs.handle(FS_SEARCH_TOOL, {
        query: "marker",
        glob: "src/**/*.ts"
      }));

      expect(result).toMatchObject({
        ok: true,
        results: [{ path: "src/app.ts", line: 1, column: 14, match: "export const marker = 42;" }],
        truncated: false
      });
    });
  });

  it("falls back to bounded defaults for invalid search limits", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root);
      await fs.handle(FS_WRITE_TOOL, { path: "a.txt", content: "needle\n" });

      const result = JSON.parse(await fs.handle(FS_SEARCH_TOOL, {
        query: "needle",
        maxResults: Number.NaN
      }));

      expect(result).toMatchObject({ ok: true, results: [{ path: "a.txt" }], truncated: false });
    });
  });

  it("applies a context-checked unified patch", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root);
      await fs.handle(FS_WRITE_TOOL, { path: "src/app.ts", content: "const a = 1;\nconst b = 2;\n" });

      const result = JSON.parse(await fs.handle(FS_APPLY_PATCH_TOOL, {
        patch: [
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1,2 +1,2 @@",
          " const a = 1;",
          "-const b = 2;",
          "+const b = 3;",
          ""
        ].join("\n")
      }));

      expect(result).toEqual({ ok: true, changed: ["src/app.ts"] });
      await expect(readFile(join(root, "src/app.ts"), "utf8")).resolves.toBe("const a = 1;\nconst b = 3;\n");
      expect([...fs.written]).toContain("src/app.ts");
    });
  });

  it("applies a unified patch that creates a new file", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root);

      const result = JSON.parse(await fs.handle(FS_APPLY_PATCH_TOOL, {
        patch: [
          "--- /dev/null",
          "+++ b/src/new-tool.ts",
          "@@ -0,0 +1,2 @@",
          "+export const added = true;",
          "+export const label = 'new';",
          ""
        ].join("\n")
      }));

      expect(result).toEqual({ ok: true, changed: ["src/new-tool.ts"] });
      await expect(readFile(join(root, "src/new-tool.ts"), "utf8")).resolves.toBe(
        "export const added = true;\nexport const label = 'new';\n"
      );
      expect([...fs.written]).toContain("src/new-tool.ts");
    });
  });

  it("rejects patches whose context does not match", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root);
      await fs.handle(FS_WRITE_TOOL, { path: "src/app.ts", content: "const a = 1;\n" });

      const result = JSON.parse(await fs.handle(FS_APPLY_PATCH_TOOL, {
        patch: [
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1,1 +1,1 @@",
          "-const missing = true;",
          "+const a = 2;",
          ""
        ].join("\n")
      }));

      expect(result.ok).toBe(false);
      expect(result.error).toContain("patch context mismatch");
      await expect(readFile(join(root, "src/app.ts"), "utf8")).resolves.toBe("const a = 1;\n");
    });
  });

  it("does not write earlier files when a later patch hunk fails", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root);
      await fs.handle(FS_WRITE_TOOL, { path: "a.txt", content: "alpha\n" });
      await fs.handle(FS_WRITE_TOOL, { path: "b.txt", content: "bravo\n" });

      const result = JSON.parse(await fs.handle(FS_APPLY_PATCH_TOOL, {
        patch: [
          "--- a/a.txt",
          "+++ b/a.txt",
          "@@ -1,1 +1,1 @@",
          "-alpha",
          "+changed",
          "--- a/b.txt",
          "+++ b/b.txt",
          "@@ -1,1 +1,1 @@",
          "-missing",
          "+changed",
          ""
        ].join("\n")
      }));

      expect(result.ok).toBe(false);
      await expect(readFile(join(root, "a.txt"), "utf8")).resolves.toBe("alpha\n");
      await expect(readFile(join(root, "b.txt"), "utf8")).resolves.toBe("bravo\n");
    });
  });

  it("does not create parent directories when a later patch hunk fails", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root);
      await fs.handle(FS_WRITE_TOOL, { path: "existing.txt", content: "stable\n" });

      const result = JSON.parse(await fs.handle(FS_APPLY_PATCH_TOOL, {
        patch: [
          "--- /dev/null",
          "+++ b/newdir/file.txt",
          "@@ -0,0 +1 @@",
          "+new content",
          "--- a/existing.txt",
          "+++ b/existing.txt",
          "@@ -1,1 +1,1 @@",
          "-missing",
          "+changed",
          ""
        ].join("\n")
      }));

      expect(result.ok).toBe(false);
      await expect(readdir(root)).resolves.not.toContain("newdir");
      await expect(readFile(join(root, "existing.txt"), "utf8")).resolves.toBe("stable\n");
    });
  });

  it("keeps tool paths confined to the worktree root", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root);
      const result = JSON.parse(await fs.handle(FS_WRITE_TOOL, { path: "../escape.txt", content: "nope" }));
      expect(result).toEqual({ ok: false, error: "path escapes worktree: ../escape.txt" });
    });
  });

  it("rejects symlinks that point outside the worktree", async () => {
    await withTempRoot(async (root) => {
      const outsideRoot = await mkdtemp(join(tmpdir(), "repohelm-fs-outside-"));
      try {
        const outsideFile = join(outsideRoot, "outside.txt");
        await writeFile(outsideFile, "external\n", "utf8");
        await symlink(outsideFile, join(root, "link.txt"));
        const fs = buildFsToolHandlers(root);

        const readResult = JSON.parse(await fs.handle(FS_READ_TOOL, { path: "link.txt" }));
        const searchResult = JSON.parse(await fs.handle(FS_SEARCH_TOOL, { path: "link.txt", query: "external" }));
        const writeResult = JSON.parse(await fs.handle(FS_WRITE_TOOL, { path: "link.txt", content: "changed\n" }));
        const patchResult = JSON.parse(await fs.handle(FS_APPLY_PATCH_TOOL, {
          patch: [
            "--- a/link.txt",
            "+++ b/link.txt",
            "@@ -1,1 +1,1 @@",
            "-external",
            "+changed",
            ""
          ].join("\n")
        }));

        expect(readResult.ok).toBe(false);
        expect(searchResult.ok).toBe(false);
        expect(writeResult.ok).toBe(false);
        expect(patchResult.ok).toBe(false);
        await expect(readFile(outsideFile, "utf8")).resolves.toBe("external\n");
      } finally {
        await rm(outsideRoot, { recursive: true, force: true });
      }
    });
  });

  it("does not create directories through symlinked parents outside the worktree", async () => {
    await withTempRoot(async (root) => {
      const outsideRoot = await mkdtemp(join(tmpdir(), "repohelm-fs-outside-dir-"));
      try {
        await symlink(outsideRoot, join(root, "linkdir"));
        const fs = buildFsToolHandlers(root);

        const writeResult = JSON.parse(await fs.handle(FS_WRITE_TOOL, {
          path: "linkdir/sub/file.txt",
          content: "changed\n"
        }));
        const patchResult = JSON.parse(await fs.handle(FS_APPLY_PATCH_TOOL, {
          patch: [
            "--- /dev/null",
            "+++ b/linkdir/sub/from-patch.txt",
            "@@ -0,0 +1 @@",
            "+changed",
            ""
          ].join("\n")
        }));

        expect(writeResult.ok).toBe(false);
        expect(patchResult.ok).toBe(false);
        await expect(readdir(outsideRoot)).resolves.toEqual([]);
      } finally {
        await rm(outsideRoot, { recursive: true, force: true });
      }
    });
  });

  it("runs allowlisted commands inside the worktree without a shell", async () => {
    await withTempRoot(async (root) => {
      await writeFile(join(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf8");
      const fs = buildFsToolHandlers(root, {
        commandApprovalMode: "allowlist",
        allowedCommands: ["node"]
      });

      const result = JSON.parse(await fs.handle(FS_SHELL_RUN_TOOL, {
        command: "node -e \"console.log(process.cwd().endsWith('repohelm-fs-tools-') ? 'bad' : require('./package.json').name)\""
      }));

      expect(result).toMatchObject({
        ok: true,
        command: "node",
        stdout: "fixture\n",
        stderr: ""
      });
    });
  });

  it("denies non-allowlisted shell commands", async () => {
    await withTempRoot(async (root) => {
      const fs = buildFsToolHandlers(root, {
        commandApprovalMode: "allowlist",
        allowedCommands: ["node"]
      });

      const result = JSON.parse(await fs.handle(FS_SHELL_RUN_TOOL, { command: "git status" }));

      expect(result).toEqual({ ok: false, error: "command not allowed: git" });
    });
  });
});
