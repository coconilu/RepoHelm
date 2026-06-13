import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEditToolHandler, EDIT_TOOL } from "./edit.js";

async function worktreeWith(file: string, content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rh-edit-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, file), content, "utf8");
  return root;
}

describe("buildEditToolHandler", () => {
  it("replaces a unique snippet and leaves the rest of the file intact", async () => {
    const root = await worktreeWith("src/app.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const handler = buildEditToolHandler(root);

    const raw = await handler.handle(EDIT_TOOL, {
      path: "src/app.ts",
      oldText: "const b = 2;",
      newText: "const b = 42;"
    });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(handler.written.has("src/app.ts")).toBe(true);
    const after = await readFile(join(root, "src/app.ts"), "utf8");
    expect(after).toBe("const a = 1;\nconst b = 42;\nconst c = 3;\n");
  });

  it("errors when oldText is not found", async () => {
    const root = await worktreeWith("src/app.ts", "const a = 1;\n");
    const handler = buildEditToolHandler(root);

    const result = JSON.parse(await handler.handle(EDIT_TOOL, { path: "src/app.ts", oldText: "nope", newText: "x" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("refuses an ambiguous edit unless replaceAll is set", async () => {
    const root = await worktreeWith("src/app.ts", "x = 1;\nx = 1;\n");
    const handler = buildEditToolHandler(root);

    const ambiguous = JSON.parse(await handler.handle(EDIT_TOOL, { path: "src/app.ts", oldText: "x = 1;", newText: "x = 2;" }));
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toMatch(/not unique|ambiguous|multiple/i);

    const all = JSON.parse(
      await handler.handle(EDIT_TOOL, { path: "src/app.ts", oldText: "x = 1;", newText: "x = 2;", replaceAll: true })
    );
    expect(all.ok).toBe(true);
    expect(await readFile(join(root, "src/app.ts"), "utf8")).toBe("x = 2;\nx = 2;\n");
  });

  it("errors when the target file does not exist", async () => {
    const root = await worktreeWith("src/app.ts", "x\n");
    const handler = buildEditToolHandler(root);

    const result = JSON.parse(await handler.handle(EDIT_TOOL, { path: "src/missing.ts", oldText: "x", newText: "y" }));
    expect(result.ok).toBe(false);
  });

  it("rejects paths that escape the worktree", async () => {
    const root = await worktreeWith("src/app.ts", "x\n");
    const handler = buildEditToolHandler(root);

    const result = JSON.parse(await handler.handle(EDIT_TOOL, { path: "../outside.ts", oldText: "x", newText: "y" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/escape/i);
  });
});
