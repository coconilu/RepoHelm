import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { nanoid } from "nanoid";
import { AgentBackendRegistry } from "./agent.js";
import { LocalCliRegistry } from "./cli.js";
import { GitWorktreeManager } from "./git.js";
import { KnowledgeFileStore } from "./knowledge.js";
import { embedWithModelKit, callLlmWithModelKit } from "./llm.js";
import { SubAgentOrchestrator, type OrchestratorQuestResult } from "./orchestrator.js";
import { ProviderRegistry } from "./providers.js";
import { QuestWorkspaceManager } from "./quest-workspace.js";
import { RepoWikiManager, type RepoWikiDeps, type KeyFile } from "./repo-wiki.js";
import { seedBuiltInSubAgents } from "./seed-agents.js";
import { InMemoryWikiStore, type WikiStore } from "./wiki-store.js";
import type {
  AgentEvent,
  AuditLogEntry,
  CapabilityDefinition,
  CapabilityRecommendation,
  ChangedFile,
  CliTestResult,
  CreateModelKitInput,
  CreateProjectInput,
  CreateQuestInput,
  CreateSubAgentInput,
  CreateWorkspaceInput,
  DeliveryState,
  EngineConfig,
  KnowledgeItem,
  ListProviderModelsInput,
  LocalCliInfo,
  ModelKit,
  OrchestrationPlan,
  PlanApproval,
  Project,
  ProjectHealth,
  ProjectKnowledgeMeta,
  ProjectKnowledgeView,
  ProductReadiness,
  ProviderInfo,
  ProviderModelsResult,
  Quest,
  QuestSpec,
  QuestStatus,
  RepoHelmState,
  RepoWikiPage,
  SecurityPolicy,
  SubAgent,
  TestModelInput,
  UpdateEngineInput,
  UpdateModelKitInput,
  UpdateProjectInput,
  UpdateSubAgentInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceWorktree,
  WorktreeState
} from "./types.js";
import { defaultEngineConfig, type StateStore } from "./store.js";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${nanoid(10)}`;
const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const unknownHealth = (): ProjectHealth => ({
  status: "unknown",
  message: "尚未检查项目状态。"
});

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48) || "quest";

export class RepoHelmService {
  private readonly gitWorktreeManager = new GitWorktreeManager();
  private readonly agentBackendRegistry = new AgentBackendRegistry();
  private readonly providerRegistry = new ProviderRegistry();
  private readonly cliRegistry = new LocalCliRegistry(undefined, this.providerRegistry);
  private readonly worktreeRootDir: string;
  private readonly knowledgeFileStore: KnowledgeFileStore;
  private readonly questWorkspaceManager: QuestWorkspaceManager;
  private readonly wikiStore: WikiStore;
  private readonly repoWiki: RepoWikiManager;

  /** Serializes read-modify-write cycles to prevent concurrent writes from clobbering each other. */
  private _mutationQueue: Promise<void> = Promise.resolve();

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

  getRootDir(): string {
    return this.rootDir;
  }

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

  private async resolveChatModelKit(): Promise<ModelKit> {
    const state = await this.getState();
    const kits = Object.values(state.engine.modelKits ?? {});
    const kit = kits.find((k) => k.type === "byok");
    if (!kit) {
      throw new Error("没有可用于知识库生成的 BYOK ModelKit。请在引擎设置里配置。");
    }
    return kit;
  }

  private async resolveEmbeddingModelKit(): Promise<ModelKit | undefined> {
    const state = await this.getState();
    const id = state.engine.embeddingModelKitId;
    if (!id) return undefined;
    return state.engine.modelKits?.[id];
  }

  private async chatJson(prompt: string): Promise<any> {
    if (process.env.REPOHELM_FAKE_MODELS === "1") {
      return JSON.parse(process.env.REPOHELM_FAKE_CHAT_JSON ?? "{}");
    }
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
    if (process.env.REPOHELM_FAKE_MODELS === "1") {
      return texts.map((_, i) => [Math.sin(i + 1), Math.cos(i + 1)]);
    }
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
    } catch {
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
    patch: Partial<ProjectKnowledgeMeta>
  ): Promise<void> {
    await this.mutateState(async (state) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return { newState: state, result: undefined };
      const knowledge: ProjectKnowledgeMeta = { status: "empty", ...project.knowledge, ...patch };
      const updated: Project = { ...project, knowledge, updatedAt: now() };
      const projects = state.projects.map((p) => (p.id === projectId ? updated : p));
      return { newState: { ...state, projects }, result: undefined };
    });
  }

  async resolveCliCommand(backendId: string): Promise<string | undefined> {
    return this.cliRegistry.resolveCommand(backendId);
  }

  getCliDefinition(backendId: string) {
    return this.cliRegistry.get(backendId);
  }

  /**
   * Atomically read-modify-write the state.
   * All mutations that touch shared state fields (e.g. engine.modelKits, modelCache)
   * MUST use this method to prevent concurrent writes from losing data.
   */
  private async mutateState<T>(
    fn: (state: RepoHelmState) => Promise<{ newState: RepoHelmState; result: T }>
  ): Promise<T> {
    const run = async () => {
      const state = await this.store.read();
      const { newState, result } = await fn(state);
      await this.store.write(newState);
      return result;
    };
    const chained = this._mutationQueue.then(run, run);
    this._mutationQueue = chained.then(() => {}, () => {});
    return chained;
  }

  async bootstrap(): Promise<RepoHelmState> {
    const state = await this.store.read();
    if (state.workspaces.length > 0) {
      const normalized = await this.ensureKnowledgeFiles(this.normalizeState(state));
      if (JSON.stringify(normalized) !== JSON.stringify(state)) {
        await this.store.write(normalized);
      }
      return normalized;
    }

    const timestamp = now();
    const workspace: Workspace = {
      id: "ws_demo",
      name: "RepoHelm Demo Workspace",
      description: "一个用于体验 Quest 工作流的虚拟 workspace。",
      projectIds: ["project_repohelm"],
      worktrees: [],
      worktreeRoot: this.worktreeRootDir,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const project: Project = {
      id: "project_repohelm",
      name: "RepoHelm",
      path: this.rootDir,
      role: "unknown",
      defaultBranch: "main",
      validationCommand: "pnpm test:all",
      health: unknownHealth(),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const nextState: RepoHelmState = {
      ...state,
      workspaces: [workspace],
      projects: [project],
      knowledge: [],
      capabilities: this.seedCapabilities(timestamp)
    };
    await this.store.write(nextState);
    return nextState;
  }

  /**
   * Seed the built-in sub-agents on first run. Safe to call multiple times — idempotent.
   * Call once at server startup (after bootstrap) so the supervisor is available for quests.
   */
  async ensureBuiltInSubAgents(): Promise<void> {
    try {
      const rawReader = () => this.store.read();
      const result = await seedBuiltInSubAgents(this, rawReader);
      if (result.seeded) {
        console.log(
          `[seed-agents] seeded ${result.agents.length} agents (modelKit=${result.defaultModelKitId})`
        );
      } else if (result.reason) {
        console.warn(`[seed-agents] skipped: ${result.reason}`);
      }
    } catch (error) {
      console.warn("[seed-agents] failed:", error instanceof Error ? error.message : String(error));
    }
  }

  async getState(): Promise<RepoHelmState> {
    return this.bootstrap();
  }

  async listAgentBackends() {
    return this.agentBackendRegistry.listAvailability();
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const state = await this.getState();
    const timestamp = now();
    const workspace: Workspace = {
      id: id("ws"),
      name: input.name,
      description: input.description ?? "",
      projectIds: [],
      worktrees: [],
      worktreeRoot: input.worktreeRoot ?? this.worktreeRootDir,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.store.write({ ...state, workspaces: [workspace, ...state.workspaces] });
    return workspace;
  }

  async updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    const state = await this.getState();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const updatedWorkspace: Workspace = {
      ...workspace,
      name: input.name ?? workspace.name,
      description: input.description ?? workspace.description,
      worktreeRoot: input.worktreeRoot ?? workspace.worktreeRoot,
      updatedAt: now()
    };
    const workspaces = state.workspaces.map((item) => (item.id === workspaceId ? updatedWorkspace : item));
    await this.store.write({ ...state, workspaces });
    return updatedWorkspace;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const state = await this.getState();

    const project: Project = {
      id: id("project"),
      name: input.name,
      path: input.path,
      role: input.role ?? "unknown",
      defaultBranch: input.defaultBranch ?? "main",
      validationCommand: input.validationCommand ?? "",
      health: unknownHealth(),
      createdAt: now(),
      updatedAt: now()
    };

    await this.store.write({
      ...state,
      projects: [project, ...state.projects]
    });
    return project;
  }

  async updateProject(projectId: string, input: UpdateProjectInput): Promise<Project> {
    const state = await this.getState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const updatedProject: Project = {
      ...project,
      name: input.name ?? project.name,
      path: input.path ?? project.path,
      role: input.role ?? project.role,
      defaultBranch: input.defaultBranch ?? project.defaultBranch,
      validationCommand: input.validationCommand ?? project.validationCommand,
      health:
        input.path || input.defaultBranch
          ? {
              status: "unknown",
              message: "仓库配置已变更，等待重新检查。"
            }
          : project.health,
      updatedAt: now()
    };
    const projects = state.projects.map((item) => (item.id === projectId ? updatedProject : item));
    await this.store.write({ ...state, projects });
    return updatedProject;
  }

  async linkProjectToWorkspace(workspaceId: string, projectId: string): Promise<Workspace> {
    const state = await this.getState();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    if (workspace.worktrees.some((item) => item.projectId === projectId)) {
      return workspace;
    }

    const worktreeRoot = workspace.worktreeRoot ? resolve(workspace.worktreeRoot) : this.worktreeRootDir;
    const worktreePath = join(worktreeRoot, slugify(workspace.name), slugify(project.name));
    const branchName = `repohelm/${slugify(workspace.name)}/${slugify(project.name)}`;
    const result = await this.gitWorktreeManager.createWorktree({
      repoPath: project.path,
      branchName,
      worktreePath,
      baseBranch: project.defaultBranch
    });

    const timestamp = now();
    const worktree: WorkspaceWorktree = {
      projectId,
      baseBranch: project.defaultBranch,
      branchName: result.branchName,
      worktreePath: result.worktreePath,
      repoRoot: result.repoRoot,
      status: result.status,
      note: result.note,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const updatedWorkspace: Workspace = {
      ...workspace,
      projectIds: workspace.projectIds.includes(projectId)
        ? workspace.projectIds
        : [...workspace.projectIds, projectId],
      worktrees: [...workspace.worktrees, worktree],
      updatedAt: timestamp
    };
    const workspaces = state.workspaces.map((item) => (item.id === workspaceId ? updatedWorkspace : item));
    await this.store.write({ ...state, workspaces });
    return updatedWorkspace;
  }

  async unlinkProjectFromWorkspace(workspaceId: string, projectId: string): Promise<Workspace> {
    const state = await this.getState();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    const project = state.projects.find((item) => item.id === projectId);
    const worktree = workspace.worktrees.find((item) => item.projectId === projectId);
    if (worktree && project && worktree.status === "created") {
      await this.gitWorktreeManager.removeWorktree(project.path, worktree.worktreePath, worktree.branchName);
    }

    const updatedWorkspace: Workspace = {
      ...workspace,
      projectIds: workspace.projectIds.filter((item) => item !== projectId),
      worktrees: workspace.worktrees.filter((item) => item.projectId !== projectId),
      updatedAt: now()
    };
    const workspaces = state.workspaces.map((item) => (item.id === workspaceId ? updatedWorkspace : item));
    await this.store.write({ ...state, workspaces });
    return updatedWorkspace;
  }

  async removeProject(projectId: string): Promise<RepoHelmState> {
    const state = await this.getState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Cascade: drop the repo from every workspace and clean up its linked worktrees.
    const workspaces: Workspace[] = [];
    for (const workspace of state.workspaces) {
      const worktree = workspace.worktrees.find((item) => item.projectId === projectId);
      if (!worktree) {
        workspaces.push(workspace);
        continue;
      }
      if (worktree.status === "created") {
        await this.gitWorktreeManager.removeWorktree(project.path, worktree.worktreePath, worktree.branchName);
      }
      workspaces.push({
        ...workspace,
        projectIds: workspace.projectIds.filter((item) => item !== projectId),
        worktrees: workspace.worktrees.filter((item) => item.projectId !== projectId),
        updatedAt: now()
      });
    }

    const projects = state.projects.filter((item) => item.id !== projectId);
    const quests = state.quests.map((quest) => ({
      ...quest,
      affectedProjectIds: quest.affectedProjectIds.filter((id) => id !== projectId)
    }));
    const nextState = { ...state, projects, workspaces, quests };
    await this.store.write(nextState);
    return nextState;
  }

  async listBranches(path: string): Promise<{ branches: string[]; defaultBranch: string }> {
    return this.gitWorktreeManager.listBranches(path);
  }

  async listLocalClis(refresh = false): Promise<LocalCliInfo[]> {
    return this.cliRegistry.detectAll({ refresh });
  }

  async testLocalCli(id: string): Promise<CliTestResult> {
    const def = this.cliRegistry.get(id);
    if (!def) {
      return { id, ok: false, latencyMs: 0, message: "未知的 CLI。" };
    }
    const state = await this.getState();
    const model = state.engine.cliModels[id];
    return this.cliRegistry.test(def, { model });
  }

  async getEngine(): Promise<EngineConfig> {
    const state = await this.getState();
    return state.engine;
  }

  async updateEngine(input: UpdateEngineInput): Promise<EngineConfig> {
    return this.mutateState(async (state) => {
      const byokProviders = input.byokProviders
        ? {
            ...state.engine.byokProviders,
            ...Object.fromEntries(
              Object.entries(input.byokProviders).map(([id, config]) => [
                id,
                { ...(state.engine.byokProviders[id] ?? { provider: "", baseUrl: "", model: "", apiKey: "" }), ...config }
              ])
            )
          }
        : state.engine.byokProviders;

      const engine: EngineConfig = {
        ...state.engine,
        mode: input.mode ?? state.engine.mode,
        cliId: input.cliId ?? state.engine.cliId,
        cliModels: input.cliModels ? { ...state.engine.cliModels, ...input.cliModels } : state.engine.cliModels,
        byokProviders,
        activeByokProviderId: input.activeByokProviderId ?? state.engine.activeByokProviderId,
        embeddingModelKitId:
          input.embeddingModelKitId === undefined
            ? state.engine.embeddingModelKitId
            : input.embeddingModelKitId || undefined,
        updatedAt: now()
      };
      return { newState: { ...state, engine }, result: engine };
    });
  }

  /**
   * 创建新的 ModelKit
   */
  async createModelKit(input: CreateModelKitInput): Promise<ModelKit> {
    return this.mutateState(async (state) => {
      const idValue = input.id || `modelkit-${Date.now()}`;

      if (state.engine.modelKits[idValue]) {
        throw new Error(`ModelKit ${idValue} already exists`);
      }
      if (input.type === "cli" && !input.backendId) {
        throw new Error("CLI type ModelKit requires backendId");
      }
      if (input.type === "byok" && !input.providerId) {
        throw new Error("BYOK type ModelKit requires providerId");
      }

      const timestamp = now();
      const modelKit: ModelKit = {
        id: idValue,
        name: input.name,
        type: input.type,
        backendId: input.backendId,
        providerId: input.providerId,
        model: input.model,
        config: input.config,
        metadata: {
          createdAt: timestamp,
          testedAt: timestamp,
          costTier: input.costTier || "medium",
          performanceProfile: input.performanceProfile || "balanced"
        }
      };

      const engine: EngineConfig = {
        ...state.engine,
        modelKits: {
          ...state.engine.modelKits,
          [idValue]: modelKit
        },
        updatedAt: timestamp
      };

      return { newState: { ...state, engine }, result: modelKit };
    });
  }

  /**
   * 更新现有的 ModelKit
   */
  async updateModelKit(idValue: string, input: UpdateModelKitInput): Promise<ModelKit> {
    return this.mutateState(async (state) => {
      const existingKit = state.engine.modelKits[idValue];

      if (!existingKit) {
        throw new Error(`ModelKit ${idValue} not found`);
      }

      const timestamp = now();
      const updatedKit: ModelKit = {
        ...existingKit,
        name: input.name ?? existingKit.name,
        model: input.model ?? existingKit.model,
        config: input.config ?? existingKit.config,
        metadata: {
          ...existingKit.metadata,
          costTier: input.costTier ?? existingKit.metadata.costTier,
          performanceProfile: input.performanceProfile ?? existingKit.metadata.performanceProfile,
          testedAt: timestamp
        }
      };

      const engine: EngineConfig = {
        ...state.engine,
        modelKits: {
          ...state.engine.modelKits,
          [idValue]: updatedKit
        },
        updatedAt: timestamp
      };

      return { newState: { ...state, engine }, result: updatedKit };
    });
  }

  /**
   * 删除 ModelKit
   */
  async deleteModelKit(idValue: string): Promise<void> {
    await this.mutateState(async (state) => {
      const existingKit = state.engine.modelKits[idValue];

      if (!existingKit) {
        throw new Error(`ModelKit ${idValue} not found`);
      }

      const modelKits = { ...state.engine.modelKits };
      delete modelKits[idValue];

      const engine: EngineConfig = {
        ...state.engine,
        modelKits,
        updatedAt: now()
      };

      return { newState: { ...state, engine }, result: undefined };
    });
  }

  /**
   * 列出所有 ModelKits
   */
  async listModelKits(): Promise<ModelKit[]> {
    const state = await this.getState();
    return Object.values(state.engine.modelKits);
  }

  /**
   * 创建新的 SubAgent
   */
  async createSubAgent(input: CreateSubAgentInput): Promise<SubAgent> {
    return this.mutateState(async (state) => {
      if (!state.engine.modelKits[input.modelKitId]) {
        throw new Error(`ModelKit ${input.modelKitId} not found`);
      }

      const idValue = input.id || `subagent-${Date.now()}`;

      if (state.subAgents[idValue]) {
        throw new Error(`SubAgent ${idValue} already exists`);
      }

      const timestamp = now();
      const subAgent: SubAgent = {
        id: idValue,
        name: input.name,
        role: input.role,
        capabilities: input.capabilities || [],
        modelKitId: input.modelKitId,
        mode: input.mode,
        permissions: input.permissions || { allowedTools: [], deniedTools: [] },
        promptTemplate: input.promptTemplate,
        metadata: {
          createdAt: timestamp,
          updatedAt: timestamp,
          usageCount: 0
        }
      };

      const updatedState = {
        ...state,
        subAgents: {
          ...state.subAgents,
          [idValue]: subAgent
        }
      };

      return { newState: updatedState, result: subAgent };
    });
  }

  /**
   * 更新现有的 SubAgent
   */
  async updateSubAgent(idValue: string, input: UpdateSubAgentInput): Promise<SubAgent> {
    return this.mutateState(async (state) => {
      const existingAgent = state.subAgents[idValue];

      if (!existingAgent) {
        throw new Error(`SubAgent ${idValue} not found`);
      }

      if (input.modelKitId && !state.engine.modelKits[input.modelKitId]) {
        throw new Error(`ModelKit ${input.modelKitId} not found`);
      }

      const timestamp = now();
      const updatedAgent: SubAgent = {
        ...existingAgent,
        name: input.name ?? existingAgent.name,
        role: input.role ?? existingAgent.role,
        capabilities: input.capabilities ?? existingAgent.capabilities,
        modelKitId: input.modelKitId ?? existingAgent.modelKitId,
        mode: input.mode ?? existingAgent.mode,
        permissions: input.permissions ?? existingAgent.permissions,
        promptTemplate: input.promptTemplate ?? existingAgent.promptTemplate,
        metadata: {
          ...existingAgent.metadata,
          updatedAt: timestamp
        }
      };

      const updatedState = {
        ...state,
        subAgents: {
          ...state.subAgents,
          [idValue]: updatedAgent
        }
      };

      return { newState: updatedState, result: updatedAgent };
    });
  }

  /**
   * 删除 SubAgent
   */
  async deleteSubAgent(idValue: string): Promise<void> {
    await this.mutateState(async (state) => {
      const existingAgent = state.subAgents[idValue];

      if (!existingAgent) {
        throw new Error(`SubAgent ${idValue} not found`);
      }

      if (state.entrySubAgentId === idValue) {
        throw new Error(`Cannot delete entry SubAgent ${idValue}. Please set a different entry SubAgent first.`);
      }

      const subAgents = { ...state.subAgents };
      delete subAgents[idValue];

      return { newState: { ...state, subAgents }, result: undefined };
    });
  }

  /**
   * 列出所有 SubAgents
   */
  async listSubAgents(): Promise<SubAgent[]> {
    const state = await this.getState();
    return Object.values(state.subAgents);
  }

  /**
   * 设置入口 SubAgent
   */
  async setEntrySubAgent(idValue: string): Promise<void> {
    await this.mutateState(async (state) => {
      const subAgent = state.subAgents[idValue];

      if (!subAgent) {
        throw new Error(`SubAgent ${idValue} not found`);
      }

      return { newState: { ...state, entrySubAgentId: idValue }, result: undefined };
    });
  }

  /**
   * 获取入口 SubAgent
   */
  async getEntrySubAgent(): Promise<SubAgent | undefined> {
    const state = await this.getState();

    if (!state.entrySubAgentId) {
      return undefined;
    }

    return state.subAgents[state.entrySubAgentId];
  }

  /**
   * 获取 ModelKit
   */
  async getModelKit(id: string): Promise<ModelKit | undefined> {
    const state = await this.getState();
    return state.engine.modelKits[id];
  }

  /**
   * Refine a freeform request into a clearer, more actionable requirement using the
   * entry agent's ModelKit (BYOK or CLI). Throws a descriptive error when no model is
   * configured so the UI can surface real feedback.
   */
  async enhanceRequirement(text: string): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("需求内容为空，无法增强。");
    }
    const state = await this.getState();
    const entryAgent = state.entrySubAgentId ? state.subAgents[state.entrySubAgentId] : undefined;
    const candidateKits = Object.values(state.engine.modelKits);
    const modelKit =
      (entryAgent ? state.engine.modelKits[entryAgent.modelKitId] : undefined) ??
      candidateKits.find((kit) => kit.type === "byok") ??
      candidateKits[0];
    if (!modelKit) {
      throw new Error("智能增强需要一个模型。请先在设置中配置 BYOK 或 CLI ModelKit。");
    }
    const orchestrator = new SubAgentOrchestrator(this);
    const backend = await orchestrator.createBackendFromModelKit(modelKit);
    const result = await backend.run({
      systemPrompt:
        "你是一名需求澄清助手。把用户的开发需求改写得更清晰、具体、可执行：补全隐含的目标、范围和验收要点，保持原意，使用与输入相同的语言。只返回改写后的需求正文，不要加任何解释、标题或代码块。",
      messages: [{ role: "user", content: trimmed }],
      tools: [],
      worktrees: [],
      quest: { id: "enhance", requirement: trimmed } as Quest
    });
    const enhanced = result.content?.trim();
    if (!enhanced) {
      throw new Error("模型未返回增强内容，请重试。");
    }
    return enhanced;
  }

  /**
   * 更新 SubAgent 使用统计
   */
  async updateSubAgentUsage(agentId: string): Promise<void> {
    const state = await this.getState();
    const agent = state.subAgents[agentId];
    if (!agent) return;
    
    const updatedAgent = {
      ...agent,
      metadata: {
        ...agent.metadata,
        usageCount: agent.metadata.usageCount + 1,
        updatedAt: new Date().toISOString()
      }
    };
    
    await this.store.write({
      ...state,
      subAgents: {
        ...state.subAgents,
        [agentId]: updatedAgent
      }
    });
  }

  /**
   * 获取 Quest 信息
   */
  async getQuest(questId: string): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }
    return quest;
  }

  /**
   * 测试模型配置并保存为 ModelKit
   */
  async testAndSaveModelKit(testInput: TestModelInput): Promise<ModelKit> {
    let testResult: CliTestResult;

    // 根据类型执行相应的测试逻辑（网络调用，不在锁内）
    if (testInput.type === "cli") {
      if (!testInput.backendId) {
        throw new Error("CLI type requires backendId for testing");
      }

      const cliDef = this.cliRegistry.get(testInput.backendId);
      if (!cliDef) {
        throw new Error(`CLI backend ${testInput.backendId} not found`);
      }

      testResult = await this.cliRegistry.test(cliDef, { model: testInput.model });
    } else {
      if (!testInput.providerId) {
        throw new Error("BYOK type requires providerId for testing");
      }

      const providerDef = this.providerRegistry.resolve(testInput.providerId, testInput.baseUrl);
      testResult = await this.testProvider({
        providerId: testInput.providerId,
        baseUrl: testInput.baseUrl,
        apiKey: testInput.apiKey
      });
    }

    if (!testResult.ok) {
      throw new Error(`Model test failed: ${testResult.message}`);
    }

    // 测试成功后，在锁内原子地写入 state
    const timestamp = now();
    const idValue = `modelkit-${Date.now()}`;

    const config =
      testInput.type === "cli"
        ? { backendId: testInput.backendId }
        : {
            providerId: testInput.providerId,
            apiKey: testInput.apiKey || "",
            baseUrl: testInput.baseUrl || ""
          };

    const modelKit: ModelKit = {
      id: idValue,
      name: testInput.name,
      type: testInput.type,
      backendId: testInput.backendId,
      providerId: testInput.providerId,
      model: testInput.model,
      config,
      metadata: {
        createdAt: timestamp,
        testedAt: timestamp,
        costTier: testInput.costTier || "medium",
        performanceProfile: testInput.performanceProfile || "balanced"
      }
    };

    return this.mutateState(async (state) => {
      const engine: EngineConfig = {
        ...state.engine,
        modelKits: {
          ...state.engine.modelKits,
          [idValue]: modelKit
        },
        updatedAt: timestamp
      };

      return { newState: { ...state, engine }, result: modelKit };
    });
  }

  /** Real connectivity + auth test for a provider (BYOK). Hits `/models`, zero token cost. */
  async testProvider(input: { providerId?: string; baseUrl?: string; apiKey?: string }): Promise<CliTestResult> {
    const def = this.providerRegistry.resolve(input.providerId, input.baseUrl);
    const probe = await this.providerRegistry.probe(def, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl
    });
    return {
      id: def.id,
      ok: probe.ok,
      latencyMs: probe.latencyMs,
      message: probe.ok
        ? `已真实请求 ${def.name} /models,鉴权成功,返回 ${probe.modelCount} 个模型(${probe.latencyMs}ms)。`
        : `${def.name} /models 请求失败:${probe.detail}`
    };
  }

  async listProviders(): Promise<ProviderInfo[]> {
    return this.providerRegistry.list().map((def) => ({
      id: def.id,
      name: def.name,
      defaultBaseUrl: def.defaultBaseUrl,
      keyOptional: Boolean(def.keyOptional)
    }));
  }

  /**
   * List a provider's models from its REST `/models` endpoint, with a SQLite-backed
   * cache (TTL {@link MODEL_CACHE_TTL_MS}). `refresh` forces a live fetch.
   * Falls back to the BYOK key/baseUrl saved in engine config when not supplied.
   */
  async listProviderModels(input: ListProviderModelsInput): Promise<ProviderModelsResult> {
    const state = await this.getState();
    const def = this.providerRegistry.resolve(input.providerId, input.baseUrl);
    const baseUrl = input.baseUrl?.trim() || def.defaultBaseUrl;
    const savedConfig = state.engine.byokProviders[def.id];
    const apiKey =
      input.apiKey?.trim() ||
      savedConfig?.apiKey ||
      this.providerRegistry.envKey(def) ||
      "";
    const cacheKey = `${def.id}:${baseUrl}`;
    const cached = state.modelCache?.[cacheKey];

    if (!input.refresh && cached && Date.now() - new Date(cached.fetchedAt).getTime() < MODEL_CACHE_TTL_MS) {
      return { providerId: def.id, ...cached };
    }

    // Network call outside the lock
    const result = await this.providerRegistry.fetchModels(def, { apiKey, baseUrl });
    if (result.live) {
      // Cache write inside the lock to avoid clobbering concurrent ModelKit writes
      await this.mutateState(async (freshState) => {
        const newState: RepoHelmState = {
          ...freshState,
          modelCache: {
            ...(freshState.modelCache ?? {}),
            [cacheKey]: {
              models: result.models,
              live: result.live,
              detail: result.detail,
              fetchedAt: result.fetchedAt
            }
          }
        };
        return { newState, result: undefined };
      });
    }
    return result;
  }

  async checkProjectHealth(projectId: string): Promise<Project> {
    const state = await this.getState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const health = await this.gitWorktreeManager.inspectRepository(project.path, project.defaultBranch);
    const updatedProject: Project = {
      ...project,
      health: {
        ...health,
        checkedAt: now()
      },
      updatedAt: now()
    };
    const projects = state.projects.map((item) => (item.id === projectId ? updatedProject : item));
    await this.store.write({ ...state, projects });
    return updatedProject;
  }

  /**
   * Best-effort scope inference: if the requirement text names specific linked
   * projects, target only those; otherwise fall back to every project in the workspace.
   */
  private inferAffectedProjectIds(
    state: RepoHelmState,
    workspaceProjectIds: string[],
    requirement: string
  ): string[] {
    const haystack = requirement.toLowerCase();
    const matched = workspaceProjectIds.filter((projectId) => {
      const project = state.projects.find((item) => item.id === projectId);
      const name = project?.name?.trim().toLowerCase();
      return name ? haystack.includes(name) : false;
    });
    return matched.length > 0 ? matched : workspaceProjectIds;
  }

  async createQuest(input: CreateQuestInput): Promise<Quest> {
    const state = await this.getState();
    const workspace = state.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const affectedProjectIds =
      input.affectedProjectIds && input.affectedProjectIds.length > 0
        ? input.affectedProjectIds
        : this.inferAffectedProjectIds(state, workspace.projectIds, input.requirement);
    const timestamp = now();
    const questId = id("quest");
    const relatedPages = workspace
      ? await this.searchProjectKnowledge(workspace.projectIds, input.requirement)
      : [];
    const relatedKnowledge = relatedPages.slice(0, 3);
    const spec = this.generateSpec(input.requirement, relatedKnowledge);
    const capabilityRecommendations = this.recommendCapabilities(state.capabilities, input.requirement, timestamp);
    const entrySubAgentId = input.entrySubAgentId ?? state.entrySubAgentId;
    const quest: Quest = {
      id: questId,
      workspaceId: input.workspaceId,
      title: input.title,
      requirement: input.requirement,
      status: "planning",
      spec,
      agentBackendId: input.agentBackendId ?? "mock",
      entrySubAgentId,
      affectedProjectIds,
      worktrees: [],
      changedFiles: [],
      validationResults: [],
      reviewNotes: [],
      deliveryResults: [],
      capabilityRecommendations,
      autoApprovePlan: input.autoApprovePlan ?? false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const events = [
      this.event(questId, "quest.created", "Quest 已创建", "用户需求已进入 Quest 工作流。", "Lead Agent"),
      this.event(questId, "spec.generated", "轻量 Spec 已生成", "Spec Agent 根据需求生成了初版目标、范围和验收标准。", "Spec Agent"),
      this.event(questId, "plan.created", "实施计划已生成", "Lead Agent 已将 Quest 推进到规划阶段，等待准备 worktree。", "Lead Agent"),
      relatedKnowledge.length > 0
        ? this.event(
            questId,
            "knowledge.retrieved",
            "知识库已引用",
            `Agent 读取了 ${relatedKnowledge.length} 条相关知识。`,
            "Knowledge Agent"
          )
        : undefined,
      capabilityRecommendations.length > 0
        ? this.event(
            questId,
            "capability.recommended",
            "能力推荐已生成",
            `Capability Agent 推荐了 ${capabilityRecommendations.length} 个可审计能力。`,
            "Capability Agent"
          )
        : undefined
    ].filter(Boolean) as AgentEvent[];

    await this.store.write({
      ...state,
      quests: [quest, ...state.quests],
      events: [...events, ...state.events]
    });
    return quest;
  }

  async runQuest(questId: string): Promise<Quest> {
    const entryAgent = await this.resolveEntryAgentForQuest(questId);
    if (!entryAgent) {
      throw new Error(
        "No entry sub-agent configured. Set an entry agent in Settings > Sub-Agents before running quests."
      );
    }

    const orchestrator = new SubAgentOrchestrator(this);
    const plan = await orchestrator.generatePlan(questId);
    const planPath = await orchestrator.questWorkspace.writePlan(questId, plan);

    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }

    const updatedQuest: Quest = {
      ...quest,
      planPath,
      planApproval: { status: "pending" },
      updatedAt: now()
    };

    const events: AgentEvent[] = [
      this.event(
        questId,
        "plan.generated",
        "编排计划已生成",
        `Supervisor ${entryAgent.name} 生成了 ${plan.steps.length} 个步骤的执行计划。`,
        entryAgent.name
      )
    ];

    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item)),
      events: [...events, ...state.events]
    });

    if (quest.autoApprovePlan) {
      return this.approvePlan(questId);
    }

    return updatedQuest;
  }

  async approvePlan(questId: string): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }
    if (quest.planApproval?.status !== "pending") {
      throw new Error("Plan is not pending approval");
    }

    const orchestrator = new SubAgentOrchestrator(this);
    const plan = await orchestrator.questWorkspace.readPlan(questId);
    if (!plan) {
      throw new Error("No plan file found for this quest");
    }

    // Provision real git worktrees so workers have an isolated place to write files.
    await this.provisionQuestWorktrees(questId);

    const result = await orchestrator.executeApprovedPlan(questId, plan);

    // Read back what actually changed on disk before reporting status.
    const changedFiles = await this.collectQuestChangedFiles(questId);
    return this.persistOrchestratorResult(questId, plan, result, changedFiles);
  }

  /**
   * Create an isolated git worktree for every affected project that is a usable git
   * repo, persist them onto the quest, and move the quest into the `executing` state.
   * Returns only the successfully created worktrees.
   */
  async provisionQuestWorktrees(questId: string): Promise<WorktreeState[]> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }
    const workspace = state.workspaces.find((item) => item.id === quest.workspaceId);
    const worktreeRoot = workspace?.worktreeRoot ? resolve(workspace.worktreeRoot) : this.worktreeRootDir;
    const branchName = `repohelm/${slugify(quest.title)}-${quest.id.slice(-4)}`;

    const results: WorktreeState[] = [];
    const events: AgentEvent[] = [];
    for (const projectId of quest.affectedProjectIds) {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        results.push({ projectId, branchName, worktreePath: "", status: "failed", note: "Project not found" });
        continue;
      }
      // Reuse an existing created worktree (e.g. on retry) when present.
      const existing = quest.worktrees.find((item) => item.projectId === projectId && item.status === "created");
      if (existing) {
        results.push(existing);
        continue;
      }
      const worktreePath = join(worktreeRoot, "quests", quest.id, slugify(project.name));
      const created = await this.gitWorktreeManager.createWorktree({
        repoPath: project.path,
        branchName,
        worktreePath,
        baseBranch: project.defaultBranch
      });
      results.push({
        projectId,
        branchName: created.branchName,
        worktreePath: created.worktreePath,
        status: created.status === "created" ? "created" : "failed",
        note: created.note,
        repoRoot: created.repoRoot
      });
      events.push(
        this.event(
          questId,
          created.status === "created" ? "worktree.created" : "worktree.failed",
          created.status === "created" ? "Worktree 已创建" : "Worktree 创建失败",
          `${project.name}: ${created.note}`,
          "Worktree Manager"
        )
      );
    }

    const updatedQuest: Quest = {
      ...quest,
      worktrees: results,
      status: "executing",
      updatedAt: now()
    };
    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item)),
      events: [...events, ...state.events]
    });
    return results.filter((item) => item.status === "created");
  }

  /** Read changed files from every created worktree and persist them onto the quest. */
  async collectQuestChangedFiles(questId: string): Promise<ChangedFile[]> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }
    const collected: ChangedFile[] = [];
    for (const worktree of quest.worktrees) {
      if (worktree.status !== "created" || !worktree.worktreePath) {
        continue;
      }
      try {
        const files = await this.gitWorktreeManager.getChangedFiles(worktree.projectId, worktree.worktreePath);
        collected.push(...files);
      } catch {
        // a worktree that can't be diffed contributes no changed files
      }
    }
    const updatedQuest: Quest = { ...quest, changedFiles: collected, updatedAt: now() };
    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item))
    });
    return collected;
  }

  async rejectPlan(questId: string, reason?: string): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }
    if (quest.planApproval?.status !== "pending") {
      throw new Error("Plan is not pending approval");
    }

    const updatedQuest: Quest = {
      ...quest,
      status: "cancelled",
      planApproval: { status: "rejected", rejectionReason: reason },
      updatedAt: now()
    };

    const events: AgentEvent[] = [
      this.event(
        questId,
        "plan.rejected",
        "编排计划已拒绝",
        reason || "用户拒绝了编排计划。",
        "User"
      )
    ];

    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item)),
      events: [...events, ...state.events]
    });
    return updatedQuest;
  }

  async getQuestPlan(questId: string): Promise<OrchestrationPlan | undefined> {
    const orchestrator = new SubAgentOrchestrator(this);
    return orchestrator.questWorkspace.readPlan(questId);
  }

  private async resolveEntryAgentForQuest(questId: string): Promise<SubAgent | undefined> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (quest?.entrySubAgentId && state.subAgents[quest.entrySubAgentId]) {
      return state.subAgents[quest.entrySubAgentId];
    }
    if (state.entrySubAgentId && state.subAgents[state.entrySubAgentId]) {
      return state.subAgents[state.entrySubAgentId];
    }
    return undefined;
  }

  private async persistOrchestratorResult(
    questId: string,
    plan: OrchestrationPlan,
    result: OrchestratorQuestResult,
    changedFiles: ChangedFile[] = []
  ): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }

    const delegationSummary =
      result.delegations.length === 0
        ? "No steps were executed."
        : result.delegations
            .map((d, idx) => `${idx + 1}. ${d.agentName} (${d.ok ? "ok" : "fail"}): ${d.summary}`)
            .join("\n");

    const createdWorktrees = quest.worktrees.filter((item) => item.status === "created");
    const hasFailures = result.delegations.some((d) => !d.ok);
    // Only claim "ready to deliver" when the execution actually produced file changes.
    const produced = changedFiles.length > 0;
    const status: QuestStatus = produced ? "ready" : "blocked";

    const reviewNote = produced
      ? `执行产生了 ${changedFiles.length} 个文件变更，可进入交付。`
      : createdWorktrees.length === 0
        ? "执行未创建任何 worktree（受影响项目不是可用的 Git 仓库），没有可交付内容。"
        : "执行完成但未产生任何文件变更，无可交付内容。请检查需求或在 worktree 中确认 Agent 输出。";

    const updatedQuest: Quest = {
      ...quest,
      status,
      changedFiles,
      planApproval: { status: "approved", approvedAt: now() },
      agentSummary: result.finalContent || delegationSummary,
      reviewNotes: [...quest.reviewNotes, reviewNote],
      updatedAt: now()
    };

    const events: AgentEvent[] = [
      this.event(
        questId,
        "plan.approved",
        "编排计划已批准",
        `开始执行 ${plan.steps.length} 个步骤。`,
        "User"
      ),
      ...result.delegations.map((d) =>
        this.event(
          questId,
          d.ok ? "step.completed" : "step.failed",
          `步骤完成: ${d.agentName}`,
          d.summary,
          d.agentName
        )
      ),
      this.event(
        questId,
        produced ? "orchestrator.completed" : "orchestrator.no_changes",
        produced ? "编排执行完成" : hasFailures ? "编排执行失败" : "编排执行完成（无文件变更）",
        produced
          ? `执行了 ${result.iterations} 个步骤，产生 ${changedFiles.length} 个文件变更。`
          : `执行了 ${result.iterations} 个步骤，但没有产生文件变更。${reviewNote}`,
        result.entryAgentName
      )
    ];

    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item)),
      events: [...events, ...state.events]
    });
    return updatedQuest;
  }

  private async appendEvent(event: AgentEvent): Promise<void> {
    const state = await this.getState();
    await this.store.write({ ...state, events: [event, ...state.events] });
  }

  async listWorktrees(workspaceId?: string): Promise<Array<WorktreeState & { questId: string; questTitle: string }>> {
    const state = await this.getState();
    return state.quests
      .filter((quest) => !workspaceId || quest.workspaceId === workspaceId)
      .flatMap((quest) =>
        quest.worktrees.map((worktree) => ({
          ...worktree,
          questId: quest.id,
          questTitle: quest.title
        }))
      );
  }

  async cleanupQuestWorktrees(questId: string): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }

    const worktrees = await Promise.all(
      quest.worktrees.map(async (worktree) => {
        const project = state.projects.find((item) => item.id === worktree.projectId);
        if (!project || worktree.status !== "created") {
          return worktree;
        }
        const result = await this.gitWorktreeManager.removeWorktree(project.path, worktree.worktreePath, worktree.branchName);
        return {
          ...worktree,
          status: result.status === "ok" ? "cleaned" : "failed",
          note: result.note
        } satisfies WorktreeState;
      })
    );
    const updatedQuest: Quest = {
      ...quest,
      worktrees,
      status: quest.status === "delivered" ? quest.status : "ready",
      updatedAt: now()
    };
    const events = [
      this.event(
        questId,
        "worktree.cleaned",
        "Worktree 已清理",
        `Worktree Manager 已处理 ${worktrees.length} 个 worktree。`,
        "Worktree Manager"
      )
    ];
    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item)),
      events: [...events, ...state.events]
    });
    return updatedQuest;
  }

  async retryQuest(questId: string): Promise<Quest> {
    await this.cleanupQuestWorktrees(questId);
    return this.runQuest(questId);
  }

  async deliverQuest(questId: string): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }
    const createdWorktrees = quest.worktrees.filter((worktree) => worktree.status === "created");
    const commitMessage = this.generateCommitMessage(quest);
    const auditEntries: AuditLogEntry[] = [];
    const deliveryResults = await Promise.all(
      createdWorktrees.map(async (worktree): Promise<DeliveryState> => {
        const project = state.projects.find((item) => item.id === worktree.projectId);
        if (!project) {
          return {
            projectId: worktree.projectId,
            worktreePath: worktree.worktreePath,
            status: "failed",
            commitMessage,
            note: "Project not found",
            createdAt: now()
          };
        }
        // Only gate on the command allowlist when there is an actual validation
        // command to run; an unconfigured (empty) command has nothing to approve.
        const validationCommand = project.validationCommand?.trim() ?? "";
        if (validationCommand) {
          const permission = this.evaluateCommandPermission(
            state.securityPolicy,
            `validation:${project.id}`,
            validationCommand
          );
          auditEntries.push(
            this.audit("command", permission.allowed ? "allowed" : "denied", validationCommand, permission.detail)
          );
          if (!permission.allowed) {
            return {
              projectId: project.id,
              worktreePath: worktree.worktreePath,
              status: "failed",
              commitMessage,
              note: permission.detail,
              createdAt: now()
            };
          }
        }
        const validation = await this.gitWorktreeManager.runValidation(worktree.worktreePath, project.validationCommand);
        if (validation.status === "failed") {
          return {
            projectId: project.id,
            worktreePath: worktree.worktreePath,
            status: "failed",
            commitMessage,
            note: validation.note,
            validationOutput: validation.output,
            createdAt: now()
          };
        }
        const commit = await this.gitWorktreeManager.commitAll(worktree.worktreePath, commitMessage);
        if (commit.status !== "ok") {
          return {
            projectId: project.id,
            worktreePath: worktree.worktreePath,
            status: "failed",
            commitMessage,
            note: commit.note,
            validationOutput: validation.output,
            createdAt: now()
          };
        }
        const pr = await this.gitWorktreeManager.createPullRequest(
          worktree.worktreePath,
          commitMessage,
          `RepoHelm Quest: ${quest.title}\n\n${quest.requirement}`
        );
        return {
          projectId: project.id,
          worktreePath: worktree.worktreePath,
          status: pr.status === "ok" ? "pr_created" : "pr_ready",
          commitMessage,
          note: pr.note,
          validationOutput: validation.output,
          commitSha: commit.commitSha,
          prUrl: pr.prUrl,
          createdAt: now()
        };
      })
    );
    const failed = deliveryResults.filter((result) => result.status === "failed");
    const succeeded = deliveryResults.length - failed.length;
    const nothingToDeliver = deliveryResults.length === 0;
    // Keep the quest where it was when there is genuinely nothing to deliver, rather
    // than implying a successful handoff.
    const nextStatus: QuestStatus = nothingToDeliver
      ? quest.status
      : failed.length === 0
        ? "delivered"
        : "ready";
    const updatedQuest: Quest = {
      ...quest,
      status: nextStatus,
      deliveryResults,
      validationResults: [
        ...quest.validationResults,
        nothingToDeliver
          ? "Delivery validation: 没有可交付的 worktree 或文件变更，已跳过交付。"
          : `Delivery validation: ${succeeded}/${deliveryResults.length} 个项目完成交付准备。`
      ],
      reviewNotes: [
        ...quest.reviewNotes,
        nothingToDeliver
          ? "Delivery Agent: 没有可交付内容，请先让 Agent 在 worktree 中产生文件变更。"
          : failed.length > 0
            ? "Delivery Agent: 部分项目交付失败，请查看 delivery results。"
            : "Delivery Agent: 交付前验证和 commit 已完成，可进入 PR handoff。"
      ],
      updatedAt: now()
    };
    const events = [
      this.event(
        questId,
        nothingToDeliver ? "delivery.skipped" : failed.length === 0 ? "delivery.completed" : "delivery.partial",
        nothingToDeliver ? "无可交付内容" : failed.length === 0 ? "交付准备完成" : "交付准备部分失败",
        nothingToDeliver
          ? "没有可交付的 worktree 或文件变更，交付已跳过。"
          : `${succeeded}/${deliveryResults.length} 个项目已完成验证、commit 和 PR handoff。`,
        "Delivery Agent"
      )
    ];
    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item)),
      events: [...events, ...state.events],
      auditLog: [...auditEntries, ...state.auditLog]
    });
    return updatedQuest;
  }

  async searchKnowledge(workspaceId: string, query = ""): Promise<KnowledgeItem[]> {
    const state = await this.getState();
    return this.searchKnowledgeItems(state.knowledge, workspaceId, query).slice(0, 20);
  }

  async listCapabilities(): Promise<CapabilityDefinition[]> {
    const state = await this.getState();
    return state.capabilities;
  }

  async getSecurityPolicy(): Promise<SecurityPolicy> {
    const state = await this.getState();
    return state.securityPolicy;
  }

  async updateSecurityPolicy(input: Partial<Omit<SecurityPolicy, "updatedAt">>): Promise<SecurityPolicy> {
    const state = await this.getState();
    const securityPolicy: SecurityPolicy = {
      ...state.securityPolicy,
      ...input,
      updatedAt: now()
    };
    await this.store.write({
      ...state,
      securityPolicy,
      auditLog: [
        this.audit("sandbox", "recorded", "security-policy", "安全执行策略已更新。"),
        ...state.auditLog
      ]
    });
    return securityPolicy;
  }

  async listAuditLog(): Promise<AuditLogEntry[]> {
    const state = await this.getState();
    return state.auditLog.slice(0, 100);
  }

  async getProductReadiness(workspaceId?: string): Promise<ProductReadiness> {
    const state = await this.getState();
    const workspace = workspaceId
      ? state.workspaces.find((item) => item.id === workspaceId)
      : state.workspaces[0];
    const projects = workspace
      ? state.projects.filter((project) => workspace.projectIds.includes(project.id))
      : [];
    const edges = projects.flatMap((project) =>
      projects
        .filter((candidate) => candidate.id !== project.id && project.role !== candidate.role)
        .slice(0, 1)
        .map((candidate) => ({
          from: project.id,
          to: candidate.id,
          label: `${project.role} -> ${candidate.role}`
        }))
    );

    return {
      version: "M8",
      status: "prototype-ready",
      milestones: [
        {
          id: "m4",
          label: "真实 Agent Backend",
          status: "ready",
          detail: "CLI backend、OpenAI-compatible provider、日志和 artifact 标准化已接入。"
        },
        {
          id: "m5",
          label: "Worktree 生命周期和交付",
          status: "ready",
          detail: "清理、重试、验证、commit 和 PR handoff 已接入。"
        },
        {
          id: "m6",
          label: "Capability Agent",
          status: "ready",
          detail: "skills、agents、MCP manifest 推荐和人工确认已接入。"
        },
        {
          id: "m7",
          label: "安全执行和权限模型",
          status: "ready",
          detail: "命令 allowlist、scope、secrets 策略、sandbox 声明和 audit log 已接入。"
        },
        {
          id: "m8",
          label: "完整产品形态",
          status: "ready",
          detail: "产品 readiness、模板方向、依赖地图和治理入口已可展示。"
        }
      ],
      workspaceTemplates: [
        {
          id: "single-repo",
          label: "Single Repo Workspace",
          status: "ready",
          detail: "适合一个仓库内完成 Quest、worktree 和交付闭环。"
        },
        {
          id: "multi-project",
          label: "Multi-project Workspace",
          status: "ready",
          detail: "适合 frontend/backend/docs 等多个项目共同参与 Quest。"
        },
        {
          id: "secure-agent",
          label: "Secure Agent Workspace",
          status: "ready",
          detail: "默认启用 capability review、安全审计和命令 allowlist。"
        }
      ],
      dependencyMap: {
        nodes: projects.map((project) => ({
          id: project.id,
          label: project.name,
          role: project.role
        })),
        edges
      },
      governance: [
        {
          id: "roadmap",
          label: "Roadmap",
          status: "ready",
          detail: "MILESTONES.md 已记录 M0-M8 状态。"
        },
        {
          id: "architecture",
          label: "Architecture",
          status: "ready",
          detail: "docs/architecture.md 记录产品边界和架构方向。"
        },
        {
          id: "testing",
          label: "Testing",
          status: "ready",
          detail: "pnpm test:all 覆盖 typecheck、unit 和 e2e。"
        }
      ]
    };
  }

  async acceptCapabilityRecommendation(questId: string, capabilityId: string): Promise<Quest> {
    return this.updateCapabilityRecommendation(questId, capabilityId, "accepted");
  }

  async dismissCapabilityRecommendation(questId: string, capabilityId: string): Promise<Quest> {
    return this.updateCapabilityRecommendation(questId, capabilityId, "dismissed");
  }

  private generateSpec(requirement: string, relatedKnowledge: Array<{ title: string }> = []): QuestSpec {
    return {
      background:
        relatedKnowledge.length > 0
          ? `用户创建了一个需要进入 Quest 工作流的软件研发任务。Agent 已参考 ${relatedKnowledge.length} 条 workspace 知识。`
          : "用户创建了一个需要进入 Quest 工作流的软件研发任务。",
      userGoal: requirement,
      functionalRequirements: [
        "明确任务目标和受影响项目。",
        "生成可审查的实施计划。",
        "在隔离 worktree 中准备实现。"
      ],
      nonFunctionalRequirements: [
        "执行过程需要可审计。",
        "默认不直接修改用户当前活跃工作目录。"
      ],
      affectedSurfaces: ["Workspace", "Quest", "Knowledge", "Worktree"],
      outOfScope: ["inline completion", "IDE 插件", "自动安装未审查的第三方能力"],
      acceptanceCriteria: [
        "Quest 中可以看到需求、Spec、计划和执行事件。",
        "每个受影响项目都有 worktree 计划。",
        "执行结束后生成 validation、review 和 knowledge memory。"
      ],
      openQuestions: ["是否需要为该 Quest 接入真实模型或外部 coding agent backend？"]
    };
  }

  private searchKnowledgeItems(knowledge: KnowledgeItem[], workspaceId: string, query: string): KnowledgeItem[] {
    const normalizedQuery = query.trim().toLowerCase();
    return knowledge
      .filter((item) => item.workspaceId === workspaceId)
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [item.title, item.body, ...item.tags].join("\n").toLowerCase();
        return normalizedQuery
          .split(/\s+/)
          .filter(Boolean)
          .some((token) => haystack.includes(token));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async ensureKnowledgeFiles(state: RepoHelmState): Promise<RepoHelmState> {
    const knowledge: KnowledgeItem[] = [];
    let changed = false;
    for (const item of state.knowledge) {
      if (item.sourcePath) {
        try {
          await access(item.sourcePath);
          knowledge.push(item);
          continue;
        } catch {
          // Rehydrate the Markdown knowledge file if the metadata survived but the file was removed.
        }
      }
      knowledge.push({
        ...item,
        sourcePath: await this.knowledgeFileStore.writeKnowledgeItem(item)
      });
      changed = true;
    }
    return changed ? { ...state, knowledge } : state;
  }

  private normalizeState(state: RepoHelmState): RepoHelmState {
    return {
      ...state,
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        projectIds: workspace.projectIds ?? [],
        worktrees: workspace.worktrees ?? [],
        worktreeRoot: workspace.worktreeRoot ?? this.worktreeRootDir,
        updatedAt: workspace.updatedAt ?? workspace.createdAt ?? now()
      })),
      projects: state.projects.map((project) => ({
        ...project,
        role: project.role ?? "unknown",
        defaultBranch: project.defaultBranch ?? "main",
        validationCommand: project.validationCommand ?? "",
        health: project.health ?? unknownHealth(),
        updatedAt: project.updatedAt ?? project.createdAt ?? now()
      })),
      quests: state.quests.map((quest) => ({
        ...quest,
        deliveryResults: quest.deliveryResults ?? [],
        capabilityRecommendations: quest.capabilityRecommendations ?? [],
        autoApprovePlan: quest.autoApprovePlan ?? false
      })),
      capabilities: state.capabilities?.length ? state.capabilities : this.seedCapabilities(now()),
      securityPolicy: state.securityPolicy ?? this.seedSecurityPolicy(now()),
      auditLog: state.auditLog ?? [],
      engine: state.engine ?? defaultEngineConfig(),
      modelCache: state.modelCache ?? {},
      subAgents: state.subAgents ?? {},
      entrySubAgentId: state.entrySubAgentId
    };
  }

  private generateCommitMessage(quest: Quest): string {
    return `RepoHelm: ${quest.title}`.slice(0, 72);
  }

  private async updateCapabilityRecommendation(
    questId: string,
    capabilityId: string,
    status: "accepted" | "dismissed"
  ): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }
    const capability = state.capabilities.find((item) => item.id === capabilityId);
    if (!capability) {
      throw new Error("Capability not found");
    }
    const updatedQuest: Quest = {
      ...quest,
      capabilityRecommendations: quest.capabilityRecommendations.map((item) =>
        item.capabilityId === capabilityId ? { ...item, status } : item
      ),
      updatedAt: now()
    };
    const capabilities = state.capabilities.map((item) =>
      item.id === capabilityId && status === "accepted"
        ? {
            ...item,
            installed: true,
            updatedAt: now()
          }
        : item
    );
    const events = [
      this.event(
        questId,
        status === "accepted" ? "capability.accepted" : "capability.dismissed",
        status === "accepted" ? "能力已确认" : "能力已忽略",
        `${capability.name} (${capability.kind}) 已被${status === "accepted" ? "标记为启用" : "忽略"}。权限声明：${capability.permissions.join(", ") || "none"}。`,
        "Capability Agent"
      )
    ];
    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item)),
      capabilities,
      events: [...events, ...state.events],
      auditLog: [
        this.audit(
          "capability",
          "recorded",
          capability.name,
          status === "accepted" ? "用户确认启用能力。" : "用户忽略能力推荐。"
        ),
        ...state.auditLog
      ]
    });
    return updatedQuest;
  }

  private seedCapabilities(timestamp: string): CapabilityDefinition[] {
    return [
      {
        id: "cap_spec_agent",
        kind: "agent",
        name: "Spec Agent",
        description: "将用户需求整理为背景、范围、验收标准和开放问题。",
        source: "builtin",
        permissions: ["read:workspace-knowledge", "write:quest-spec"],
        installed: true,
        tags: ["spec", "planning"],
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "cap_review_agent",
        kind: "agent",
        name: "Review Agent",
        description: "审查 worktree diff、验证结果和交付风险。",
        source: "builtin",
        permissions: ["read:worktree-diff", "write:review-notes"],
        installed: true,
        tags: ["review", "diff"],
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "cap_security_skill",
        kind: "skill",
        name: "Security Review Skill",
        description: "在涉及权限、命令执行、secrets 或 MCP 时提供安全检查清单。",
        source: "builtin",
        permissions: ["read:quest-spec", "read:changed-files"],
        installed: false,
        tags: ["security", "permission", "secrets"],
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "cap_mcp_manifest",
        kind: "mcp",
        name: "MCP Manifest Auditor",
        description: "记录 MCP server 来源、权限声明和人工确认状态。",
        source: "builtin",
        permissions: ["read:mcp-manifest", "write:audit-log"],
        installed: false,
        tags: ["mcp", "manifest", "audit"],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ];
  }

  private seedSecurityPolicy(timestamp: string): SecurityPolicy {
    return {
      commandApprovalMode: "allowlist",
      allowedCommands: ["mock", "node", "git", "pnpm"],
      fileScopes: ["workspace", "worktree", "knowledge"],
      networkScopes: ["localhost"],
      secretsPolicy: "redact-env",
      sandboxRuntime: "local",
      updatedAt: timestamp
    };
  }

  private evaluateCommandPermission(policy: SecurityPolicy, subject: string, command: string) {
    if (!command.trim()) {
      return {
        allowed: true,
        detail: `${subject} 没有配置命令，按跳过处理。`
      };
    }
    if (policy.commandApprovalMode === "manual") {
      return {
        allowed: false,
        detail: `${subject} 需要人工审批，当前安全策略不允许自动执行。`
      };
    }
    const commandName = command.trim().split(/\s+/)[0] ?? command;
    const allowed = policy.allowedCommands.includes(commandName) || policy.allowedCommands.includes(subject);
    return {
      allowed,
      detail: allowed
        ? `${subject} 命令 "${commandName}" 命中 allowlist。`
        : `${subject} 命令 "${commandName}" 不在 allowlist 中。`
    };
  }

  private audit(type: AuditLogEntry["type"], decision: AuditLogEntry["decision"], subject: string, detail: string): AuditLogEntry {
    return {
      id: id("audit"),
      type,
      decision,
      subject,
      detail,
      createdAt: now()
    };
  }

  private recommendCapabilities(
    capabilities: CapabilityDefinition[],
    requirement: string,
    timestamp: string
  ): CapabilityRecommendation[] {
    const normalized = requirement.toLowerCase();
    return capabilities
      .filter((capability) => {
        if (capability.installed && capability.kind !== "agent") {
          return false;
        }
        return (
          capability.kind === "agent" ||
          capability.tags.some((tag) => normalized.includes(tag)) ||
          normalized.includes(capability.kind)
        );
      })
      .slice(0, 4)
      .map((capability) => ({
        capabilityId: capability.id,
        reason: `${capability.name} 匹配当前 Quest 的 ${capability.tags.join(", ")} 能力需求。`,
        confidence: capability.kind === "agent" ? 0.72 : 0.86,
        requiredPermissions: capability.permissions,
        status: "pending",
        createdAt: timestamp
      }));
  }

  private event(questId: string, type: string, title: string, detail: string, agent: string): AgentEvent {
    return {
      id: id("event"),
      questId,
      type,
      title,
      detail,
      agent,
      createdAt: now()
    };
  }
}
