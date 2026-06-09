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
