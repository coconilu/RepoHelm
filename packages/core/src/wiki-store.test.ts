import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryWikiStore, SqliteWikiStore, type WikiStore } from "./wiki-store.js";
import type { RepoWikiPage, WikiChunkEmbedding } from "./types.js";

const page = (projectId: string, slug: RepoWikiPage["slug"]): RepoWikiPage => ({
  id: `wiki_${projectId}_${slug}`,
  projectId,
  slug,
  title: slug,
  body: `body ${slug}`,
  sourcePath: `/tmp/${projectId}/${slug}.md`,
  updatedAt: "2026-06-09T00:00:00.000Z"
});

const emb = (projectId: string, pageId: string, idx: number): WikiChunkEmbedding => ({
  id: `chunk_${pageId}_${idx}`,
  projectId,
  pageId,
  slug: "overview",
  chunkText: `chunk ${idx}`,
  vector: [idx, idx + 1],
  model: "test-embed",
  createdAt: "2026-06-09T00:00:00.000Z"
});

function suite(name: string, make: () => Promise<{ store: WikiStore; cleanup: () => Promise<void> }>) {
  describe(name, () => {
    let store: WikiStore;
    let cleanup: () => Promise<void>;
    beforeEach(async () => {
      ({ store, cleanup } = await make());
    });
    afterEach(async () => {
      await cleanup();
    });

    it("upserts and lists pages per project", async () => {
      await store.upsertPages([page("p1", "overview"), page("p2", "overview")]);
      const p1 = await store.listPages("p1");
      expect(p1.map((x) => x.slug)).toEqual(["overview"]);
    });

    it("upsert replaces an existing page by id", async () => {
      await store.upsertPages([page("p1", "overview")]);
      await store.upsertPages([{ ...page("p1", "overview"), body: "updated" }]);
      const pages = await store.listPages("p1");
      expect(pages).toHaveLength(1);
      expect(pages[0]!.body).toBe("updated");
    });

    it("replacePageEmbeddings swaps only that page's vectors", async () => {
      const pid = "wiki_p1_overview";
      await store.replacePageEmbeddings(pid, [emb("p1", pid, 0), emb("p1", pid, 1)]);
      await store.replacePageEmbeddings(pid, [emb("p1", pid, 9)]);
      const all = await store.listEmbeddings("p1");
      expect(all.map((e) => e.chunkText)).toEqual(["chunk 9"]);
    });

    it("deleteProject removes pages and embeddings", async () => {
      await store.upsertPages([page("p1", "overview")]);
      await store.replacePageEmbeddings("wiki_p1_overview", [emb("p1", "wiki_p1_overview", 0)]);
      await store.deleteProject("p1");
      expect(await store.listPages("p1")).toEqual([]);
      expect(await store.listEmbeddings("p1")).toEqual([]);
    });
  });
}

suite("InMemoryWikiStore", async () => ({
  store: new InMemoryWikiStore(),
  cleanup: async () => {}
}));

suite("SqliteWikiStore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-store-"));
  const store = new SqliteWikiStore(dir);
  return { store, cleanup: async () => rm(dir, { recursive: true, force: true }) };
});
