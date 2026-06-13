import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSearchToolHandler, SEARCH_TOOL } from "./search.js";

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rh-search-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/app.ts"), "export function start() {\n  return loadConfig();\n}\n", "utf8");
  await writeFile(join(root, "src/config.ts"), "export function loadConfig() {\n  return {};\n}\n", "utf8");
  await mkdir(join(root, "node_modules/pkg"), { recursive: true });
  await writeFile(join(root, "node_modules/pkg/index.js"), "function loadConfig() {}\n", "utf8");
  return root;
}

describe("buildSearchToolHandler", () => {
  it("finds a literal match and returns file path and line number", async () => {
    const root = await fixtureRepo();
    const handler = buildSearchToolHandler(root);

    const result = JSON.parse(await handler.handle(SEARCH_TOOL, { query: "loadConfig" }));

    expect(result.ok).toBe(true);
    const hits = result.matches.map((m: { file: string; line: number }) => `${m.file}:${m.line}`);
    expect(hits).toContain("src/app.ts:2");
    expect(hits).toContain("src/config.ts:1");
    const appHit = result.matches.find((m: { file: string }) => m.file === "src/app.ts");
    expect(appHit.text).toContain("loadConfig");
  });

  it("skips node_modules and .git", async () => {
    const root = await fixtureRepo();
    const handler = buildSearchToolHandler(root);

    const result = JSON.parse(await handler.handle(SEARCH_TOOL, { query: "loadConfig" }));
    const files = result.matches.map((m: { file: string }) => m.file);
    expect(files.some((f: string) => f.includes("node_modules"))).toBe(false);
  });

  it("scopes the search to a sub-path when given", async () => {
    const root = await fixtureRepo();
    const handler = buildSearchToolHandler(root);

    const result = JSON.parse(await handler.handle(SEARCH_TOOL, { query: "loadConfig", path: "src/config.ts" }));
    const files = result.matches.map((m: { file: string }) => m.file);
    expect(files).toEqual(["src/config.ts"]);
  });

  it("returns an empty match list when nothing matches", async () => {
    const root = await fixtureRepo();
    const handler = buildSearchToolHandler(root);

    const result = JSON.parse(await handler.handle(SEARCH_TOOL, { query: "nonexistent_symbol_xyz" }));
    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("caps the number of results at maxResults", async () => {
    const root = await fixtureRepo();
    const handler = buildSearchToolHandler(root);

    const result = JSON.parse(await handler.handle(SEARCH_TOOL, { query: "loadConfig", maxResults: 1 }));
    expect(result.matches.length).toBe(1);
  });
});
