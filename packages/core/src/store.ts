import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepoHelmState } from "./types.js";

const emptyState = (): RepoHelmState => ({
  workspaces: [],
  projects: [],
  quests: [],
  events: [],
  knowledge: [],
  capabilities: [],
  securityPolicy: {
    commandApprovalMode: "allowlist",
    allowedCommands: ["mock", "node", "git", "pnpm"],
    fileScopes: ["workspace", "worktree", "knowledge"],
    networkScopes: ["localhost"],
    secretsPolicy: "redact-env",
    sandboxRuntime: "local",
    updatedAt: new Date().toISOString()
  },
  auditLog: []
});

export interface StateStore {
  read(): Promise<RepoHelmState>;
  write(state: RepoHelmState): Promise<void>;
}

export class JsonStateStore implements StateStore {
  readonly statePath: string;

  constructor(rootDir: string) {
    this.statePath = join(rootDir, ".repohelm", "state.json");
  }

  async read(): Promise<RepoHelmState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as RepoHelmState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyState();
      }
      throw error;
    }
  }

  async write(state: RepoHelmState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

export class SqliteStateStore implements StateStore {
  readonly dbPath: string;
  private db?: DatabaseSync;

  constructor(private readonly rootDir: string) {
    this.dbPath = join(rootDir, ".repohelm", "state.sqlite");
  }

  async read(): Promise<RepoHelmState> {
    const db = await this.database();
    const row = db.prepare("SELECT payload FROM state WHERE id = ?").get("current") as { payload?: string } | undefined;
    if (row?.payload) {
      return JSON.parse(row.payload) as RepoHelmState;
    }

    const legacyState = await new JsonStateStore(this.rootDir).read();
    if (legacyState.workspaces.length > 0) {
      await this.write(legacyState);
      return legacyState;
    }
    return emptyState();
  }

  async write(state: RepoHelmState): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT INTO state (id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    ).run("current", JSON.stringify(state), new Date().toISOString());
  }

  private async database(): Promise<DatabaseSync> {
    if (this.db) {
      return this.db;
    }
    await mkdir(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return this.db;
  }
}
