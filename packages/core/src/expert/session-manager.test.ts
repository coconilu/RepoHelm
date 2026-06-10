import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStateStore } from "../store.js";
import { RepoHelmService } from "../service.js";
import { ExpertSessionManager } from "./session-manager.js";
import type { ExpertSession, ExpertTaskNode } from "./types.js";

async function createTestService() {
  const rootDir = await mkdtemp(join(tmpdir(), "repohelm-expert-test-"));
  const store = new SqliteStateStore(rootDir);
  const service = new RepoHelmService(store, rootDir);
  return { rootDir, service };
}

describe("ExpertSessionManager", () => {
  it("应该创建新的 Expert Session", async () => {
    const { service } = await createTestService();
    const manager = new ExpertSessionManager(service);

    const session = await manager.createSession({
      questId: "test-1",
      entryAgentId: "supervisor",
    });

    expect(session.id).toBe("expert_test-1");
    expect(session.status).toBe("analyzing");
    expect(session.questId).toBe("test-1");
    expect(session.entryAgentId).toBe("supervisor");
    expect(session.taskTree.type).toBe("root");
  });

  it("应该按合法顺序推进状态", async () => {
    const { service } = await createTestService();
    const manager = new ExpertSessionManager(service);

    let session = await manager.createSession({
      questId: "test-2",
      entryAgentId: "supervisor",
    });

    session = await manager.transitionStatus(session.id, "awaiting_confirmation");
    expect(session.status).toBe("awaiting_confirmation");

    session = await manager.transitionStatus(session.id, "confirmed");
    expect(session.status).toBe("confirmed");

    session = await manager.transitionStatus(session.id, "executing");
    expect(session.status).toBe("executing");

    session = await manager.transitionStatus(session.id, "completed");
    expect(session.status).toBe("completed");
  });

  it("应该拒绝非法状态转换", async () => {
    const { service } = await createTestService();
    const manager = new ExpertSessionManager(service);

    const session = await manager.createSession({
      questId: "test-3",
      entryAgentId: "supervisor",
    });

    await expect(
      manager.transitionStatus(session.id, "completed")
    ).rejects.toThrow("非法状态转换");
  });

  it("应该获取 session 并包含最新状态", async () => {
    const { service } = await createTestService();
    const manager = new ExpertSessionManager(service);

    await manager.createSession({ questId: "test-4", entryAgentId: "supervisor" });
    const retrieved = await manager.getSession("expert_test-4");

    expect(retrieved).toBeDefined();
    expect(retrieved!.questId).toBe("test-4");
  });
});
