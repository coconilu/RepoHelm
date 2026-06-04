import { join } from "node:path";
import { nanoid } from "nanoid";
import type {
  AgentEvent,
  CreateProjectInput,
  CreateQuestInput,
  CreateWorkspaceInput,
  KnowledgeItem,
  Project,
  Quest,
  QuestSpec,
  RepoHelmState,
  Workspace,
  WorktreeState
} from "./types.js";
import { JsonStateStore } from "./store.js";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${nanoid(10)}`;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48) || "quest";

export class RepoHelmService {
  constructor(
    private readonly store: JsonStateStore,
    private readonly rootDir: string
  ) {}

  async bootstrap(): Promise<RepoHelmState> {
    const state = await this.store.read();
    if (state.workspaces.length > 0) {
      return state;
    }

    const timestamp = now();
    const workspace: Workspace = {
      id: "ws_demo",
      name: "RepoHelm Demo Workspace",
      description: "一个用于体验 Quest 工作流的虚拟 workspace。",
      projectIds: ["project_repohelm"],
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
      createdAt: timestamp
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

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const state = await this.getState();
    const timestamp = now();
    const workspace: Workspace = {
      id: id("ws"),
      name: input.name,
      description: input.description ?? "",
      projectIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.store.write({ ...state, workspaces: [workspace, ...state.workspaces] });
    return workspace;
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
      createdAt: now()
    };
    const workspaces = state.workspaces.map((item) =>
      item.id === input.workspaceId
        ? { ...item, projectIds: [...item.projectIds, project.id], updatedAt: now() }
        : item
    );

    await this.store.write({ ...state, workspaces, projects: [project, ...state.projects] });
    return project;
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

    const branchName = `repohelm/${slugify(quest.title)}`;
    const worktrees = quest.affectedProjectIds.map<WorktreeState>((projectId) => {
      const project = state.projects.find((item) => item.id === projectId);
      const projectName = project?.name ?? projectId;
      return {
        projectId,
        branchName,
        worktreePath: join(this.rootDir, ".repohelm", "worktrees", slugify(quest.title), slugify(projectName)),
        status: "planned",
        note: "第一版先记录 worktree 计划，不自动修改用户仓库。"
      };
    });

    const updatedQuest: Quest = {
      ...quest,
      status: "ready",
      worktrees,
      changedFiles: [
        "docs/specs/quest-spec.md",
        "src/example/implementation-plan.ts",
        "docs/knowledge/quest-memory.md"
      ],
      validationResults: [
        "Mock validation: Spec 覆盖了用户目标、受影响项目和验收标准。",
        "Mock validation: Worktree 计划已生成，等待真实 Git 集成。"
      ],
      reviewNotes: [
        "Review Agent: 第一版没有直接写入业务项目，风险较低。",
        "Review Agent: 下一步需要接入真实 worktree create 和 diff 读取。"
      ],
      updatedAt: now()
    };

    const memory: KnowledgeItem = {
      id: id("knowledge"),
      workspaceId: workspace.id,
      questId,
      type: "memory",
      title: `Quest Memory: ${quest.title}`,
      body: `本次 Quest 记录了需求 "${quest.requirement}" 的 Spec、worktree 计划和 mock validation。`,
      tags: ["quest", "memory"],
      createdAt: now(),
      updatedAt: now()
    };

    const events = [
      this.event(questId, "worktree.planned", "Worktree 计划已生成", "Worktree Manager 为受影响项目生成了隔离分支和路径。", "Workspace Analyst"),
      this.event(questId, "agent.started", "Implementation Agent 已执行", "第一版使用 mock implementation agent 展示执行闭环。", "Implementation Agent"),
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

