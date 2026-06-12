import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuestWorkspaceManager } from "./quest-workspace.js";
import type { OrchestrationPlan } from "./types.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { RepoHelmService } from "./service.js";
import { SqliteStateStore } from "./store.js";

const execFileAsync = promisify(execFile);

function samplePlan(questId: string): OrchestrationPlan {
  return {
    questId,
    generatedAt: "2025-01-01T00:00:00.000Z",
    summary: "Test orchestration plan summary",
    steps: [
      {
        id: "step-1",
        description: "Implement feature A",
        agentId: "agent-impl",
        agentName: "Implementation Agent",
        dependencies: [],
        expectedOutput: "Source code changes for feature A"
      },
      {
        id: "step-2",
        description: "Review feature A",
        agentId: "agent-review",
        agentName: "Review Agent",
        dependencies: ["step-1"],
        expectedOutput: "Review notes for feature A"
      }
    ],
    notes: "This is a test plan with notes."
  };
}

describe("QuestWorkspaceManager", () => {
  it("writePlan + readPlan round-trips correctly", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);
    const questId = "quest_roundtrip_test";
    const plan = samplePlan(questId);

    const planPath = await manager.writePlan(questId, plan);
    expect(planPath).toContain(join(rootDir, ".repohelm", "quests", questId, "plan.md"));

    const readBack = await manager.readPlan(questId);
    expect(readBack).toBeDefined();
    expect(readBack!.questId).toBe(questId);
    expect(readBack!.generatedAt).toBe(plan.generatedAt);
    expect(readBack!.summary).toBe(plan.summary);
    expect(readBack!.notes).toBe(plan.notes);
    expect(readBack!.steps).toHaveLength(2);
    expect(readBack!.steps[0]).toMatchObject({
      id: "step-1",
      description: "Implement feature A",
      agentId: "agent-impl",
      agentName: "Implementation Agent",
      dependencies: [],
      expectedOutput: "Source code changes for feature A"
    });
    expect(readBack!.steps[1]).toMatchObject({
      id: "step-2",
      description: "Review feature A",
      agentId: "agent-review",
      agentName: "Review Agent",
      dependencies: ["step-1"],
      expectedOutput: "Review notes for feature A"
    });
  });

  it("round-trips a step contract", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);
    const questId = "quest_contract_test";
    const plan: OrchestrationPlan = {
      questId,
      generatedAt: "2026-06-12T00:00:00.000Z",
      summary: "Plan with contract",
      notes: "",
      steps: [
        {
          id: "step_1",
          description: "Build A",
          agentId: "coder",
          agentName: "Coder",
          dependencies: [],
          expectedOutput: "Code for A",
          contract: {
            boundaries: "Do not touch auth",
            sourcesGuidance: "See README",
            doneCriteria: "Tests pass"
          }
        }
      ]
    };

    await manager.writePlan(questId, plan);
    const readBack = await manager.readPlan(questId);

    expect(readBack!.steps[0]!.agentId).toBe("coder");
    expect(readBack!.steps[0]!.expectedOutput).toBe("Code for A");
    expect(readBack!.steps[0]!.contract).toEqual({
      boundaries: "Do not touch auth",
      sourcesGuidance: "See README",
      doneCriteria: "Tests pass"
    });
  });

  it("does not add a contract property for legacy plans without one", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);
    const questId = "quest_no_contract_test";
    const plan: OrchestrationPlan = {
      questId,
      generatedAt: "2026-06-12T00:00:00.000Z",
      summary: "Plan without contract",
      notes: "",
      steps: [
        {
          id: "step_1",
          description: "Build A",
          agentId: "coder",
          agentName: "Coder",
          dependencies: [],
          expectedOutput: "Code for A"
        }
      ]
    };

    await manager.writePlan(questId, plan);
    const readBack = await manager.readPlan(questId);

    expect(readBack!.steps[0]).not.toHaveProperty("contract");
  });

  it("round-trips plans whose descriptions contain newlines", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);
    const questId = "quest_newline_test";
    const plan: OrchestrationPlan = {
      questId,
      generatedAt: "2026-06-11T00:00:00.000Z",
      summary: "Plan with messy descriptions",
      notes: "",
      steps: [
        {
          id: "step_1",
          description: "帮我开发一个小飞机游戏\n\n操作项目: project_xxx",
          agentId: "coder",
          agentName: "Coder",
          dependencies: [],
          expectedOutput: "A working game"
        },
        {
          id: "step_2",
          description: "Line one\nLine two\nLine three",
          agentId: "reviewer",
          agentName: "Reviewer",
          dependencies: ["step_1"],
          expectedOutput: "Review notes"
        }
      ]
    };

    await manager.writePlan(questId, plan);
    const readBack = await manager.readPlan(questId);

    expect(readBack).toBeDefined();
    expect(readBack!.steps).toHaveLength(2);
    // Newlines in descriptions are collapsed to spaces on render, so we get
    // the single-line form back. As long as the step parses at all, the
    // regression this test guards against is fixed.
    expect(readBack!.steps[0]!.agentId).toBe("coder");
    expect(readBack!.steps[0]!.description).toContain("小飞机游戏");
    expect(readBack!.steps[0]!.description).not.toContain("\n");
    expect(readBack!.steps[1]!.agentId).toBe("reviewer");
    expect(readBack!.steps[1]!.dependencies).toEqual(["step_1"]);
  });

  it("writeWorkerArtifact creates files in artifacts/", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);
    const questId = "quest_artifact_test";

    const artifactPath = await manager.writeWorkerArtifact(
      questId,
      "step-1",
      "Implementation Agent",
      "# Worker Output\n\nImplemented feature A successfully."
    );

    expect(artifactPath).toContain(join(rootDir, ".repohelm", "quests", questId, "artifacts"));
    expect(artifactPath).toContain("step-1-implementation-agent.md");

    const content = await readFile(artifactPath, "utf8");
    expect(content).toContain("Implemented feature A successfully.");
  });

  it("listArtifacts returns correct files", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);
    const questId = "quest_list_artifacts_test";

    await manager.writeWorkerArtifact(questId, "step-1", "Agent A", "Output A");
    await manager.writeWorkerArtifact(questId, "step-2", "Agent B", "Output B");

    const artifacts = await manager.listArtifacts(questId);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.some((name) => name.includes("step-1"))).toBe(true);
    expect(artifacts.some((name) => name.includes("step-2"))).toBe(true);
    expect(artifacts.every((name) => name.endsWith(".md"))).toBe(true);
  });

  it("readPlan returns undefined for non-existent quest", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);

    const result = await manager.readPlan("quest-that-does-not-exist");
    expect(result).toBeUndefined();
  });

  it("listArtifacts returns empty array for non-existent quest", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);

    const artifacts = await manager.listArtifacts("quest-that-does-not-exist");
    expect(artifacts).toEqual([]);
  });
});

describe("Plan-then-execute flow", () => {
  async function createGitRepoService() {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-git-test-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: rootDir });
    await writeFile(join(rootDir, "README.md"), "# Fixture\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: rootDir });
    await execFileAsync("git", ["-c", "user.name=RepoHelm", "-c", "user.email=repohelm@example.com", "commit", "-m", "Initial commit"], {
      cwd: rootDir
    });
    return {
      rootDir,
      service: new RepoHelmService(new SqliteStateStore(rootDir), rootDir)
    };
  }

  it("runQuest with no entry agent throws guidance error", async () => {
    const { service } = await createGitRepoService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const project = state.projects[0]!;
    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "No entry agent orchestrator test",
      requirement: "验证 orchestrator plan-then-execute 路径在没有 entry agent 时的行为。",
      affectedProjectIds: [project.id]
    });

    await expect(service.runQuest(quest.id)).rejects.toThrow(
      "No entry sub-agent configured. Set an entry agent in Settings > Sub-Agents before running quests."
    );
  });

  it("quest has autoApprovePlan: false by default", async () => {
    const { service } = await createGitRepoService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const project = state.projects[0]!;

    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "Default auto-approve check",
      requirement: "验证 autoApprovePlan 默认为 false。",
      affectedProjectIds: [project.id]
    });

    expect(quest.autoApprovePlan).toBe(false);

    const nextState = await service.getState();
    const persistedQuest = nextState.quests.find((item) => item.id === quest.id);
    expect(persistedQuest?.autoApprovePlan).toBe(false);
  });
});
