import { describe, expect, it } from "vitest";
import { migrateQuestToSession } from "./migration.js";
import type { Quest, OrchestrationPlan } from "../types.js";

function makeOldQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: "q-1", workspaceId: "ws-1", title: "测试 Quest", requirement: "实现登录功能",
    status: "ready", spec: { title: "测试", steps: [] }, agentBackendId: "mock",
    affectedProjectIds: ["proj-1"], worktrees: [],
    changedFiles: [{ projectId: "proj-1", path: "src/auth.ts", status: "added", diff: "+ new file", worktreePath: "/tmp/wt" }],
    validationResults: [], reviewNotes: ["代码质量良好"], deliveryResults: [], capabilityRecommendations: [],
    autoApprovePlan: false, createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T01:00:00Z",
    ...overrides,
  };
}

function makeOldPlan(): OrchestrationPlan {
  return {
    questId: "q-1", summary: "实现登录",
    steps: [
      { id: "s1", description: "写认证模块", agentId: "coder", agentName: "Coder", dependencies: [], expectedOutput: "auth.ts", targetProjectId: "proj-1" },
      { id: "s2", description: "写登录页面", agentId: "coder", agentName: "Coder", dependencies: ["s1"], expectedOutput: "login.tsx", targetProjectId: "proj-1" },
    ],
    generatedAt: "2026-06-01T00:00:00Z",
  };
}

describe("migrateQuestToSession", () => {
  it("应该将旧 Quest + Plan 转换为 ExpertSession", () => {
    const session = migrateQuestToSession(makeOldQuest(), makeOldPlan());
    expect(session.id).toBe("expert_q-1");
    expect(session.questId).toBe("q-1");
    expect(session.status).toBe("completed");
    expect(session.taskTree.type).toBe("root");
    expect(session.taskTree.children).toHaveLength(2);
    expect(session.flatTasks).toHaveLength(2);
  });

  it("应该将 changedFiles 转换为 artifacts", () => {
    const session = migrateQuestToSession(makeOldQuest(), makeOldPlan());
    const allArtifacts = session.flatTasks.flatMap((t) => t.artifacts);
    expect(allArtifacts.some((a) => a.filePath === "src/auth.ts")).toBe(true);
  });

  it("应该处理没有 plan 的 Quest", () => {
    const session = migrateQuestToSession(makeOldQuest(), null);
    expect(session.taskTree.children).toHaveLength(0);
    expect(session.flatTasks).toHaveLength(0);
  });

  it("应该正确映射旧状态", () => {
    const plan = makeOldPlan();
    expect(migrateQuestToSession(makeOldQuest({ status: "ready" }), plan).status).toBe("completed");
    expect(migrateQuestToSession(makeOldQuest({ status: "executing" }), plan).status).toBe("executing");
    expect(migrateQuestToSession(makeOldQuest({ status: "planning" }), plan).status).toBe("analyzing");
  });
});
