import type { RepoHelmService } from "../service.js";
import type {
  ExpertSession,
  ExpertSessionStatus,
  ExpertTaskNode,
} from "./types.js";

const VALID_TRANSITIONS: Record<ExpertSessionStatus, ExpertSessionStatus[]> = {
  analyzing: ["awaiting_confirmation", "failed"],
  awaiting_confirmation: ["confirmed", "analyzing", "failed"],
  confirmed: ["executing", "failed"],
  executing: ["completed", "failed"],
  completed: [],
  failed: ["analyzing"],
};

export interface CreateSessionInput {
  questId: string;
  entryAgentId: string;
}

export class ExpertSessionManager {
  private sessions: Map<string, ExpertSession> = new Map();

  constructor(private service: RepoHelmService) {}

  async createSession(input: CreateSessionInput): Promise<ExpertSession> {
    const rootNode: ExpertTaskNode = {
      id: "root",
      title: input.questId,
      type: "root",
      status: "pending",
      children: [],
      dependencies: [],
      artifacts: [],
      description: "",
      expectedOutput: "",
    };

    const session: ExpertSession = {
      id: `expert_${input.questId}`,
      questId: input.questId,
      status: "analyzing",
      entryAgentId: input.entryAgentId,
      taskTree: rootNode,
      flatTasks: [],
      acceptanceTests: [],
      research: [],
      agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
      createdAt: new Date().toISOString(),
      errors: [],
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(id: string): Promise<ExpertSession | undefined> {
    return this.sessions.get(id);
  }

  async transitionStatus(
    sessionId: string,
    newStatus: ExpertSessionStatus
  ): Promise<ExpertSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} 不存在`);
    }

    const allowed = VALID_TRANSITIONS[session.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `非法状态转换: ${session.status} → ${newStatus}，允许: ${allowed.join(", ")}`
      );
    }

    session.status = newStatus;
    if (newStatus === "confirmed") {
      session.confirmedAt = new Date().toISOString();
    }
    if (newStatus === "completed" || newStatus === "failed") {
      session.completedAt = new Date().toISOString();
    }

    return session;
  }

  async listSessions(questId?: string): Promise<ExpertSession[]> {
    const all = Array.from(this.sessions.values());
    if (questId) {
      return all.filter((s) => s.questId === questId);
    }
    return all;
  }
}
