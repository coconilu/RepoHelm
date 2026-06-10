import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStateStore } from "../store.js";
import { RepoHelmService } from "../service.js";
import type { ExpertSession } from "./types.js";

async function createService() {
  const rootDir = await mkdtemp(join(tmpdir(), "repohelm-persist-test-"));
  const store = new SqliteStateStore(rootDir);
  const service = new RepoHelmService(store, rootDir);
  return { rootDir, service };
}

function makeSession(questId: string): ExpertSession {
  return {
    id: `expert_${questId}`,
    questId,
    status: "analyzing",
    entryAgentId: "supervisor",
    taskTree: { id: "root", title: questId, type: "root", status: "pending", children: [], dependencies: [], artifacts: [], description: "", expectedOutput: "" },
    flatTasks: [], acceptanceTests: [], research: [],
    agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
    createdAt: new Date().toISOString(), errors: [],
  };
}

describe("Expert Session Persistence", () => {
  it("应该创建并读取 expert session", async () => {
    const { service } = await createService();
    const session = makeSession("test-q1");
    await service.createExpertSession(session);
    const retrieved = await service.getExpertSession("expert_test-q1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.questId).toBe("test-q1");
  });

  it("应该列出 quest 关联的 sessions", async () => {
    const { service } = await createService();
    await service.createExpertSession(makeSession("test-q2"));
    const sessions = await service.listExpertSessions("test-q2");
    expect(sessions).toHaveLength(1);
  });

  it("应该更新 session 状态", async () => {
    const { service } = await createService();
    const session = makeSession("test-q3");
    await service.createExpertSession(session);
    const updated = await service.updateExpertSession("expert_test-q3", { status: "awaiting_confirmation" });
    expect(updated.status).toBe("awaiting_confirmation");
  });
});
