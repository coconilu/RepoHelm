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
  entrySubAgentId: undefined // 入口 SubAgent ID,默认为未设置
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
      return { ...state, engine: migrateEngine(state.engine) };
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
