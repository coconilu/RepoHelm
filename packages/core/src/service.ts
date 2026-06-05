import { join, resolve } from "node:path";
import { nanoid } from "nanoid";
import { AgentBackendRegistry } from "./agent.js";
import { GitWorktreeManager } from "./git.js";
import type {
  AgentEvent,
  CreateProjectInput,
  CreateQuestInput,
  CreateWorkspaceInput,
  KnowledgeItem,
  Project,
  ProjectHealth,
  Quest,
  QuestSpec,
  RepoHelmState,
  UpdateProjectInput,
  UpdateWorkspaceInput,
  Workspace,
  WorktreeState
} from "./types.js";
import { JsonStateStore } from "./store.js";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${nanoid(10)}`;
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
  private readonly worktreeRootDir: string;

  constructor(
    private readonly store: JsonStateStore,
    private readonly rootDir: string,
    options: { worktreeRootDir?: string } = {}
  ) {
    this.worktreeRootDir = options.worktreeRootDir ?? join(rootDir, ".repohelm", "worktrees");
  }

  async bootstrap(): Promise<RepoHelmState> {
    const state = await this.store.read();
    if (state.workspaces.length > 0) {
      const normalized = this.normalizeState(state);
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
      worktreeRoot: this.worktreeRootDir,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const project: Project = {
      id: "project_repohelm",
      workspaceId: workspace.id,
      name: "RepoHelm",
      path: this.rootDir,
      role: "unknown",
      defaultBranch: "main",
      validationCommand: "pnpm test:all",
      health: unknownHealth(),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const knowledge: KnowledgeItem = {
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

    const nextState: RepoHelmState = {
      ...state,
      workspaces: [workspace],
      projects: [project],
      knowledge: [knowledge]
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
    const workspace = state.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const project: Project = {
      id: id("project"),
      workspaceId: input.workspaceId,
      name: input.name,
      path: input.path,
      role: input.role ?? "unknown",
      defaultBranch: input.defaultBranch ?? "main",
      validationCommand: input.validationCommand ?? "",
      health: unknownHealth(),
      createdAt: now(),
      updatedAt: now()
    };
    const workspaces = state.workspaces.map((item) =>
      item.id === input.workspaceId
        ? { ...item, projectIds: [...item.projectIds, project.id], updatedAt: now() }
        : item
    );

    await this.store.write({ ...state, workspaces, projects: [project, ...state.projects] });
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
              message: "项目配置已变更，等待重新检查。"
            }
          : project.health,
      updatedAt: now()
    };
    const projects = state.projects.map((item) => (item.id === projectId ? updatedProject : item));
    await this.store.write({ ...state, projects });
    return updatedProject;
  }

  async removeProject(projectId: string): Promise<RepoHelmState> {
    const state = await this.getState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const projects = state.projects.filter((item) => item.id !== projectId);
    const workspaces = state.workspaces.map((workspace) =>
      workspace.id === project.workspaceId
        ? {
            ...workspace,
            projectIds: workspace.projectIds.filter((id) => id !== projectId),
            updatedAt: now()
          }
        : workspace
    );
    const quests = state.quests.map((quest) => ({
      ...quest,
      affectedProjectIds: quest.affectedProjectIds.filter((id) => id !== projectId)
    }));
    const nextState = { ...state, projects, workspaces, quests };
    await this.store.write(nextState);
    return nextState;
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
    const spec = this.generateSpec(input.requirement);
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
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const events = [
      this.event(questId, "quest.created", "Quest 已创建", "用户需求已进入 Quest 工作流。", "Lead Agent"),
      this.event(questId, "spec.generated", "轻量 Spec 已生成", "Spec Agent 根据需求生成了初版目标、范围和验收标准。", "Spec Agent"),
      this.event(questId, "plan.created", "实施计划已生成", "Lead Agent 已将 Quest 推进到规划阶段，等待准备 worktree。", "Lead Agent")
    ];

    await this.store.write({
      ...state,
      quests: [quest, ...state.quests],
      events: [...events, ...state.events]
    });
    return quest;
  }

  async runQuest(questId: string): Promise<Quest> {
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
    const backendResult = await backend.run({ quest, worktrees });
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
      knowledge: [memory, ...state.knowledge]
    });
    return updatedQuest;
  }

  private generateSpec(requirement: string): QuestSpec {
    return {
      background: "用户创建了一个需要进入 Quest 工作流的软件研发任务。",
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

  private normalizeState(state: RepoHelmState): RepoHelmState {
    return {
      ...state,
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        projectIds: workspace.projectIds ?? [],
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
      }))
    };
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
