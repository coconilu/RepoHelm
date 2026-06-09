# Repo-Bound Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unusable workspace-scoped knowledge base with a repo-bound, structured Repo Wiki that is incrementally maintained from new commits on the repo's tracked branch and retrieved via embeddings (with keyword fallback).

**Architecture:** Knowledge becomes scoped to a `Project` (repo). Each repo owns a fixed set of 6 Markdown wiki pages (Markdown = source of truth) plus SQLite-stored chunk embeddings. Opening the knowledge panel lazily compares the tracked branch HEAD against the last-indexed SHA and, if newer commits exist, offers an incremental update that feeds the diff to the LLM to rewrite only affected pages. Retrieval embeds the query and ranks chunks by cosine similarity; if no embedding ModelKit is configured it falls back to keyword matching.

**Tech Stack:** TypeScript (ES2022/ESNext, ESM with `.js` import suffix), `node:sqlite` (`DatabaseSync`), `node:child_process` git, Hono REST (server), React 19 + Vite (web), Vitest (unit), Playwright (e2e). Reuses existing ModelKit/`llm.ts` for chat + a new embeddings call.

**Spec:** `docs/superpowers/specs/2026-06-09-repo-bound-knowledge-base-design.md`

---

## File Structure

**Create:**
- `packages/core/src/vector.ts` — pure vector/text utils: cosine similarity, markdown chunking, top-k ranking. No I/O.
- `packages/core/src/vector.test.ts` — unit tests for vector utils.
- `packages/core/src/wiki-store.ts` — `WikiStore` interface, `SqliteWikiStore` (own connection to `.repohelm/state.sqlite`, WAL, `wiki_pages` + `wiki_embeddings` tables), and `InMemoryWikiStore` for tests.
- `packages/core/src/wiki-store.test.ts` — unit tests for `InMemoryWikiStore` + `SqliteWikiStore`.
- `packages/core/src/repo-wiki.ts` — `RepoWikiManager`: pure orchestration of bootstrap / incremental / lazy-detect / retrieval, with git + LLM + embed injected as function deps.
- `packages/core/src/repo-wiki.test.ts` — unit tests using fake deps.

**Modify:**
- `packages/core/src/types.ts` — add `RepoWikiSlug`, `RepoWikiPage`, `WikiChunkEmbedding`, `ProjectKnowledgeMeta`; extend `Project`; add `EngineConfig.embeddingModelKitId`; add `ProjectKnowledgeView`.
- `packages/core/src/llm.ts` — add `embedWithModelKit()`.
- `packages/core/src/git.ts` — add public read helpers: `resolveRef`, `countCommitsBetween`, `collectChangesBetween`, `listTrackedFiles`.
- `packages/core/src/store.ts` — `defaultEngineConfig` keeps `embeddingModelKitId` optional (no change needed beyond migration tolerance); ensure `migrateEngine` preserves it.
- `packages/core/src/service.ts` — construct `RepoWikiManager` + `WikiStore`; add `getProjectKnowledge`, `syncProjectKnowledge`, `setProjectKnowledgeBranch`, `searchProjectKnowledge`; wire Quest spec consumption; drop legacy seed knowledge.
- `packages/core/src/index.ts` — re-export new modules.
- `apps/server/src/index.ts` — construct `SqliteWikiStore`; add `GET/POST/PATCH /api/projects/:id/knowledge*` routes.
- `apps/web/src/api.ts` — add `ProjectKnowledgeView` type + `getProjectKnowledge`, `syncProjectKnowledge`, `setKnowledgeBranch`.
- `apps/web/src/App.tsx` — repo-grouped knowledge panel with status bar + "N new commits" update affordance; engine-config embedding ModelKit field.
- `e2e/` — new spec for bootstrap → new commit → update flow (mock LLM/embed via injected env or API).

---

## Phase 1 — Data model & vector utils (no behavior wiring yet)

### Task 1: Domain types

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add wiki + project knowledge types**

Add near the existing `KnowledgeItem` block (after line 234):

```ts
export type RepoWikiSlug =
  | "overview"
  | "architecture"
  | "modules"
  | "key-flows"
  | "conventions"
  | "decisions";

export const REPO_WIKI_SLUGS: RepoWikiSlug[] = [
  "overview",
  "architecture",
  "modules",
  "key-flows",
  "conventions",
  "decisions"
];

export interface RepoWikiPage {
  id: string;            // wiki_<projectId>_<slug>
  projectId: string;
  slug: RepoWikiSlug;
  title: string;
  body: string;          // Markdown, source of truth
  sourcePath: string;    // .repohelm/knowledge/<projectId>/<slug>.md
  updatedAtSha?: string;
  updatedAt: string;
}

export interface WikiChunkEmbedding {
  id: string;            // chunk_<pageId>_<idx>
  projectId: string;
  pageId: string;
  slug: RepoWikiSlug;
  chunkText: string;
  vector: number[];
  model: string;         // embedding model that produced the vector
  createdAt: string;
}

export type ProjectKnowledgeStatus = "empty" | "indexing" | "ready" | "stale" | "error";

export interface ProjectKnowledgeMeta {
  lastIndexedSha?: string;
  lastIndexedAt?: string;
  status: ProjectKnowledgeStatus;
  error?: string;
}

/** Read model returned to the UI: pages + freshly computed staleness. */
export interface ProjectKnowledgeView {
  projectId: string;
  knowledgeBranch: string;
  status: ProjectKnowledgeStatus;
  pendingCommits: number;   // commits in lastIndexedSha..HEAD; 0 when fresh/unknown
  head?: string;
  lastIndexedSha?: string;
  lastIndexedAt?: string;
  error?: string;
  pages: RepoWikiPage[];
}
```

- [ ] **Step 2: Extend `Project`**

In the `Project` interface (lines 47-57) add two optional fields before `createdAt`:

```ts
  knowledgeBranch?: string;          // KB truth branch; defaults to defaultBranch
  knowledge?: ProjectKnowledgeMeta;  // persisted index metadata
```

- [ ] **Step 3: Extend `EngineConfig`**

In `EngineConfig` (lines 349-357) add before `updatedAt`:

```ts
  embeddingModelKitId?: string;      // BYOK ModelKit used for /embeddings; unset => keyword fallback
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @repohelm/core build`
Expected: PASS (compiles; new fields are optional so no existing call site breaks).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "Add repo wiki and project knowledge domain types"
```

---

### Task 2: Vector utilities

**Files:**
- Create: `packages/core/src/vector.ts`
- Test: `packages/core/src/vector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/vector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cosineSimilarity, chunkMarkdown, topKBySimilarity } from "./vector.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("returns 0 when either vector is all zeros", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("chunkMarkdown", () => {
  it("keeps short text as a single chunk", () => {
    expect(chunkMarkdown("hello world", 100)).toEqual(["hello world"]);
  });

  it("splits on paragraph boundaries and respects maxChars", () => {
    const text = ["a".repeat(60), "b".repeat(60)].join("\n\n");
    const chunks = chunkMarkdown(text, 80);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("a".repeat(60));
    expect(chunks[1]).toBe("b".repeat(60));
  });

  it("hard-splits a single oversized paragraph", () => {
    const chunks = chunkMarkdown("x".repeat(250), 100);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });
});

describe("topKBySimilarity", () => {
  it("ranks by descending similarity and limits to k", () => {
    const items = [
      { id: "a", vector: [1, 0] },
      { id: "b", vector: [0, 1] },
      { id: "c", vector: [0.9, 0.1] }
    ];
    const ranked = topKBySimilarity([1, 0], items, 2);
    expect(ranked.map((r) => r.item.id)).toEqual(["a", "c"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repohelm/core test -t "cosineSimilarity"`
Expected: FAIL — cannot find module `./vector.js`.

- [ ] **Step 3: Implement `vector.ts`**

Create `packages/core/src/vector.ts`:

```ts
/** Cosine similarity of two equal-length numeric vectors. Returns 0 if either is zero-length or all zeros. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Split Markdown into chunks no longer than `maxChars`, preferring blank-line
 * (paragraph) boundaries and hard-splitting any paragraph that is itself too long.
 */
export function chunkMarkdown(text: string, maxChars = 1200): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length === 0) {
      current = para;
    } else if (current.length + 2 + para.length <= maxChars) {
      current = `${current}\n\n${para}`;
    } else {
      flush();
      current = para;
    }
  }
  flush();
  return chunks;
}

/** Rank `items` (each carrying a `vector`) by cosine similarity to `query`, returning the top `k`. */
export function topKBySimilarity<T extends { vector: number[] }>(
  query: number[],
  items: T[],
  k: number
): Array<{ item: T; score: number }> {
  return items
    .map((item) => ({ item, score: cosineSimilarity(query, item.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repohelm/core test -t "cosineSimilarity"` then `pnpm --filter @repohelm/core test -t "chunkMarkdown"` and `pnpm --filter @repohelm/core test -t "topKBySimilarity"`
Expected: PASS (all three describe blocks green).

- [ ] **Step 5: Re-export + commit**

Add to `packages/core/src/index.ts` (after the `./store.js` line):

```ts
export * from "./vector.js";
```

```bash
git add packages/core/src/vector.ts packages/core/src/vector.test.ts packages/core/src/index.ts
git commit -m "Add vector utilities for wiki chunk retrieval"
```

---

## Phase 2 — Storage & embedding client

### Task 3: WikiStore (in-memory + sqlite)

**Files:**
- Create: `packages/core/src/wiki-store.ts`
- Test: `packages/core/src/wiki-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/wiki-store.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repohelm/core test -t "InMemoryWikiStore"`
Expected: FAIL — cannot find module `./wiki-store.js`.

- [ ] **Step 3: Implement `wiki-store.ts`**

Create `packages/core/src/wiki-store.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RepoWikiPage, WikiChunkEmbedding } from "./types.js";

export interface WikiStore {
  listPages(projectId: string): Promise<RepoWikiPage[]>;
  upsertPages(pages: RepoWikiPage[]): Promise<void>;
  listEmbeddings(projectId: string): Promise<WikiChunkEmbedding[]>;
  replacePageEmbeddings(pageId: string, embeddings: WikiChunkEmbedding[]): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

export class InMemoryWikiStore implements WikiStore {
  private pages = new Map<string, RepoWikiPage>();
  private embeddings = new Map<string, WikiChunkEmbedding>();

  async listPages(projectId: string): Promise<RepoWikiPage[]> {
    return [...this.pages.values()].filter((p) => p.projectId === projectId);
  }

  async upsertPages(pages: RepoWikiPage[]): Promise<void> {
    for (const page of pages) {
      this.pages.set(page.id, page);
    }
  }

  async listEmbeddings(projectId: string): Promise<WikiChunkEmbedding[]> {
    return [...this.embeddings.values()].filter((e) => e.projectId === projectId);
  }

  async replacePageEmbeddings(pageId: string, embeddings: WikiChunkEmbedding[]): Promise<void> {
    for (const [id, e] of this.embeddings) {
      if (e.pageId === pageId) {
        this.embeddings.delete(id);
      }
    }
    for (const e of embeddings) {
      this.embeddings.set(e.id, e);
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    for (const [id, p] of this.pages) {
      if (p.projectId === projectId) this.pages.delete(id);
    }
    for (const [id, e] of this.embeddings) {
      if (e.projectId === projectId) this.embeddings.delete(id);
    }
  }
}

/** Shares the `.repohelm/state.sqlite` file with SqliteStateStore via a separate WAL connection. */
export class SqliteWikiStore implements WikiStore {
  readonly dbPath: string;
  private db?: DatabaseSync;

  constructor(rootDir: string) {
    this.dbPath = join(rootDir, ".repohelm", "state.sqlite");
  }

  private database(): DatabaseSync {
    if (this.db) {
      return this.db;
    }
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS wiki_pages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_project ON wiki_pages(project_id);
      CREATE TABLE IF NOT EXISTS wiki_embeddings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_emb_project ON wiki_embeddings(project_id);
      CREATE INDEX IF NOT EXISTS idx_wiki_emb_page ON wiki_embeddings(page_id);
    `);
    this.db = db;
    return db;
  }

  async listPages(projectId: string): Promise<RepoWikiPage[]> {
    const rows = this.database()
      .prepare("SELECT payload FROM wiki_pages WHERE project_id = ?")
      .all(projectId) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as RepoWikiPage);
  }

  async upsertPages(pages: RepoWikiPage[]): Promise<void> {
    const stmt = this.database().prepare(
      `INSERT INTO wiki_pages (id, project_id, payload) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, payload = excluded.payload`
    );
    for (const page of pages) {
      stmt.run(page.id, page.projectId, JSON.stringify(page));
    }
  }

  async listEmbeddings(projectId: string): Promise<WikiChunkEmbedding[]> {
    const rows = this.database()
      .prepare("SELECT payload FROM wiki_embeddings WHERE project_id = ?")
      .all(projectId) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as WikiChunkEmbedding);
  }

  async replacePageEmbeddings(pageId: string, embeddings: WikiChunkEmbedding[]): Promise<void> {
    const db = this.database();
    db.prepare("DELETE FROM wiki_embeddings WHERE page_id = ?").run(pageId);
    const stmt = db.prepare(
      "INSERT INTO wiki_embeddings (id, project_id, page_id, payload) VALUES (?, ?, ?, ?)"
    );
    for (const e of embeddings) {
      stmt.run(e.id, e.projectId, e.pageId, JSON.stringify(e));
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = this.database();
    db.prepare("DELETE FROM wiki_pages WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM wiki_embeddings WHERE project_id = ?").run(projectId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repohelm/core test -t "InMemoryWikiStore"` and `pnpm --filter @repohelm/core test -t "SqliteWikiStore"`
Expected: PASS for both suites.

- [ ] **Step 5: Re-export + commit**

Add to `packages/core/src/index.ts`:

```ts
export * from "./wiki-store.js";
```

```bash
git add packages/core/src/wiki-store.ts packages/core/src/wiki-store.test.ts packages/core/src/index.ts
git commit -m "Add WikiStore (in-memory + sqlite) for wiki pages and embeddings"
```

---

### Task 4: Embedding client

**Files:**
- Modify: `packages/core/src/llm.ts`
- Test: `packages/core/src/llm.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/llm.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { embedWithModelKit } from "./llm.js";
import type { ModelKit } from "./types.js";

const kit: ModelKit = {
  id: "mk_embed",
  name: "embed",
  type: "byok",
  providerId: "openai",
  model: "text-embedding-3-small",
  config: { provider: "openai", baseUrl: "https://api.example.com/v1", model: "text-embedding-3-small", apiKey: "sk-test" },
  metadata: { createdAt: "", testedAt: "", costTier: "low", performanceProfile: "fast" }
};

afterEach(() => vi.restoreAllMocks());

describe("embedWithModelKit", () => {
  it("posts to /embeddings and returns vectors ordered by index", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] }
        ] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const vectors = await embedWithModelKit(kit, ["a", "b"]);

    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/embeddings");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: "text-embedding-3-small",
      input: ["a", "b"]
    });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500, statusText: "err" })));
    await expect(embedWithModelKit(kit, ["a"])).rejects.toThrow(/embeddings/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repohelm/core test -t "embedWithModelKit"`
Expected: FAIL — `embedWithModelKit` is not exported.

- [ ] **Step 3: Implement `embedWithModelKit`**

In `packages/core/src/llm.ts`, after `callLlmWithModelKit` (end of file), reuse the existing private `resolveByok`. Add:

```ts
/** OpenAI-compatible embeddings call. Returns one vector per input, ordered to match `texts`. */
export async function embedWithModelKit(
  modelKit: ModelKit,
  texts: string[],
  signal?: AbortSignal
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const { apiKey, baseUrl, model } = resolveByok(modelKit);
  const endpoint = `${baseUrl.replace(/\/$/, "")}/embeddings`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
    signal
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Embeddings call to ${endpoint} failed (${response.status}): ${response.statusText} ${text}`);
  }

  const payload = (await response.json()) as { data?: Array<{ index?: number; embedding: number[] }> };
  const data = payload.data ?? [];
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((d) => d.embedding);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repohelm/core test -t "embedWithModelKit"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm.ts packages/core/src/llm.test.ts
git commit -m "Add OpenAI-compatible embeddings client"
```

---

### Task 5: Git read helpers

**Files:**
- Modify: `packages/core/src/git.ts`
- Test: `packages/core/src/git.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/git.test.ts` (drives a real temp git repo):

```ts
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitWorktreeManager } from "./git.js";

const run = promisify(execFile);

describe("GitWorktreeManager read helpers", () => {
  let dir: string;
  const git = (args: string[]) => run("git", args, { cwd: dir });
  const mgr = new GitWorktreeManager();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "git-read-"));
    await git(["init", "-q", "-b", "main"]);
    await git(["config", "user.email", "t@t.dev"]);
    await git(["config", "user.name", "t"]);
    await writeFile(join(dir, "a.txt"), "one\n");
    await git(["add", "."]);
    await git(["commit", "-q", "-m", "first"]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolveRef returns the branch HEAD sha", async () => {
    const head = await mgr.resolveRef(dir, "main");
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("countCommitsBetween counts new commits", async () => {
    const before = await mgr.resolveRef(dir, "main");
    await writeFile(join(dir, "b.txt"), "two\n");
    await git(["add", "."]);
    await git(["commit", "-q", "-m", "second"]);
    expect(await mgr.countCommitsBetween(dir, before, "main")).toBe(1);
  });

  it("collectChangesBetween returns commit messages and per-file diffs", async () => {
    const before = await mgr.resolveRef(dir, "main");
    await writeFile(join(dir, "a.txt"), "one\ntwo\n");
    await git(["commit", "-aqm", "edit a"]);
    const changes = await mgr.collectChangesBetween(dir, before, "main");
    expect(changes.commits.map((c) => c.subject)).toContain("edit a");
    expect(changes.files.some((f) => f.path === "a.txt")).toBe(true);
    expect(changes.files.find((f) => f.path === "a.txt")!.diff).toContain("two");
  });

  it("listTrackedFiles returns committed files", async () => {
    const files = await mgr.listTrackedFiles(dir, "main");
    expect(files).toContain("a.txt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repohelm/core test -t "read helpers"`
Expected: FAIL — `resolveRef` etc. are not methods on `GitWorktreeManager`.

- [ ] **Step 3: Add `RepoChangeSet` type + helpers**

In `packages/core/src/git.ts`, add an exported type near the top (after imports) and four public methods inside the `GitWorktreeManager` class (the class already has a private `git(cwd, args)` helper at line 301 — reuse it):

```ts
export interface RepoCommitSummary {
  sha: string;
  subject: string;
}

export interface RepoFileChange {
  path: string;
  status: string; // git name-status letter (A/M/D/R...)
  diff: string;
}

export interface RepoChangeSet {
  commits: RepoCommitSummary[];
  files: RepoFileChange[];
}
```

Methods (add as public members of `GitWorktreeManager`):

```ts
  async resolveRef(repoPath: string, ref: string): Promise<string> {
    return (await this.git(repoPath, ["rev-parse", ref])).trim();
  }

  async countCommitsBetween(repoPath: string, from: string, toRef: string): Promise<number> {
    const out = (await this.git(repoPath, ["rev-list", "--count", `${from}..${toRef}`])).trim();
    return Number.parseInt(out || "0", 10);
  }

  async listTrackedFiles(repoPath: string, ref: string): Promise<string[]> {
    const out = await this.git(repoPath, ["ls-tree", "-r", "--name-only", ref]);
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async collectChangesBetween(repoPath: string, from: string, toRef: string): Promise<RepoChangeSet> {
    const logOut = await this.git(repoPath, [
      "log",
      "--no-merges",
      "--pretty=format:%H%x1f%s",
      `${from}..${toRef}`
    ]);
    const commits: RepoCommitSummary[] = logOut
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, subject] = line.split("\x1f");
        return { sha: sha ?? "", subject: subject ?? "" };
      });

    const nameStatus = await this.git(repoPath, ["diff", "--name-status", `${from}..${toRef}`]);
    const files: RepoFileChange[] = [];
    for (const line of nameStatus.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const parts = line.split(/\t+/);
      const status = parts[0] ?? "M";
      const path = parts[parts.length - 1] ?? "";
      if (!path) continue;
      const diff = await this.gitAllowingDiffExit(repoPath, ["diff", `${from}..${toRef}`, "--", path]);
      files.push({ path, status, diff });
    }
    return { commits, files };
  }
```

> Note: `git`, `gitAllowingDiffExit` are existing private methods on the class; the new public methods sit alongside them.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repohelm/core test -t "read helpers"`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/git.ts packages/core/src/git.test.ts
git commit -m "Add git read helpers for wiki indexing"
```

---

## Phase 3 — Wiki manager (pure orchestration)

### Task 6: RepoWikiManager — bootstrap & incremental & retrieval

**Files:**
- Create: `packages/core/src/repo-wiki.ts`
- Test: `packages/core/src/repo-wiki.test.ts`

The manager holds NO service/git/llm singletons; it takes injectable deps so it is unit-testable with fakes. The service (Task 7) supplies real deps.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/repo-wiki.test.ts`:

```ts
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
});

describe("RepoWikiManager.incremental", () => {
  it("rewrites only affected pages and re-embeds them", async () => {
    const store = new InMemoryWikiStore();
    const base = makeDeps();
    const mgr = new RepoWikiManager(store, base);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repohelm/core test -t "RepoWikiManager.bootstrap"`
Expected: FAIL — cannot find module `./repo-wiki.js`.

- [ ] **Step 3: Implement `repo-wiki.ts`**

Create `packages/core/src/repo-wiki.ts`:

```ts
import type { RepoChangeSet } from "./git.js";
import type { WikiStore } from "./wiki-store.js";
import { chunkMarkdown, topKBySimilarity } from "./vector.js";
import { REPO_WIKI_SLUGS, type RepoWikiPage, type RepoWikiSlug, type WikiChunkEmbedding } from "./types.js";

const PAGE_TITLES: Record<RepoWikiSlug, string> = {
  overview: "概览",
  architecture: "架构",
  modules: "模块",
  "key-flows": "关键流程",
  conventions: "约定",
  decisions: "决策日志"
};

const MAX_DIFF_CHARS = 40_000;

export interface KeyFile {
  path: string;
  content: string;
}

export interface WikiSearchHit {
  projectId: string;
  pageId: string;
  slug: RepoWikiSlug;
  chunkText: string;
  score: number;
}

/** Injectable side-effect deps. The service wires git + llm; tests pass fakes. */
export interface RepoWikiDeps {
  resolveHead(repoPath: string, ref: string): Promise<string>;
  countNewCommits(repoPath: string, from: string, ref: string): Promise<number>;
  listKeyFiles(repoPath: string, ref: string): Promise<KeyFile[]>;
  collectChanges(repoPath: string, from: string, ref: string): Promise<RepoChangeSet>;
  /** Calls the chat model and returns parsed JSON. Throws if the model returns non-JSON. */
  chatJson(prompt: string): Promise<any>;
  embed(texts: string[]): Promise<number[][]>;
}

export interface IndexResult {
  lastIndexedSha: string;
  lastIndexedAt: string;
}

const nowIso = () => new Date().toISOString();

export class RepoWikiManager {
  constructor(
    private readonly store: WikiStore,
    private readonly deps: RepoWikiDeps,
    private readonly writePageFile?: (page: RepoWikiPage) => Promise<string>
  ) {}

  async resolveHead(repoPath: string, ref: string): Promise<string> {
    return this.deps.resolveHead(repoPath, ref);
  }

  async countNewCommits(repoPath: string, ref: string, from: string): Promise<number> {
    return this.deps.countNewCommits(repoPath, from, ref);
  }

  async bootstrap(projectId: string, repoPath: string, ref: string): Promise<IndexResult> {
    const head = await this.deps.resolveHead(repoPath, ref);
    const keyFiles = await this.deps.listKeyFiles(repoPath, ref);
    const prompt = this.bootstrapPrompt(keyFiles);
    const parsed = await this.deps.chatJson(prompt);
    const bodies: Record<string, string> = parsed?.pages ?? {};

    const pages: RepoWikiPage[] = [];
    for (const slug of REPO_WIKI_SLUGS) {
      pages.push(await this.buildPage(projectId, slug, String(bodies[slug] ?? ""), head));
    }
    await this.store.upsertPages(pages);
    await this.store.deleteProject(projectId); // clear stale embeddings only
    await this.store.upsertPages(pages);
    for (const page of pages) {
      await this.embedPage(page);
    }
    return { lastIndexedSha: head, lastIndexedAt: nowIso() };
  }

  async incremental(projectId: string, repoPath: string, ref: string, from: string): Promise<IndexResult> {
    const head = await this.deps.resolveHead(repoPath, ref);
    const changes = await this.deps.collectChanges(repoPath, from, ref);
    const existing = await this.store.listPages(projectId);
    const byslug = new Map(existing.map((p) => [p.slug, p]));

    const prompt = this.incrementalPrompt(existing, changes);
    const parsed = await this.deps.chatJson(prompt);
    const updated: Record<string, string> = parsed?.updatedPages ?? {};
    const decisionEntry: string | undefined = parsed?.decisionEntry;

    const touched: RepoWikiPage[] = [];
    for (const slug of Object.keys(updated) as RepoWikiSlug[]) {
      if (!REPO_WIKI_SLUGS.includes(slug)) continue;
      touched.push(await this.buildPage(projectId, slug, String(updated[slug] ?? ""), head));
    }

    if (decisionEntry) {
      const shortSha = changes.commits[0]?.sha.slice(0, 7) ?? head.slice(0, 7);
      const prior = byslug.get("decisions");
      const priorBody = touched.find((p) => p.slug === "decisions")?.body ?? prior?.body ?? "";
      const entryLine = `- ${decisionEntry} (commit ${shortSha})`;
      const merged = `${entryLine}\n${priorBody}`.trim();
      const idx = touched.findIndex((p) => p.slug === "decisions");
      const decisionsPage = await this.buildPage(projectId, "decisions", merged, head);
      if (idx >= 0) touched[idx] = decisionsPage;
      else touched.push(decisionsPage);
    }

    await this.store.upsertPages(touched);
    for (const page of touched) {
      await this.embedPage(page);
    }
    return { lastIndexedSha: head, lastIndexedAt: nowIso() };
  }

  async search(projectIds: string[], query: string, k: number): Promise<WikiSearchHit[]> {
    const [queryVec] = await this.deps.embed([query]);
    if (!queryVec) return [];
    const all: WikiChunkEmbedding[] = [];
    for (const pid of projectIds) {
      all.push(...(await this.store.listEmbeddings(pid)));
    }
    return topKBySimilarity(queryVec, all, k).map(({ item, score }) => ({
      projectId: item.projectId,
      pageId: item.pageId,
      slug: item.slug,
      chunkText: item.chunkText,
      score
    }));
  }

  private async buildPage(
    projectId: string,
    slug: RepoWikiSlug,
    body: string,
    sha: string
  ): Promise<RepoWikiPage> {
    const page: RepoWikiPage = {
      id: `wiki_${projectId}_${slug}`,
      projectId,
      slug,
      title: PAGE_TITLES[slug],
      body,
      sourcePath: "",
      updatedAtSha: sha,
      updatedAt: nowIso()
    };
    if (this.writePageFile) {
      page.sourcePath = await this.writePageFile(page);
    }
    return page;
  }

  private async embedPage(page: RepoWikiPage): Promise<void> {
    const chunks = chunkMarkdown(page.body);
    if (chunks.length === 0) {
      await this.store.replacePageEmbeddings(page.id, []);
      return;
    }
    let vectors: number[][];
    try {
      vectors = await this.deps.embed(chunks);
    } catch {
      // No embedding ModelKit configured (or embed failed): persist the page WITHOUT
      // vectors so it stays usable via keyword fallback, instead of failing the sync.
      await this.store.replacePageEmbeddings(page.id, []);
      return;
    }
    const embeddings: WikiChunkEmbedding[] = chunks.map((chunkText, idx) => ({
      id: `chunk_${page.id}_${idx}`,
      projectId: page.projectId,
      pageId: page.id,
      slug: page.slug,
      chunkText,
      vector: vectors[idx] ?? [],
      model: "configured",
      createdAt: nowIso()
    }));
    await this.store.replacePageEmbeddings(page.id, embeddings);
  }

  private bootstrapPrompt(keyFiles: KeyFile[]): string {
    const files = keyFiles
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 4000)}\n\`\`\``)
      .join("\n\n");
    return [
      "你是代码库知识库生成器。基于下面的关键文件,为这个仓库生成 6 页结构化 wiki。",
      "只返回 JSON,形如 {\"pages\":{\"overview\":\"...\",\"architecture\":\"...\",\"modules\":\"...\",\"key-flows\":\"...\",\"conventions\":\"...\",\"decisions\":\"初次建立知识库。\"}}。",
      "每页用中文 Markdown,简洁准确。",
      "",
      files
    ].join("\n");
  }

  private incrementalPrompt(pages: RepoWikiPage[], changes: RepoChangeSet): string {
    const current = pages.map((p) => `## ${p.slug}\n${p.body}`).join("\n\n");
    const commitList = changes.commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.subject}`).join("\n");
    let diffText = changes.files.map((f) => `### ${f.status} ${f.path}\n${f.diff}`).join("\n\n");
    if (diffText.length > MAX_DIFF_CHARS) {
      diffText = changes.files
        .map((f) => `### ${f.status} ${f.path}\n${f.diff.split("\n").slice(0, 20).join("\n")}\n...(truncated)`)
        .join("\n\n");
    }
    return [
      "你在维护一个仓库的结构化 wiki。下面是当前 6 页内容,以及一批新提交的 diff。",
      "判断哪些页需要更新,只返回受影响页的新全文。",
      "只返回 JSON: {\"updatedPages\":{\"<slug>\":\"<新全文>\"},\"decisionEntry\":\"<一句话决策摘要,可省略>\"}。",
      "slug 必须是 overview/architecture/modules/key-flows/conventions/decisions 之一。decisions 页不要自己改,用 decisionEntry。",
      "",
      "# 当前 wiki",
      current,
      "",
      "# 新提交",
      commitList,
      "",
      "# 变更 diff",
      diffText
    ].join("\n");
  }
}
```

> Design note: `bootstrap` calls `deleteProject` to clear any stale embeddings from a prior index, then re-upserts the fresh pages before embedding. The double `upsertPages` is intentional — pages first so they survive the embedding clear, then embeddings are rebuilt per page.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @repohelm/core test -t "RepoWikiManager"`
Expected: PASS (bootstrap, incremental, search).

- [ ] **Step 5: Re-export + commit**

Add to `packages/core/src/index.ts`:

```ts
export * from "./repo-wiki.js";
```

```bash
git add packages/core/src/repo-wiki.ts packages/core/src/repo-wiki.test.ts packages/core/src/index.ts
git commit -m "Add RepoWikiManager bootstrap/incremental/search orchestration"
```

---

## Phase 4 — Service wiring

### Task 7: Service methods + KnowledgeFileStore per-repo writer + Quest consumption

**Files:**
- Modify: `packages/core/src/knowledge.ts` (add per-repo page writer)
- Modify: `packages/core/src/service.ts`
- Test: `packages/core/src/service-knowledge.test.ts` (create)

- [ ] **Step 1: Add a per-repo Markdown writer to `KnowledgeFileStore`**

In `packages/core/src/knowledge.ts`, add a method to the `KnowledgeFileStore` class (keep the existing `writeKnowledgeItem`/`writeProjectSummary`; `writeProjectSummary` will be removed from callers in a later step but leave the method to avoid breaking other references until then):

```ts
  async writeWikiPage(page: {
    projectId: string;
    slug: string;
    title: string;
    body: string;
  }): Promise<string> {
    const dir = join(this.rootDir, page.projectId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${page.slug}.md`);
    await writeFile(filePath, `# ${page.title}\n\n${page.body}\n`, "utf8");
    return filePath;
  }
```

- [ ] **Step 2: Write the failing test (service-level, deps faked via embedding-less fallback)**

Create `packages/core/src/service-knowledge.test.ts`. It uses an `InMemoryWikiStore` and a fake state store, and stubs the engine to have no embedding ModelKit so `searchProjectKnowledge` exercises the keyword fallback path:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepoHelmService } from "./service.js";
import { SqliteStateStore } from "./store.js";
import { InMemoryWikiStore } from "./wiki-store.js";

describe("RepoHelmService project knowledge", () => {
  let dir: string;
  let service: RepoHelmService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "svc-knowledge-"));
    service = new RepoHelmService(new SqliteStateStore(dir), dir, {
      knowledgeRootDir: join(dir, "knowledge"),
      wikiStore: new InMemoryWikiStore()
    });
    await service.bootstrap();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("getProjectKnowledge reports empty status before indexing", async () => {
    const project = await service.createProject({ name: "Demo", path: dir, defaultBranch: "main" });
    const view = await service.getProjectKnowledge(project.id);
    expect(view.status).toBe("empty");
    expect(view.pages).toEqual([]);
  });

  it("setProjectKnowledgeBranch persists the branch", async () => {
    const project = await service.createProject({ name: "Demo", path: dir, defaultBranch: "main" });
    const updated = await service.setProjectKnowledgeBranch(project.id, "develop");
    expect(updated.knowledgeBranch).toBe("develop");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @repohelm/core test -t "project knowledge"`
Expected: FAIL — `wikiStore` option / `getProjectKnowledge` / `setProjectKnowledgeBranch` do not exist.

- [ ] **Step 4: Wire the service**

In `packages/core/src/service.ts`:

(a) Add imports at top:

```ts
import { RepoWikiManager, type RepoWikiDeps, type KeyFile } from "./repo-wiki.js";
import { InMemoryWikiStore, type WikiStore } from "./wiki-store.js";
import { embedWithModelKit } from "./llm.js";
import { callLlmWithModelKit } from "./llm.js"; // if not already imported
import type { ProjectKnowledgeView, RepoWikiPage } from "./types.js";
```

(b) Extend the constructor options + fields (constructor at line 82):

```ts
  private readonly wikiStore: WikiStore;
  private readonly repoWiki: RepoWikiManager;
```

```ts
  constructor(
    private readonly store: StateStore,
    private readonly rootDir: string,
    options: { knowledgeRootDir?: string; worktreeRootDir?: string; wikiStore?: WikiStore } = {}
  ) {
    this.worktreeRootDir = options.worktreeRootDir ?? join(rootDir, ".repohelm", "worktrees");
    this.knowledgeFileStore = new KnowledgeFileStore(options.knowledgeRootDir ?? join(rootDir, ".repohelm", "knowledge"));
    this.questWorkspaceManager = new QuestWorkspaceManager(rootDir);
    this.wikiStore = options.wikiStore ?? new InMemoryWikiStore();
    this.repoWiki = new RepoWikiManager(this.wikiStore, this.buildWikiDeps(), (page) =>
      this.knowledgeFileStore.writeWikiPage(page)
    );
  }
```

(c) Add the deps builder + embedding resolution as private methods:

```ts
  private buildWikiDeps(): RepoWikiDeps {
    return {
      resolveHead: (repoPath, ref) => this.gitWorktreeManager.resolveRef(repoPath, ref),
      countNewCommits: (repoPath, from, ref) => this.gitWorktreeManager.countCommitsBetween(repoPath, from, ref),
      listKeyFiles: (repoPath, ref) => this.collectKeyFiles(repoPath, ref),
      collectChanges: (repoPath, from, ref) => this.gitWorktreeManager.collectChangesBetween(repoPath, from, ref),
      chatJson: (prompt) => this.chatJson(prompt),
      embed: (texts) => this.embedTexts(texts)
    };
  }

  private async resolveChatModelKit(): Promise<import("./types.js").ModelKit> {
    const state = await this.getState();
    const kits = Object.values(state.engine.modelKits ?? {});
    const kit = kits.find((k) => k.type === "byok");
    if (!kit) {
      throw new Error("没有可用于知识库生成的 BYOK ModelKit。请在引擎设置里配置。");
    }
    return kit;
  }

  private async resolveEmbeddingModelKit(): Promise<import("./types.js").ModelKit | undefined> {
    const state = await this.getState();
    const id = state.engine.embeddingModelKitId;
    if (!id) return undefined;
    return state.engine.modelKits?.[id];
  }

  private async chatJson(prompt: string): Promise<any> {
    const kit = await this.resolveChatModelKit();
    const result = await callLlmWithModelKit({
      modelKit: kit,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    });
    const text = result.content.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(text);
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    const kit = await this.resolveEmbeddingModelKit();
    if (!kit) {
      throw new Error("EMBEDDING_DISABLED");
    }
    return embedWithModelKit(kit, texts);
  }

  private async collectKeyFiles(repoPath: string, ref: string): Promise<KeyFile[]> {
    const KEY = ["README.md", "package.json", "Cargo.toml", "pyproject.toml", "go.mod", "AGENTS.md", "CLAUDE.md"];
    const tracked = await this.gitWorktreeManager.listTrackedFiles(repoPath, ref);
    const picks = tracked.filter((f) => KEY.includes(f.split("/").pop() ?? "")).slice(0, 12);
    const files: KeyFile[] = [];
    for (const path of picks) {
      try {
        const content = await readFile(join(repoPath, path), "utf8");
        files.push({ path, content });
      } catch {
        // skip unreadable files
      }
    }
    if (files.length === 0) {
      files.push({ path: "(file tree)", content: tracked.slice(0, 200).join("\n") });
    }
    return files;
  }
```

> `readFile` is already imported in service.ts via `node:fs/promises` (it imports `access`); add `readFile` to that import if missing.

(d) Add the public API methods (place near the old `searchKnowledge` at line 1566):

```ts
  async getProjectKnowledge(projectId: string): Promise<ProjectKnowledgeView> {
    const state = await this.getState();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    const branch = project.knowledgeBranch ?? project.defaultBranch;
    const meta = project.knowledge;
    const pages = await this.wikiStore.listPages(projectId);

    const base: ProjectKnowledgeView = {
      projectId,
      knowledgeBranch: branch,
      status: meta?.status ?? "empty",
      pendingCommits: 0,
      lastIndexedSha: meta?.lastIndexedSha,
      lastIndexedAt: meta?.lastIndexedAt,
      error: meta?.error,
      pages
    };

    if (!meta?.lastIndexedSha) {
      return { ...base, status: pages.length > 0 ? base.status : "empty" };
    }
    try {
      const head = await this.gitWorktreeManager.resolveRef(project.path, branch);
      base.head = head;
      if (head !== meta.lastIndexedSha) {
        base.pendingCommits = await this.gitWorktreeManager.countCommitsBetween(project.path, meta.lastIndexedSha, branch);
        base.status = base.status === "indexing" ? "indexing" : "stale";
      } else {
        base.status = "ready";
      }
    } catch {
      // repo unreachable / not git: keep persisted status, no staleness
    }
    return base;
  }

  async syncProjectKnowledge(projectId: string): Promise<ProjectKnowledgeView> {
    const project = (await this.getState()).projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    const branch = project.knowledgeBranch ?? project.defaultBranch;
    await this.patchProjectKnowledgeMeta(projectId, { status: "indexing", error: undefined });
    try {
      const from = project.knowledge?.lastIndexedSha;
      const result = from
        ? await this.repoWiki.incremental(projectId, project.path, branch, from)
        : await this.repoWiki.bootstrap(projectId, project.path, branch);
      await this.patchProjectKnowledgeMeta(projectId, {
        status: "ready",
        lastIndexedSha: result.lastIndexedSha,
        lastIndexedAt: result.lastIndexedAt,
        error: undefined
      });
    } catch (error) {
      await this.patchProjectKnowledgeMeta(projectId, {
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return this.getProjectKnowledge(projectId);
  }

  async setProjectKnowledgeBranch(projectId: string, branch: string): Promise<Project> {
    return this.mutateState(async (state) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) throw new Error("Project not found");
      const updated: Project = { ...project, knowledgeBranch: branch, updatedAt: now() };
      const projects = state.projects.map((p) => (p.id === projectId ? updated : p));
      return { newState: { ...state, projects }, result: updated };
    });
  }

  async searchProjectKnowledge(projectIds: string[], query: string): Promise<RepoWikiPage[]> {
    if (projectIds.length === 0) return [];
    try {
      const hits = await this.repoWiki.search(projectIds, query, 6);
      const pages = (await Promise.all(projectIds.map((pid) => this.wikiStore.listPages(pid)))).flat();
      const byId = new Map(pages.map((p) => [p.id, p]));
      const seen = new Set<string>();
      const result: RepoWikiPage[] = [];
      for (const hit of hits) {
        if (seen.has(hit.pageId)) continue;
        seen.add(hit.pageId);
        const page = byId.get(hit.pageId);
        if (page) result.push(page);
      }
      return result;
    } catch (error) {
      // EMBEDDING_DISABLED or any embed failure -> keyword fallback
      const pages = (await Promise.all(projectIds.map((pid) => this.wikiStore.listPages(pid)))).flat();
      return this.keywordSearchPages(pages, query).slice(0, 6);
    }
  }

  private keywordSearchPages(pages: RepoWikiPage[], query: string): RepoWikiPage[] {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    const tokens = q.split(/\s+/).filter(Boolean);
    return pages.filter((p) => {
      const hay = `${p.title}\n${p.body}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
  }

  private async patchProjectKnowledgeMeta(
    projectId: string,
    patch: Partial<import("./types.js").ProjectKnowledgeMeta>
  ): Promise<void> {
    await this.mutateState(async (state) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return { newState: state, result: undefined };
      const knowledge = { status: "empty" as const, ...project.knowledge, ...patch };
      const updated: Project = { ...project, knowledge, updatedAt: now() };
      const projects = state.projects.map((p) => (p.id === projectId ? updated : p));
      return { newState: { ...state, projects }, result: undefined };
    });
  }
```

(e) **Drop legacy seed knowledge.** In `bootstrap()` (lines 155-178) remove the `architectureKnowledge` block and the `knowledge` array, and set `knowledge: []` in `nextState`. In `createProject` (lines 264-269) remove the `writeProjectSummary` call and set `knowledge` unchanged (`knowledge: state.knowledge`). In `updateProject` (lines 297-299) remove the `projectSummary`/`knowledge` recomputation and just write `{ ...state, projects }`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @repohelm/core test -t "project knowledge"`
Expected: PASS (empty status + branch persistence).

- [ ] **Step 6: Keep the old `searchKnowledge` consumer working**

Update the Quest spec consumption at `service.ts:1007`. Replace the `searchKnowledgeItems(state.knowledge, ...)` call so it pulls from repo wikis of the workspace's projects:

```ts
    const workspace = state.workspaces.find((w) => w.id === input.workspaceId);
    const relatedPages = workspace
      ? await this.searchProjectKnowledge(workspace.projectIds, input.requirement)
      : [];
    const relatedKnowledge = relatedPages.slice(0, 3);
```

`generateSpec` and the `knowledge.retrieved` event only read `relatedKnowledge.length`, so they keep working with the new `RepoWikiPage[]` shape. Verify `generateSpec`'s parameter type accepts the new shape — change its signature from `relatedKnowledge: KnowledgeItem[]` to `relatedKnowledge: Array<{ title: string }>` (it only uses `.length`).

- [ ] **Step 7: Build + full core test**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/core test`
Expected: PASS — all core tests green, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/service.ts packages/core/src/knowledge.ts packages/core/src/service-knowledge.test.ts
git commit -m "Wire repo wiki indexing and retrieval into RepoHelmService"
```

---

## Phase 5 — Server & web

### Task 8: Server routes

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Construct the WikiStore and pass it to the service**

At the service construction site (around line 37), import `SqliteWikiStore` and inject it:

```ts
import { RepoHelmService, SqliteStateStore, SqliteWikiStore } from "@repohelm/core";
```

```ts
const service = new RepoHelmService(new SqliteStateStore(stateRootDir), rootDir, {
  knowledgeRootDir,
  worktreeRootDir,
  wikiStore: new SqliteWikiStore(stateRootDir)
});
```

- [ ] **Step 2: Add the three routes**

Near the existing `GET /api/workspaces/:id/knowledge` (line 287), add:

```ts
app.get("/api/projects/:id/knowledge", async (context) => {
  const view = await service.getProjectKnowledge(context.req.param("id"));
  return context.json(view);
});

app.post("/api/projects/:id/knowledge/sync", async (context) => {
  const view = await service.syncProjectKnowledge(context.req.param("id"));
  return context.json(view);
});

const knowledgeBranchSchema = z.object({ knowledgeBranch: z.string().min(1) });

app.patch("/api/projects/:id/knowledge", async (context) => {
  const input = knowledgeBranchSchema.parse(await context.req.json());
  const project = await service.setProjectKnowledgeBranch(context.req.param("id"), input.knowledgeBranch);
  return context.json(project);
});
```

> `z` is already imported at the top of `index.ts` (used by other routes). If not, add `import { z } from "zod";`.

- [ ] **Step 3: Typecheck the server**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/server typecheck` (or `pnpm typecheck`)
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Run (in one shell): `pnpm dev`
Then in another shell:
```bash
curl -s localhost:4300/api/projects/project_repohelm/knowledge | head -c 400
```
Expected: JSON with `"status":"empty"` (or `"ready"` after a sync), `"pages":[]`, HTTP 200.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "Add project knowledge REST routes"
```

---

### Task 9: Web API client

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add the view type**

Near the existing `KnowledgeItem` type (line 225), add:

```ts
export type ProjectKnowledgeStatus = "empty" | "indexing" | "ready" | "stale" | "error";

export interface RepoWikiPage {
  id: string;
  projectId: string;
  slug: "overview" | "architecture" | "modules" | "key-flows" | "conventions" | "decisions";
  title: string;
  body: string;
  sourcePath: string;
  updatedAtSha?: string;
  updatedAt: string;
}

export interface ProjectKnowledgeView {
  projectId: string;
  knowledgeBranch: string;
  status: ProjectKnowledgeStatus;
  pendingCommits: number;
  head?: string;
  lastIndexedSha?: string;
  lastIndexedAt?: string;
  error?: string;
  pages: RepoWikiPage[];
}
```

- [ ] **Step 2: Add the three client methods**

In the `api` object (after `searchKnowledge`, line 461):

```ts
  getProjectKnowledge: (projectId: string) =>
    request<ProjectKnowledgeView>(`/api/projects/${projectId}/knowledge`),
  syncProjectKnowledge: (projectId: string) =>
    request<ProjectKnowledgeView>(`/api/projects/${projectId}/knowledge/sync`, { method: "POST" }),
  setKnowledgeBranch: (projectId: string, knowledgeBranch: string) =>
    request<Project>(`/api/projects/${projectId}/knowledge`, {
      method: "PATCH",
      body: JSON.stringify({ knowledgeBranch })
    }),
```

> `Project` type is already defined/imported in `api.ts` (used by project routes). Confirm it exists; if the response type differs, use the existing project shape.

- [ ] **Step 3: Typecheck web**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/web typecheck` (or `pnpm typecheck`)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "Add project knowledge API client methods"
```

---

### Task 10: Web knowledge panel (repo-grouped + update affordance)

**Files:**
- Modify: `apps/web/src/App.tsx`

This replaces the workspace-knowledge list rendering with a per-repo wiki view. Styling uses existing CSS tokens/classes — do not hardcode colors.

- [ ] **Step 1: Add state + loader for the selected repo's knowledge**

In the component that renders the knowledge section, add state and a loader (match the file's existing `useState`/`useEffect` + `api` usage patterns):

```tsx
const [knowledge, setKnowledge] = useState<ProjectKnowledgeView | null>(null);
const [knowledgeProjectId, setKnowledgeProjectId] = useState<string | null>(null);
const [syncing, setSyncing] = useState(false);

const loadKnowledge = useCallback(async (projectId: string) => {
  setKnowledgeProjectId(projectId);
  const view = await api.getProjectKnowledge(projectId);
  setKnowledge(view);
}, []);

const runSync = useCallback(async () => {
  if (!knowledgeProjectId) return;
  setSyncing(true);
  try {
    const view = await api.syncProjectKnowledge(knowledgeProjectId);
    setKnowledge(view);
  } finally {
    setSyncing(false);
  }
}, [knowledgeProjectId]);
```

Import the new type at the top alongside other `api` imports:

```tsx
import { api, type ProjectKnowledgeView /*, …existing imports */ } from "./api";
```

- [ ] **Step 2: Render the status bar + pages**

Replace the existing knowledge list markup with a repo selector + status bar + 6-page render. Reuse existing panel/card class names from the file:

```tsx
{knowledge && (
  <div className="knowledge-panel">
    <div className="knowledge-status">
      <span>分支: {knowledge.knowledgeBranch}</span>
      <span>状态: {knowledge.status}</span>
      {knowledge.lastIndexedAt && <span>上次索引: {new Date(knowledge.lastIndexedAt).toLocaleString()}</span>}
      {knowledge.status === "stale" && knowledge.pendingCommits > 0 && (
        <button disabled={syncing} onClick={runSync}>
          有 {knowledge.pendingCommits} 个新提交,更新知识库
        </button>
      )}
      {knowledge.status === "empty" && (
        <button disabled={syncing} onClick={runSync}>建立知识库</button>
      )}
      {knowledge.status === "ready" && (
        <button disabled={syncing} onClick={runSync}>重新索引</button>
      )}
      {syncing && <span>索引中…</span>}
      {knowledge.error && <span className="knowledge-error">{knowledge.error}</span>}
    </div>
    <div className="knowledge-pages">
      {knowledge.pages.map((page) => (
        <section key={page.id} className="knowledge-page">
          <h3>{page.title}</h3>
          <pre className="knowledge-body">{page.body}</pre>
        </section>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Trigger load when a repo is selected**

Wherever a repo/project is chosen in the knowledge view, call `loadKnowledge(project.id)`. If the knowledge tab lists global repos, default to loading the first project on mount via a `useEffect` that depends on the projects list.

- [ ] **Step 4: Add minimal token-driven styles**

In `apps/web/src/styles.css`, add (reuse existing CSS custom properties for colors/spacing; example uses tokens already present in the file — substitute the actual token names used in the project):

```css
.knowledge-status { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.knowledge-pages { display: grid; gap: var(--space-4); margin-top: var(--space-4); }
.knowledge-body { white-space: pre-wrap; font: inherit; background: var(--surface-2); padding: var(--space-3); border-radius: var(--radius-2); }
.knowledge-error { color: var(--text-danger); }
```

- [ ] **Step 5: Build + manual check**

Run: `pnpm build`
Expected: web build succeeds.

Then `pnpm dev`, open the Knowledge view, select the RepoHelm repo, click "建立知识库" (requires a BYOK chat ModelKit configured; if none, expect the panel to show an `error` status with the "没有可用于知识库生成的 BYOK ModelKit" message — that is correct behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "Add repo-grouped knowledge panel with incremental update affordance"
```

---

### Task 11: Engine-config embedding ModelKit field

**Files:**
- Modify: `apps/web/src/App.tsx` (engine settings section)
- Modify: `apps/server/src/index.ts` (allow updating `embeddingModelKitId`)
- Modify: `packages/core/src/service.ts` (accept it in engine update) + `packages/core/src/types.ts` (`UpdateEngineInput`)

- [ ] **Step 1: Extend `UpdateEngineInput`**

In `packages/core/src/types.ts` (`UpdateEngineInput`, lines 359-365) add:

```ts
  embeddingModelKitId?: string;
```

- [ ] **Step 2: Persist it in the engine updater**

Find the engine update method in `service.ts` (search `updateEngine`). Add `embeddingModelKitId` to the merged config, mirroring how other optional fields are applied:

```ts
      embeddingModelKitId:
        input.embeddingModelKitId ?? state.engine.embeddingModelKitId,
```

- [ ] **Step 3: Accept it in the server Zod schema**

In `apps/server/src/index.ts`, find the engine update schema (search `engine` route) and add `embeddingModelKitId: z.string().optional()` to the object.

- [ ] **Step 4: Add the UI control**

In the engine settings section of `App.tsx`, add a `<select>` listing existing BYOK ModelKits (the component already renders ModelKits) bound to `embeddingModelKitId`, calling the existing engine-update API on change. Include an empty option labelled "未启用（关键词检索）".

- [ ] **Step 5: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/service.ts apps/server/src/index.ts apps/web/src/App.tsx
git commit -m "Add embedding ModelKit selection to engine config"
```

---

## Phase 6 — End-to-end

### Task 12: E2E flow (mocked LLM/embed)

**Files:**
- Create: `e2e/knowledge.spec.ts`

E2E must not call real models. Drive the flow through the API with a real temp git repo, mocking model access. The simplest reliable approach: add a test-only env switch read by the service so `chatJson`/`embedTexts` return canned data when `REPOHELM_FAKE_MODELS=1`. (Follow the existing e2e injection pattern noted in the `repohelm-delivery-validation-gap` memory.)

- [ ] **Step 1: Add the fake-models switch in the service**

In `service.ts`, in `chatJson` short-circuit at the top:

```ts
    if (process.env.REPOHELM_FAKE_MODELS === "1") {
      return JSON.parse(process.env.REPOHELM_FAKE_CHAT_JSON ?? "{}");
    }
```

And in `embedTexts`:

```ts
    if (process.env.REPOHELM_FAKE_MODELS === "1") {
      return texts.map((_, i) => [Math.sin(i + 1), Math.cos(i + 1)]);
    }
```

- [ ] **Step 2: Write the e2e spec**

Create `e2e/knowledge.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// Assumes the dev server is started by Playwright config with REPOHELM_FAKE_MODELS=1
// and REPOHELM_FAKE_CHAT_JSON set to a 6-page bootstrap payload.

test("bootstrap then stale-detect on a repo", async ({ request }) => {
  // Use the demo project seeded by bootstrap.
  const before = await request.get("/api/projects/project_repohelm/knowledge");
  expect(before.ok()).toBeTruthy();
  const beforeBody = await before.json();
  expect(["empty", "ready", "stale"]).toContain(beforeBody.status);

  const synced = await request.post("/api/projects/project_repohelm/knowledge/sync");
  expect(synced.ok()).toBeTruthy();
  const syncedBody = await synced.json();
  expect(syncedBody.status === "ready" || syncedBody.status === "error").toBeTruthy();
  if (syncedBody.status === "ready") {
    expect(syncedBody.pages.length).toBe(6);
  }
});
```

- [ ] **Step 3: Set env in Playwright config**

In `playwright.config.ts`, in the `webServer.env` block (or wherever dev env is set), add:

```ts
REPOHELM_FAKE_MODELS: "1",
REPOHELM_FAKE_CHAT_JSON: JSON.stringify({
  pages: {
    overview: "Demo overview.",
    architecture: "Demo architecture.",
    modules: "Demo modules.",
    "key-flows": "Demo flows.",
    conventions: "Demo conventions.",
    decisions: "初次建立知识库。"
  }
}),
```

- [ ] **Step 4: Run the e2e**

Run: `pnpm test:e2e -g "bootstrap then stale-detect"`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add e2e/knowledge.spec.ts playwright.config.ts packages/core/src/service.ts
git commit -m "Add e2e for repo knowledge bootstrap flow"
```

---

## Phase 7 — Docs & final verification

### Task 13: Update docs + full verification

**Files:**
- Modify: `CLAUDE.md`, `AGENTS.md` (keep in sync per CLAUDE.md note)

- [ ] **Step 1: Document the new env var + knowledge model**

Add to the "Agent backend env vars" / conventions area of `CLAUDE.md` and mirror in `AGENTS.md`:

```markdown
- Knowledge base is repo-scoped: each Project owns 6 Markdown wiki pages under
  `.repohelm/knowledge/<projectId>/` plus chunk embeddings in `wiki_pages`/`wiki_embeddings`
  (same sqlite file). Indexing needs a BYOK chat ModelKit; vector retrieval needs
  `engine.embeddingModelKitId` (else keyword fallback). `REPOHELM_FAKE_MODELS=1` returns
  canned model output for e2e.
```

- [ ] **Step 2: Full verification suite**

Run: `pnpm test:all`
Expected: typecheck + unit + e2e all PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "Document repo-bound knowledge base"
```

---

## Self-Review Notes (for the implementing engineer)

- **Spec coverage:** trigger/lazy-detect (Task 7 `getProjectKnowledge`), structured 6-page wiki (Task 6 + types Task 1), embedding retrieval + keyword fallback (Task 6 `search`, Task 7 `searchProjectKnowledge`), embedding ModelKit (Task 1 + Task 11), Markdown-as-truth (`writeWikiPage` Task 7), separate sqlite tables (Task 3), Project binding + `knowledgeBranch` (Task 1 + Task 7), migration/drop legacy seed (Task 7 step (e)), UI (Tasks 10-11), API/routes (Tasks 8-9), tests (each task), e2e (Task 12).
- **Type consistency:** method names used across tasks — `resolveRef`, `countCommitsBetween`, `collectChangesBetween`, `listTrackedFiles` (git, Task 5); `listPages/upsertPages/listEmbeddings/replacePageEmbeddings/deleteProject` (WikiStore, Task 3); `bootstrap/incremental/search/resolveHead/countNewCommits` (RepoWikiManager, Task 6); `getProjectKnowledge/syncProjectKnowledge/setProjectKnowledgeBranch/searchProjectKnowledge` (service, Task 7). Keep these exact.
- **Embedding-disabled path (resolved inline):** `embedTexts` throws `EMBEDDING_DISABLED`; `searchProjectKnowledge` catches it and falls back to keyword search. `embedPage` (Task 6) wraps `deps.embed` in try/catch so an unconfigured/failed embedder persists pages WITHOUT vectors rather than failing the whole sync — indexing still reaches `status: "ready"` and pages remain usable via keyword. Add a `repo-wiki.test.ts` case: deps whose `embed` rejects → `bootstrap` still creates 6 pages and `listEmbeddings` is empty.
```
