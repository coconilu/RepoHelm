import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RepoHelmService } from "./service.js";
import { JsonStateStore } from "./store.js";

async function createService() {
  const rootDir = await mkdtemp(join(tmpdir(), "repohelm-core-test-"));
  return {
    rootDir,
    service: new RepoHelmService(new JsonStateStore(rootDir), rootDir)
  };
}

describe("RepoHelmService", () => {
  it("bootstraps a demo workspace with one linked project and seed knowledge", async () => {
    const { rootDir, service } = await createService();

    const state = await service.bootstrap();
    const persisted = JSON.parse(await readFile(join(rootDir, ".repohelm", "state.json"), "utf8"));

    expect(state.workspaces).toHaveLength(1);
    expect(state.projects).toHaveLength(1);
    expect(state.knowledge).toHaveLength(1);
    expect(state.workspaces[0]?.projectIds).toEqual([state.projects[0]?.id]);
    expect(state.projects[0]?.path).toBe(rootDir);
    expect(persisted.workspaces[0].id).toBe(state.workspaces[0]?.id);
  });

  it("creates a quest with a lightweight spec and planning events", async () => {
    const { service } = await createService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;

    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "Add worktree execution",
      requirement: "为每个受影响项目创建隔离 worktree。"
    });
    const nextState = await service.getState();

    expect(quest.status).toBe("planning");
    expect(quest.affectedProjectIds).toEqual(workspace.projectIds);
    expect(quest.spec.userGoal).toContain("隔离 worktree");
    expect(quest.spec.acceptanceCriteria).toHaveLength(3);
    expect(nextState.events.filter((event) => event.questId === quest.id)).toHaveLength(3);
  });

  it("runs a quest into ready state with worktree plan, validation, review, and memory", async () => {
    const { rootDir, service } = await createService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const project = state.projects[0]!;
    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "Run MVP loop",
      requirement: "验证 Quest 的 mock agent 执行闭环。",
      affectedProjectIds: [project.id]
    });

    const completedQuest = await service.runQuest(quest.id);
    const nextState = await service.getState();
    const questEvents = nextState.events.filter((event) => event.questId === quest.id);
    const questMemory = nextState.knowledge.find((item) => item.questId === quest.id);

    expect(completedQuest.status).toBe("ready");
    expect(completedQuest.worktrees).toHaveLength(1);
    expect(completedQuest.worktrees[0]?.branchName).toBe("repohelm/run-mvp-loop");
    expect(completedQuest.worktrees[0]?.worktreePath).toContain(join(rootDir, ".repohelm", "worktrees"));
    expect(completedQuest.validationResults.length).toBeGreaterThan(0);
    expect(completedQuest.reviewNotes.length).toBeGreaterThan(0);
    expect(completedQuest.changedFiles).toContain("docs/specs/quest-spec.md");
    expect(questEvents).toHaveLength(8);
    expect(questMemory?.type).toBe("memory");
  });
});

