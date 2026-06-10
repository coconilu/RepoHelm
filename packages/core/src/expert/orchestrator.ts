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
    session = await this.sessionManager.transitionStatus(session.id, "awaiting_confirmation");
    return { session, taskTree, acceptanceTests };
  }

  private async invokeEntryAgentAnalysis(session: ExpertSession, requirement: string, _researchCollector: ResearchCollector, _preferences: any[], _failurePatterns: any[]): Promise<ExpertTaskNode> {
    // TODO: 接入 LLM backend 生成任务树
    return { id: "root", title: session.questId, type: "root", status: "pending", children: [], dependencies: [], artifacts: [], description: requirement, expectedOutput: "" };
  }

  private async generateAcceptanceTests(_session: ExpertSession, _requirement: string, _taskTree: ExpertTaskNode): Promise<AcceptanceTest[]> {
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
