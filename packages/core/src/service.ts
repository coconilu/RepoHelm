import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { nanoid } from "nanoid";
import { AgentBackendRegistry } from "./agent.js";
import { LocalCliRegistry } from "./cli.js";
import { GitWorktreeManager } from "./git.js";
import { KnowledgeFileStore } from "./knowledge.js";
import { ProviderRegistry } from "./providers.js";
import { SubAgentOrchestrator } from "./orchestrator.js";
import type {
  AgentEvent,
  AuditLogEntry,
  CapabilityDefinition,
  CapabilityRecommendation,
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
  Project,
  ProjectHealth,
  ProductReadiness,
  ProviderInfo,
  ProviderModelsResult,
  Quest,
  QuestSpec,
  RepoHelmState,
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

  /** Serializes read-modify-write cycles to prevent concurrent writes from clobbering each other. */
  private _mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: StateStore,
    private readonly rootDir: string,
    options: { knowledgeRootDir?: string; worktreeRootDir?: string } = {}
  ) {
    this.worktreeRootDir = options.worktreeRootDir ?? join(rootDir, ".repohelm", "worktrees");
    this.knowledgeFileStore = new KnowledgeFileStore(options.knowledgeRootDir ?? join(rootDir, ".repohelm", "knowledge"));
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
    const architectureKnowledge: KnowledgeItem = {
      id: "knowledge_architecture_seed",
      workspaceId: workspace.id,
      projectId: project.id,
      type: "architecture",
      title: "RepoHelm 产品方向",
      body: "RepoHelm 聚焦 Quest 工作区：虚拟 workspace、多项目任务、Spec 驱动、worktree 隔离、知识库和多 Agent 编排。",
      tags: ["architecture", "mvp"],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const knowledge = [
      {
        ...architectureKnowledge,
        sourcePath: await this.knowledgeFileStore.writeKnowledgeItem(architectureKnowledge)
      },
      await this.knowledgeFileStore.writeProjectSummary(project, timestamp)
    ];

    const nextState: RepoHelmState = {
      ...state,
      workspaces: [workspace],
      projects: [project],
      knowledge,
      capabilities: this.seedCapabilities(timestamp)
    };
    await this.store.write(nextState);
    return nextState;
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

    const projectSummary = await this.knowledgeFileStore.writeProjectSummary(project, now());
    await this.store.write({
      ...state,
      projects: [project, ...state.projects],
      knowledge: [projectSummary, ...state.knowledge]
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
    const projectSummary = await this.knowledgeFileStore.writeProjectSummary(updatedProject, now());
    const knowledge = [projectSummary, ...state.knowledge.filter((item) => item.id !== projectSummary.id)];
    await this.store.write({ ...state, projects, knowledge });
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

      if (subAgent.mode === "worker") {
        throw new Error("Cannot set worker sub-agent as entry point");
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

  async createQuest(input: CreateQuestInput): Promise<Quest> {
    const state = await this.getState();
    const workspace = state.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const affectedProjectIds =
      input.affectedProjectIds && input.affectedProjectIds.length > 0
        ? input.affectedProjectIds
        : workspace.projectIds;
    const timestamp = now();
    const questId = id("quest");
    const relatedKnowledge = this.searchKnowledgeItems(state.knowledge, input.workspaceId, input.requirement).slice(0, 3);
    const spec = this.generateSpec(input.requirement, relatedKnowledge);
    const capabilityRecommendations = this.recommendCapabilities(state.capabilities, input.requirement, timestamp);
    const quest: Quest = {
      id: questId,
      workspaceId: input.workspaceId,
      title: input.title,
      requirement: input.requirement,
      status: "planning",
      spec,
      agentBackendId: input.agentBackendId ?? "mock",
      affectedProjectIds,
      worktrees: [],
      changedFiles: [],
      validationResults: [],
      reviewNotes: [],
      deliveryResults: [],
      capabilityRecommendations,
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
    // 检查是否配置了入口 Sub-agent
    const entryAgent = await this.getEntrySubAgent();
    
    if (entryAgent) {
      // 使用新的编排引擎
      const orchestrator = new SubAgentOrchestrator(this);
      try {
        const result = await orchestrator.executeQuest(questId);
        // 更新 Quest 状态为完成
        return this.updateQuestStatus(questId, "delivered", result);
      } catch (error) {
        // 编排失败,回退到传统模式
        console.error("Orchestration failed, falling back to legacy mode:", error);
        return this.runQuestLegacy(questId);
      }
    } else {
      // 没有配置入口 agent,使用传统模式
      return this.runQuestLegacy(questId);
    }
  }

  /**
   * 传统的单次 backend.run() 逻辑
   */
  private async runQuestLegacy(questId: string): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }
    const workspace = state.workspaces.find((item) => item.id === quest.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const branchSuffix = quest.id.replace(/^quest_/, "").toLowerCase().slice(0, 8);
    const branchName = `repohelm/${slugify(quest.title)}-${branchSuffix}`;
    const worktrees = await Promise.all(
      quest.affectedProjectIds.map<Promise<WorktreeState>>(async (projectId) => {
        const project = state.projects.find((item) => item.id === projectId);
        const projectName = project?.name ?? projectId;
        const worktreeRoot = workspace.worktreeRoot ? resolve(workspace.worktreeRoot) : this.worktreeRootDir;
        const worktreePath = join(worktreeRoot, slugify(quest.title), slugify(projectName));
        if (!project) {
          return {
            projectId,
            branchName,
            worktreePath,
            status: "failed",
            note: "Project not found"
          };
        }
        const result = await this.gitWorktreeManager.createWorktree({
          repoPath: project.path,
          branchName,
          worktreePath
        });
        return {
          projectId,
          branchName: result.branchName,
          worktreePath: result.worktreePath,
          status: result.status,
          note: result.note,
          repoRoot: result.repoRoot
        };
      })
    );
    const createdWorktrees = worktrees.filter((worktree) => worktree.status === "created");
    const failedWorktrees = worktrees.filter((worktree) => worktree.status === "failed");
    const backend = this.agentBackendRegistry.get(quest.agentBackendId ?? "mock");
    const backendAvailability = await backend.getAvailability();
    const backendPermission = this.evaluateCommandPermission(
      state.securityPolicy,
      backend.id,
      backendAvailability.command ?? backend.id
    );
    const backendAudit = this.audit(
      "command",
      backendPermission.allowed ? "allowed" : "denied",
      backend.name,
      backendPermission.detail
    );
    const backendResult = backendPermission.allowed
      ? await backend.run({ quest, worktrees })
      : {
          status: "blocked" as const,
          summary: backendPermission.detail,
          events: [
            {
              type: "security.command.denied",
              title: "命令执行被安全策略阻止",
              detail: backendPermission.detail,
              agent: "Security Agent"
            }
          ]
        };
    const changedFiles = (
      await Promise.all(
        createdWorktrees.map((worktree) =>
          this.gitWorktreeManager.getChangedFiles(worktree.projectId, worktree.worktreePath).catch(() => [])
        )
      )
    ).flat();

    const updatedQuest: Quest = {
      ...quest,
      status:
        backendResult.status === "blocked" || (failedWorktrees.length > 0 && createdWorktrees.length === 0)
          ? "blocked"
          : "ready",
      worktrees,
      changedFiles,
      agentSummary: backendResult.summary,
      deliveryResults: [],
      validationResults: [
        `Agent backend: ${backend.name} (${backendResult.status})。`,
        "Spec validation: Spec 覆盖了用户目标、受影响项目和验收标准。",
        createdWorktrees.length > 0
          ? `Worktree validation: 已创建 ${createdWorktrees.length} 个 Git worktree。`
          : "Worktree validation: 没有成功创建 Git worktree。",
        changedFiles.length > 0
          ? `Diff validation: 检测到 ${changedFiles.length} 个文件变更，可进入 diff review。`
          : "Diff validation: 未检测到文件变更。",
        failedWorktrees.length > 0 ? `Worktree validation: ${failedWorktrees.length} 个项目创建失败。` : ""
      ].filter(Boolean),
      reviewNotes: [
        backendResult.status === "blocked" ? `Review Agent: ${backendResult.summary}` : "",
        changedFiles.length > 0
          ? "Review Agent: 当前 worktree 中已有文件变更，可以进入 diff review。"
          : "Review Agent: 当前 worktree 暂无文件变更，等待真实 implementation agent 写入代码。",
        failedWorktrees.length > 0
          ? "Review Agent: 部分项目 worktree 创建失败，需要先处理 Git 仓库或路径问题。"
          : "Review Agent: Worktree 隔离已就绪，可以安全接入 implementation agent。"
      ].filter(Boolean),
      updatedAt: now()
    };

    const memory: KnowledgeItem = {
      id: id("knowledge"),
      workspaceId: workspace.id,
      questId,
      type: "memory",
      title: `Quest Memory: ${quest.title}`,
      body: `本次 Quest 记录了需求 "${quest.requirement}" 的 Spec，创建了 ${createdWorktrees.length} 个 Git worktree，并生成了 ${changedFiles.length} 个可 review 变更。`,
      tags: ["quest", "memory"],
      createdAt: now(),
      updatedAt: now()
    };
    const persistedMemory: KnowledgeItem = {
      ...memory,
      sourcePath: await this.knowledgeFileStore.writeKnowledgeItem(memory)
    };

    const events = [
      ...backendResult.events.map((event) => this.event(questId, event.type, event.title, event.detail, event.agent)),
      this.event(
        questId,
        "worktree.created",
        createdWorktrees.length > 0 ? "Worktree 已创建" : "Worktree 创建失败",
        createdWorktrees.length > 0
          ? `Worktree Manager 已为 ${createdWorktrees.length} 个项目创建隔离 worktree。`
          : "Worktree Manager 未能创建任何 worktree。",
        "Workspace Analyst"
      ),
      this.event(questId, "agent.completed", "Agent backend 已完成", backendResult.summary, backend.name),
      this.event(questId, "validation.completed", "验证完成", "Test Agent 生成了 mock validation 结果。", "Test Agent"),
      this.event(questId, "review.completed", "Review 完成", "Review Agent 已输出风险和下一步建议。", "Review Agent"),
      this.event(questId, "knowledge.updated", "知识库已更新", "Knowledge Agent 记录了本次 Quest memory。", "Knowledge Agent")
    ];

    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item)),
      events: [...events, ...state.events],
      knowledge: [persistedMemory, ...state.knowledge],
      auditLog: [backendAudit, ...state.auditLog]
    });
    return updatedQuest;
  }

  /**
   * 更新 Quest 状态（用于编排引擎）
   */
  private async updateQuestStatus(questId: string, status: Quest["status"], result?: any): Promise<Quest> {
    const state = await this.getState();
    const quest = state.quests.find((item) => item.id === questId);
    if (!quest) {
      throw new Error("Quest not found");
    }

    const updatedQuest: Quest = {
      ...quest,
      status,
      agentSummary: result ? JSON.stringify(result) : undefined,
      updatedAt: now()
    };

    await this.store.write({
      ...state,
      quests: state.quests.map((item) => (item.id === questId ? updatedQuest : item))
    });

    return updatedQuest;
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
        const permission = this.evaluateCommandPermission(
          state.securityPolicy,
          `validation:${project.id}`,
          project.validationCommand || "validation:skipped"
        );
        auditEntries.push(
          this.audit("command", permission.allowed ? "allowed" : "denied", project.validationCommand || "validation:skipped", permission.detail)
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
    const updatedQuest: Quest = {
      ...quest,
      status: deliveryResults.length > 0 && failed.length === 0 ? "delivered" : "ready",
      deliveryResults,
      validationResults: [
        ...quest.validationResults,
        deliveryResults.length > 0
          ? `Delivery validation: ${deliveryResults.length - failed.length}/${deliveryResults.length} 个项目完成交付准备。`
          : "Delivery validation: 没有可交付的 worktree。"
      ],
      reviewNotes: [
        ...quest.reviewNotes,
        failed.length > 0
          ? "Delivery Agent: 部分项目交付失败，请查看 delivery results。"
          : "Delivery Agent: 交付前验证和 commit 已完成，可进入 PR handoff。"
      ],
      updatedAt: now()
    };
    const events = [
      this.event(
        questId,
        "delivery.completed",
        failed.length === 0 ? "交付准备完成" : "交付准备部分失败",
        deliveryResults.length > 0
          ? `${deliveryResults.length - failed.length}/${deliveryResults.length} 个项目已完成验证、commit 和 PR handoff。`
          : "没有可交付的 worktree。",
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

  private generateSpec(requirement: string, relatedKnowledge: KnowledgeItem[] = []): QuestSpec {
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
        capabilityRecommendations: quest.capabilityRecommendations ?? []
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
