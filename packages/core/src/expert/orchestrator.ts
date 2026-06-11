import { ExpertSessionManager } from "./session-manager.js";
import { AgentPool } from "./agent-pool.js";
import { BUILTIN_EXPERT_PROTOTYPES } from "./agent-prototypes.js";
import { ResearchCollector } from "./research-collector.js";
import type { ExpertSession, ExpertTaskNode, ExpertTask, AcceptanceTest } from "./types.js";
import type { RepoHelmService } from "../service.js";

export interface StartSessionInput {
  questId: string; requirement: string; entryAgentId: string; projectIds?: string[];
}
export interface AnalyzeResult { session: ExpertSession; taskTree: ExpertTaskNode; acceptanceTests: AcceptanceTest[]; }

export class ExpertOrchestrator {
  private agentPool: AgentPool;

  constructor(private service: RepoHelmService, private sessionManager: ExpertSessionManager) {
    this.agentPool = new AgentPool();
    for (const proto of BUILTIN_EXPERT_PROTOTYPES) this.agentPool.registerPrototype(proto);
  }

  async startSession(input: StartSessionInput): Promise<ExpertSession> {
    return this.sessionManager.createSession({ questId: input.questId, entryAgentId: input.entryAgentId });
  }

  async analyzeAndDecompose(input: StartSessionInput): Promise<AnalyzeResult> {
    let session = await this.startSession(input);
    const preferences = await this.service.getUserPreferences();
    const failurePatterns = await this.service.getFailurePatterns();
    const researchCollector = new ResearchCollector(this.service);
    const taskTree = await this.invokeEntryAgentAnalysis(session, input.requirement, researchCollector, preferences, failurePatterns);
    const acceptanceTests = await this.generateAcceptanceTests(session, input.requirement, taskTree);
    session.taskTree = taskTree;
    session.flatTasks = this.flattenTasks(taskTree);
    session.acceptanceTests = acceptanceTests;
    session.research = researchCollector.getAll();
    session.agentPool = this.agentPool.getSnapshot();
    // fake mode: 标记活跃 Agent
    if (process.env.REPOHELM_FAKE_MODELS === "1") {
      session.agentPool.activeAgents = ["expert-coder", "expert-tester", "expert-architect"];
    }
    session = await this.sessionManager.transitionStatus(session.id, "awaiting_confirmation");
    return { session, taskTree, acceptanceTests };
  }

  private async invokeEntryAgentAnalysis(session: ExpertSession, requirement: string, researchCollector: ResearchCollector, _preferences: any[], _failurePatterns: any[]): Promise<ExpertTaskNode> {
    if (process.env.REPOHELM_FAKE_MODELS === "1") {
      const children: ExpertTaskNode[] = [
        { id: "task-1", title: "分析需求并设计接口", type: "analysis", status: "pending", children: [], dependencies: [], artifacts: [], description: "分析用户需求的边界和约束", expectedOutput: "接口设计文档" },
        { id: "task-2", title: "实现核心逻辑", type: "implementation", status: "pending", assignedAgentId: "expert-coder", assignedAgentName: "工程师", children: [], dependencies: ["task-1"], artifacts: [], description: "根据设计实现核心业务逻辑", expectedOutput: "核心模块代码" },
        { id: "task-3", title: "编写测试并验证", type: "test", status: "pending", assignedAgentId: "expert-tester", assignedAgentName: "测试工程师", children: [], dependencies: ["task-2"], artifacts: [], description: "编写单元测试和集成测试", expectedOutput: "测试通过报告" },
      ];
      // 伴随写入调研结果
      researchCollector.createResult({ type: "reusable_function", title: "validateInput()", summary: "输入校验工具函数，可复用", filePath: "src/utils/validate.ts", codeSnippet: "export function validateInput(data: unknown) { ... }", lineRange: { start: 1, end: 25 }, taskId: "task-2" });
      researchCollector.createResult({ type: "existing_logic", title: "当前请求处理流程", summary: "现有代码中请求经过 middleware → handler → service 三层处理", filePath: "src/server/handler.ts", lineRange: { start: 10, end: 50 }, taskId: "task-2" });
      researchCollector.createResult({ type: "proposed_change", title: "建议引入缓存层", summary: "在 handler 和 service 之间增加缓存层，减少重复计算", proposedLogic: "middleware → cache → handler → service", reasoning: "当前每次请求都重新计算，缓存可提升性能", taskId: "task-2" });
      researchCollector.createResult({ type: "related_code", title: "类似功能的实现", summary: "项目中已有类似的 CRUD 模块可参考", filePath: "src/modules/crud.ts" });
      return { id: "root", title: session.questId, type: "root", status: "pending", children, dependencies: [], artifacts: [], description: requirement, expectedOutput: "" };
    }
    // TODO: 接入 LLM backend 生成任务树
    return { id: "root", title: session.questId, type: "root", status: "pending", children: [], dependencies: [], artifacts: [], description: requirement, expectedOutput: "" };
  }

  private async generateAcceptanceTests(_session: ExpertSession, requirement: string, _taskTree: ExpertTaskNode): Promise<AcceptanceTest[]> {
    if (process.env.REPOHELM_FAKE_MODELS === "1") {
      return [
        { id: "at-1", title: "功能测试", description: `核心功能正常工作 — ${requirement.slice(0, 50)}`, status: "draft", testType: "unit", relatedTaskIds: ["task-2"], userConfirmed: false },
        { id: "at-2", title: "集成测试", description: "各模块协同工作，数据流完整", status: "draft", testType: "integration", relatedTaskIds: ["task-2", "task-3"], userConfirmed: false },
        { id: "at-3", title: "边界测试", description: "异常输入和边界条件处理正确", status: "draft", testType: "unit", relatedTaskIds: ["task-1"], userConfirmed: false },
      ];
    }
    // TODO: 接入 LLM backend 生成验收用例
    return [];
  }

  private flattenTasks(node: ExpertTaskNode): ExpertTask[] {
    const tasks: ExpertTask[] = [];
    if (node.type !== "root") {
      tasks.push({ id: node.id, nodeId: node.id, title: node.title, description: node.description, type: node.type, status: node.status, assignedAgentId: node.assignedAgentId, assignedAgentName: node.assignedAgentName, artifacts: node.artifacts });
    }
    for (const child of node.children) tasks.push(...this.flattenTasks(child));
    return tasks;
  }
}
