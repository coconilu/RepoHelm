import { describe, expect, it, vi } from "vitest";
import { RepoWikiManager, type RepoWikiDeps } from "./repo-wiki.js";
import { InMemoryWikiStore } from "./wiki-store.js";
import type { RepoChangeSet } from "./git.js";

function makeDeps(over: Partial<RepoWikiDeps> = {}): RepoWikiDeps {
  return {
    resolveHead: async () => "headsha",
    countNewCommits: async () => 0,
    listKeyFiles: async () => [{ path: "README.md", content: "# Demo" }],
    collectChanges: async (): Promise<RepoChangeSet> => ({ commits: [], files: [] }),
    chatJson: async () => ({
      pages: {
        overview: "Demo project.",
        architecture: "Layers.",
        modules: "Mods.",
        "key-flows": "Flows.",
        conventions: "Rules.",
        decisions: "Initial index."
      }
    }),
    embed: async (texts: string[]) => texts.map((_, i) => [i + 1, i + 2]),
    ...over
  };
}

describe("RepoWikiManager.bootstrap", () => {
  it("creates 6 pages, stores embeddings, and records the head sha", async () => {
    const store = new InMemoryWikiStore();
    const mgr = new RepoWikiManager(store, makeDeps());

    const result = await mgr.bootstrap("p1", "/repo", "main");

    expect(result.lastIndexedSha).toBe("headsha");
    const pages = await store.listPages("p1");
    expect(pages.map((p) => p.slug).sort()).toEqual(
      ["architecture", "conventions", "decisions", "key-flows", "modules", "overview"]
    );
    expect((await store.listEmbeddings("p1")).length).toBeGreaterThan(0);
  });

  it("persists pages without vectors when embedding is unavailable", async () => {
    const store = new InMemoryWikiStore();
    const mgr = new RepoWikiManager(
      store,
      makeDeps({ embed: async () => { throw new Error("EMBEDDING_DISABLED"); } })
    );

    const result = await mgr.bootstrap("p1", "/repo", "main");

    expect(result.lastIndexedSha).toBe("headsha");
    expect((await store.listPages("p1")).length).toBe(6);
    expect(await store.listEmbeddings("p1")).toEqual([]);
  });
});

describe("RepoWikiManager.incremental", () => {
  it("rewrites only affected pages and re-embeds them", async () => {
    const store = new InMemoryWikiStore();
    const mgr = new RepoWikiManager(store, makeDeps());
    await mgr.bootstrap("p1", "/repo", "main");

    const incMgr = new RepoWikiManager(
      store,
      makeDeps({
        resolveHead: async () => "newsha",
        collectChanges: async () => ({
          commits: [{ sha: "abc1234", subject: "add cache" }],
          files: [{ path: "src/cache.ts", status: "A", diff: "+cache" }]
        }),
        chatJson: async () => ({
          updatedPages: { architecture: "Now with cache layer." },
          decisionEntry: "Added cache layer."
        })
      })
    );

    const result = await incMgr.incremental("p1", "/repo", "main", "headsha");

    expect(result.lastIndexedSha).toBe("newsha");
    const pages = await store.listPages("p1");
    const arch = pages.find((p) => p.slug === "architecture")!;
    expect(arch.body).toBe("Now with cache layer.");
    expect(arch.updatedAtSha).toBe("newsha");
    const decisions = pages.find((p) => p.slug === "decisions")!;
    expect(decisions.body).toContain("Added cache layer.");
    expect(decisions.body).toContain("abc1234");
  });
});

describe("RepoWikiManager.search", () => {
  it("ranks chunks by cosine and returns owning pages; embed is called for the query", async () => {
    const store = new InMemoryWikiStore();
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    const mgr = new RepoWikiManager(store, makeDeps({ embed }));
    await mgr.bootstrap("p1", "/repo", "main");

    const hits = await mgr.search(["p1"], "anything", 3);

    expect(embed).toHaveBeenCalledWith(["anything"]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveProperty("slug");
  });
});
