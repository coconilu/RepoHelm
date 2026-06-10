import { describe, expect, it, vi, beforeEach } from "vitest";
import { ExpertOrchestrator } from "./orchestrator.js";

function createMocks() {
  const service = {
    readState: vi.fn().mockResolvedValue({ quests: [], subAgents: {}, engine: {} }),
    getEntrySubAgent: vi.fn().mockResolvedValue({ id: "supervisor", name: "Supervisor", modelKitId: "default" }),
    getUserPreferences: vi.fn().mockResolvedValue([]),
    getFailurePatterns: vi.fn().mockResolvedValue([]),
    searchProjectKnowledge: vi.fn().mockResolvedValue([]),
  };
  const sessionManager = {
    createSession: vi.fn().mockImplementation(async (input) => ({
      id: `expert_${input.questId}`, ...input, status: "analyzing",
      taskTree: { id: "root", title: input.questId, type: "root", status: "pending", children: [], dependencies: [], artifacts: [], description: "", expectedOutput: "" },
      flatTasks: [], acceptanceTests: [], research: [],
      agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
      createdAt: new Date().toISOString(), errors: [],
    })),
    transitionStatus: vi.fn().mockImplementation(async (id, status) => ({ id, status })),
  };
  return { service, sessionManager };
}

describe("ExpertOrchestrator", () => {
  let orchestrator: ExpertOrchestrator;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    orchestrator = new ExpertOrchestrator(mocks.service as any, mocks.sessionManager as any);
  });

  it("应该创建 session 并进入分析阶段", async () => {
    const session = await orchestrator.startSession({ questId: "test-1", requirement: "实现用户登录功能", entryAgentId: "supervisor" });
    expect(session.id).toBe("expert_test-1");
    expect(session.status).toBe("analyzing");
    expect(mocks.sessionManager.createSession).toHaveBeenCalled();
  });

  it("应该完成分析并进入等待确认状态", async () => {
    const result = await orchestrator.analyzeAndDecompose({ questId: "test-2", requirement: "添加用户认证", entryAgentId: "supervisor" });
    expect(result.session.status).toBe("awaiting_confirmation");
    expect(mocks.sessionManager.transitionStatus).toHaveBeenCalledWith(expect.anything(), "awaiting_confirmation");
  });
});
