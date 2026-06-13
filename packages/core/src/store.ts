import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepoHelmState, EngineConfig } from "./types.js";

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
    commandTemplates: ["pnpm test", "pnpm run build", "pnpm typecheck", "pnpm lint", "git status", "git diff"],
    fileScopes: ["workspace", "worktree", "knowledge"],
    networkScopes: ["localhost"],
    secretsPolicy: "redact-env",
    sandboxRuntime: "local",
    updatedAt: new Date().toISOString()
  },
  auditLog: [],
  engine: defaultEngineConfig(),
  modelCache: {},
  subAgents: {}, // SubAgent 集合,默认为空
  entrySubAgentId: undefined, // 入口 SubAgent ID,默认为未设置
  userPreferences: {}, // 用户偏好集合,默认为空
  failurePatterns: {} // 失败模式集合,默认为空
});

export const defaultEngineConfig = () => ({
  mode: "cli" as const,
  cliId: "claude-code",
  cliModels: {} as Record<string, string>,
  byokProviders: {} as Record<string, { provider: string; baseUrl: string; model: string; apiKey: string }>,
  activeByokProviderId: "openai",
  modelKits: {} as Record<string, any>, // ModelKit 集合，默认为空
  updatedAt: new Date().toISOString()
});

/** Migrate old byok format to new byokProviders format */
function migrateEngine(engine: any): EngineConfig {
  // Check if old byok field exists
  if (engine.byok && typeof engine.byok === "object") {
    const oldByok = engine.byok;
    const newEngine: EngineConfig = {
      ...engine,
      byokProviders: engine.byokProviders ?? {},
      activeByokProviderId: engine.activeByokProviderId ?? "openai"
    };

    // Resolve provider ID from baseUrl
    const baseUrl = oldByok.baseUrl || "";
    let providerId = "openai-compatible";
    if (baseUrl.includes("api.openai.com")) {
      providerId = "openai";
    } else if (baseUrl.includes("api.anthropic.com")) {
      providerId = "anthropic";
    } else if (baseUrl.includes("generativelanguage.googleapis.com")) {
      providerId = "gemini";
    } else if (baseUrl.includes("api.deepseek.com")) {
      providerId = "deepseek";
    } else if (baseUrl.includes("openrouter.ai")) {
      providerId = "openrouter";
    }

    // Migrate old config to the resolved provider
    if (oldByok.provider || oldByok.apiKey || oldByok.baseUrl) {
      newEngine.byokProviders[providerId] = {
        provider: oldByok.provider || "",
        baseUrl: oldByok.baseUrl || "",
        model: oldByok.model || "",
        apiKey: oldByok.apiKey || ""
      };
      newEngine.activeByokProviderId = providerId;
    }

    // Remove old byok field
    delete (newEngine as any).byok;
    return newEngine;
  }

  // Ensure new fields exist
  return {
    ...engine,
    byokProviders: engine.byokProviders ?? {},
    activeByokProviderId: engine.activeByokProviderId ?? "openai",
    modelKits: engine.modelKits ?? {} // 确保 modelKits 字段存在
  };
}

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
      const state = JSON.parse(raw) as RepoHelmState;
      return { ...state, engine: migrateEngine(state.engine) };
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

export interface ExpertSessionLite {
  id: string;
  questId: string;
  status: string;
  createdAt: string;
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
      const state = JSON.parse(row.payload) as RepoHelmState;
      return {
        ...state,
        engine: migrateEngine(state.engine),
        subAgents: state.subAgents ?? {},
        userPreferences: state.userPreferences ?? {},
        failurePatterns: state.failurePatterns ?? {}
      };
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

  async readExpertSession(id: string): Promise<import("./expert/types.js").ExpertSession | null> {
    const db = await this.database();
    const row = db.prepare("SELECT data FROM expert_sessions WHERE id = ?").get(id) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data);
  }

  async writeExpertSession(session: import("./expert/types.js").ExpertSession): Promise<void> {
    const db = await this.database();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT OR REPLACE INTO expert_sessions (id, quest_id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(session.id, session.questId, session.status, JSON.stringify(session), session.createdAt, now);
  }

  async listExpertSessions(questId?: string): Promise<import("./expert/types.js").ExpertSession[]> {
    const db = await this.database();
    const sql = questId
      ? "SELECT data FROM expert_sessions WHERE quest_id = ? ORDER BY created_at"
      : "SELECT data FROM expert_sessions ORDER BY created_at";
    const rows = questId
      ? (db.prepare(sql).all(questId) as { data: string }[])
      : (db.prepare(sql).all() as { data: string }[]);
    return rows.map((r) => JSON.parse(r.data));
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
      CREATE TABLE IF NOT EXISTS expert_sessions (
        id TEXT PRIMARY KEY,
        quest_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }
}
