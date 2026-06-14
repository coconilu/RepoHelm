import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuestWorkspaceManager } from "./quest-workspace.js";
import type { OrchestrationPlan } from "./types.js";
import { resolveContract, renderContractSection } from "./task-contract.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { RepoHelmService } from "./service.js";
import { SqliteStateStore } from "./store.js";
import { SubAgentOrchestrator } from "./orchestrator.js";
import type { ModelKit, Quest, WorktreeState } from "./types.js";

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
        expectedOutput: "Source code changes for feature A",
        targetProjectId: "project-a"
      },
      {
        id: "step-2",
        description: "Review feature A",
        agentId: "agent-review",
        agentName: "Review Agent",
        dependencies: ["step-1"],
        expectedOutput: "Review notes for feature A",
        targetProjectId: "project-b"
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
      expectedOutput: "Source code changes for feature A",
      targetProjectId: "project-a"
    });
    expect(readBack!.steps[1]).toMatchObject({
      id: "step-2",
      description: "Review feature A",
      agentId: "agent-review",
      agentName: "Review Agent",
      dependencies: ["step-1"],
      expectedOutput: "Review notes for feature A",
      targetProjectId: "project-b"
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

  async function configureCliAgents(service: RepoHelmService, commandPath: string) {
    process.env.REPOHELM_GENERIC_CLI_COMMAND = commandPath;
    await service.createModelKit({
      id: "test-cli-kit",
      name: "Test CLI",
      type: "cli",
      backendId: "generic",
      model: "default",
      config: { backendId: "generic" }
    });
    await service.createSubAgent({
      id: "supervisor",
      name: "Supervisor",
      role: "Entry supervisor",
      capabilities: ["planning"],
      modelKitId: "test-cli-kit",
      mode: "entry",
      permissions: { allowedTools: [], deniedTools: [] }
    });
    await service.createSubAgent({
      id: "coder",
      name: "Coder",
      role: "Writes code",
      capabilities: ["coding"],
      modelKitId: "test-cli-kit",
      mode: "worker",
      permissions: { allowedTools: [], deniedTools: [] }
    });
    await service.setEntrySubAgent("supervisor");
  }

  async function createWorkerCommand(rootDir: string) {
    const commandPath = join(rootDir, "worker-output.mjs");
    await writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { dirname, join } from 'node:path';",
        "const prompt = process.argv.slice(2).join('\\n');",
        "if (process.env.REPOHELM_TEST_PLAN_JSON && prompt.includes('Produce an execution plan')) {",
        "  console.log(process.env.REPOHELM_TEST_PLAN_JSON);",
        "  process.exit(0);",
        "}",
        "if (prompt.includes('Decide the recovery action')) {",
        "  console.log(process.env.REPOHELM_TEST_LEAD_DECISION_JSON || 'lead: no structured decision');",
        "  process.exit(0);",
        "}",
        "const writeRules = JSON.parse(process.env.REPOHELM_TEST_WORKER_WRITES_JSON || '[]');",
        "for (const rule of writeRules) {",
        "  if (!rule.contains || prompt.includes(rule.contains)) {",
        "    const abs = join(process.cwd(), rule.path);",
        "    mkdirSync(dirname(abs), { recursive: true });",
        "    writeFileSync(abs, rule.content || 'written = true\\n');",
        "  }",
        "}",
        "const writePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;",
        "const writeWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;",
        "if (writePath && (!writeWhen || prompt.includes(writeWhen))) {",
        "  const abs = join(process.cwd(), writePath);",
        "  mkdirSync(dirname(abs), { recursive: true });",
        "  writeFileSync(abs, process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT || 'written = true\\n');",
        "}",
        // Exit non-zero AFTER any writes, to simulate a worker that dirties the
        // worktree and then fails (CLI backend treats this as an execution error).
        "const failWhen = process.env.REPOHELM_TEST_WORKER_FAIL_WHEN;",
        "if (failWhen && prompt.includes(failWhen)) {",
        "  console.error('simulated worker failure');",
        "  process.exit(1);",
        "}",
        "console.log(process.env.REPOHELM_TEST_WORKER_OUTPUT || 'Worker inspected the project but wrote nothing.');"
      ].join("\n"),
      "utf8"
    );
    await chmod(commandPath, 0o755);
    return commandPath;
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

  it("marks implementation steps failed when a worker writes no material output", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Now let me inspect the existing UI patterns first.";

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Implement material guard",
        requirement: "Implement material guard.",
        affectedProjectIds: [project.id]
      });

      const planned = await service.runQuest(quest.id);
      expect(planned.planApproval?.status).toBe("pending");
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("blocked");
      expect(executed.changedFiles).toHaveLength(0);
      expect(executed.agentSummary).toContain("Coder (fail)");
      expect(executed.agentSummary).toContain("Worker completed without required material output");

      const finalState = await service.getState();
      const events = finalState.events.filter((event) => event.questId === quest.id);
      expect(events.some((event) => event.type === "step.failed" && event.title === "步骤失败: Coder")).toBe(true);
      expect(events.some((event) => event.type === "orchestrator.failed")).toBe(true);
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWritePath === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      }
      if (oldWriteWhen === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = oldWriteWhen;
      }
      if (oldWriteContent === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
      }
    }
  });

  it("accepts implementation steps when worker output materializes files", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      process.env.REPOHELM_TEST_WORKER_OUTPUT = [
        "Implemented the requested file.",
        "```src/material-guard.ts",
        "export const materialGuard = true;",
        "```"
      ].join("\n");

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Implement material guard file",
        requirement: "Implement material guard file.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("ready");
      expect(executed.changedFiles.map((file) => file.path)).toContain("src/material-guard.ts");
      expect(executed.agentSummary).toContain("Coder (ok)");
      expect(executed.agentSummary).toContain("写入文件: src/material-guard.ts");
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWritePath === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      }
      if (oldWriteWhen === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = oldWriteWhen;
      }
      if (oldWriteContent === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
      }
    }
  });

  it("accepts direct CLI worktree edits even without fenced file output", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Implemented via direct CLI edit.";
      process.env.REPOHELM_TEST_WORKER_WRITE_PATH = "src/direct-cli-edit.ts";
      process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = "export const directCliEdit = true;\n";

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Implement direct CLI edit",
        requirement: "Implement direct CLI edit.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("ready");
      expect(executed.changedFiles.map((file) => file.path)).toContain("src/direct-cli-edit.ts");
      expect(executed.agentSummary).toContain("Coder (ok)");
      expect(executed.agentSummary).toContain("写入文件: src/direct-cli-edit.ts");
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWritePath === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      }
      if (oldWriteWhen === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = oldWriteWhen;
      }
      if (oldWriteContent === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
      }
    }
  });

  it("ignores a stray prose fence once the worker already made a direct edit", async () => {
    // Reviewer follow-up on PR #13: the prose fallback gate must account for direct
    // edits (not just write_file/edit_file tool writes). A worker that edits the
    // worktree directly AND emits an unrelated path-tagged fence must NOT have that
    // fence materialized — the direct edit alone satisfies "the worker produced
    // output through its tools/edits", so prose is not scraped.
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      // The worker directly writes src/direct-edit.ts AND prints a stray fence for
      // a different path (stray.txt) in its final answer.
      process.env.REPOHELM_TEST_WORKER_WRITE_PATH = "src/direct-edit.ts";
      process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = "export const directEdit = true;\n";
      process.env.REPOHELM_TEST_WORKER_OUTPUT = [
        "Edited the file directly. For reference here is an extra snippet:",
        "```stray.txt",
        "should-not-be-written",
        "```"
      ].join("\n");

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Direct edit plus stray fence",
        requirement: "Worker edits a file directly and emits an unrelated fence.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      const paths = executed.changedFiles.map((file) => file.path);
      expect(executed.status).toBe("ready");
      expect(paths).toContain("src/direct-edit.ts");
      expect(paths).not.toContain("stray.txt");
    } finally {
      if (oldCommand === undefined) delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      else process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      if (oldOutput === undefined) delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      else process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      if (oldPlan === undefined) delete process.env.REPOHELM_TEST_PLAN_JSON;
      else process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      if (oldWritePath === undefined) delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      else process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      if (oldWriteWhen === undefined) delete process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
      else process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = oldWriteWhen;
      if (oldWriteContent === undefined) delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      else process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
    }
  });

  it("runs CLI worker steps in their target project worktrees", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWrites = process.env.REPOHELM_TEST_WORKER_WRITES_JSON;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    const secondRepo = join(rootDir, "second-repo");
    try {
      await execFileAsync("git", ["init", "-b", "main", secondRepo]);
      await writeFile(join(secondRepo, "README.md"), "# Second\n", "utf8");
      await execFileAsync("git", ["add", "README.md"], { cwd: secondRepo });
      await execFileAsync("git", ["-c", "user.name=RepoHelm", "-c", "user.email=repohelm@example.com", "commit", "-m", "Initial commit"], {
        cwd: secondRepo
      });

      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const firstProject = state.projects[0]!;
      const secondProject = await service.createProject({
        name: "second-repo",
        path: secondRepo,
        defaultBranch: "main"
      });
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Targeted multi-repo plan",
        steps: [
          {
            id: "step_1",
            description: "Write first repo file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "First repo code",
            targetProjectId: firstProject.id,
            contract: { doneCriteria: "Code file written" }
          },
          {
            id: "step_2",
            description: "Write second repo file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: ["step_1"],
            expectedOutput: "Second repo code",
            targetProjectId: secondProject.id,
            contract: { doneCriteria: "Code file written" }
          }
        ]
      });
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Direct edit complete.";
      process.env.REPOHELM_TEST_WORKER_WRITES_JSON = JSON.stringify([
        { contains: "Write first repo file", path: "src/first.ts", content: "export const first = true;\n" },
        { contains: "Write second repo file", path: "src/second.ts", content: "export const second = true;\n" }
      ]);

      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Targeted multi repo writes",
        requirement: "Write files in two different project worktrees.",
        affectedProjectIds: [firstProject.id, secondProject.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("ready");
      expect(executed.changedFiles.map((file) => `${file.projectId}:${file.path}`).sort()).toEqual([
        `${firstProject.id}:src/first.ts`,
        `${secondProject.id}:src/second.ts`
      ].sort());
      const firstWorktree = executed.worktrees.find((item) => item.projectId === firstProject.id)!;
      const secondWorktree = executed.worktrees.find((item) => item.projectId === secondProject.id)!;
      await expect(readFile(join(firstWorktree.worktreePath!, "src", "first.ts"), "utf8")).resolves.toContain("first");
      await expect(readFile(join(secondWorktree.worktreePath!, "src", "second.ts"), "utf8")).resolves.toContain("second");
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWrites === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITES_JSON;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITES_JSON = oldWrites;
      }
    }
  });

  it("blocks worker steps with an unknown target project instead of editing another worktree", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Invalid target plan",
        steps: [
          {
            id: "step_1",
            description: "Write should not run",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "No code changes",
            targetProjectId: "project_missing",
            contract: { doneCriteria: "Code file written" }
          }
        ]
      });
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "This should not run.";
      process.env.REPOHELM_TEST_WORKER_WRITE_PATH = "src/wrong-repo.ts";
      process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = "export const wrong = true;\n";

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Invalid target project",
        requirement: "Step 1 uses a plan target project that has no worktree.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("blocked");
      expect(executed.changedFiles).toHaveLength(0);
      expect(executed.agentSummary).toContain("target project project_missing has no created worktree");
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWritePath === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      }
      if (oldWriteContent === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
      }
    }
  });

  it("keeps quests blocked when a later required step fails after earlier file changes", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Two step material validation",
        steps: [
          {
            id: "step_1",
            description: "Implement first file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "Code changes for first file",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Code file written" }
          },
          {
            id: "step_2",
            description: "Update knowledge memory with the new model",
            agentId: "coder",
            agentName: "Coder",
            dependencies: ["step_1"],
            expectedOutput: "Updated knowledge documentation",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Knowledge memory file written" }
          }
        ]
      });
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "I inspected the task.";
      process.env.REPOHELM_TEST_WORKER_WRITE_PATH = "src/first-file.ts";
      process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = "Implement first file";
      process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = "export const firstFile = true;\n";

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Step one writes and step two fails",
        requirement: "Step one writes a file, then step two updates knowledge memory.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("blocked");
      expect(executed.changedFiles.map((file) => file.path)).toContain("src/first-file.ts");
      expect(executed.agentSummary).toContain("1. Coder (ok)");
      expect(executed.agentSummary).toContain("2. Coder (fail)");
      expect(executed.reviewNotes).toContain("执行产生了 1 个文件变更，但存在失败步骤，暂不可交付。");
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWritePath === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      }
      if (oldWriteWhen === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = oldWriteWhen;
      }
      if (oldWriteContent === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
      }
    }
  });

  it("accepts direct CLI edits to a file that was already dirty from an earlier step", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const oldWrites = process.env.REPOHELM_TEST_WORKER_WRITES_JSON;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Dirty same file validation",
        steps: [
          {
            id: "step_1",
            description: "Write shared file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "Code changes for shared file",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Shared file written" }
          },
          {
            id: "step_2",
            description: "Rewrite shared file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: ["step_1"],
            expectedOutput: "Code changes for shared file",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Shared file rewritten" }
          }
        ]
      });
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Direct edit complete.";
      process.env.REPOHELM_TEST_WORKER_WRITES_JSON = JSON.stringify([
        { contains: "Write shared file", path: "src/shared.ts", content: "export const shared = 'one';\n" },
        { contains: "Rewrite shared file", path: "src/shared.ts", content: "export const shared = 'two';\n" }
      ]);

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Rewrite dirty same file",
        requirement: "step 1 write shared file; step 2 rewrite the same file.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("ready");
      expect(executed.agentSummary).toContain("1. Coder (ok)");
      expect(executed.agentSummary).toContain("2. Coder (ok)");
      expect(executed.changedFiles.map((file) => file.path)).toContain("src/shared.ts");
      expect(await readFile(join(executed.worktrees[0]!.worktreePath!, "src/shared.ts"), "utf8")).toContain("'two'");
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWritePath === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      }
      if (oldWriteWhen === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = oldWriteWhen;
      }
      if (oldWriteContent === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
      }
      if (oldWrites === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITES_JSON;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITES_JSON = oldWrites;
      }
    }
  });

  it("skips dependent steps after a missing-agent failure", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const oldWrites = process.env.REPOHELM_TEST_WORKER_WRITES_JSON;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Missing dependency validation",
        steps: [
          {
            id: "step_1",
            description: "Missing agent step",
            agentId: "missing-agent",
            agentName: "Missing Agent",
            dependencies: [],
            expectedOutput: "Code changes",
            targetProjectId: "project_repohelm"
          },
          {
            id: "step_2",
            description: "Downstream implementation",
            agentId: "coder",
            agentName: "Coder",
            dependencies: ["step_1"],
            expectedOutput: "Code changes for downstream",
            targetProjectId: "project_repohelm"
          }
        ]
      });
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "This downstream worker should not run.";
      process.env.REPOHELM_TEST_WORKER_WRITE_PATH = "src/downstream.ts";
      process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = "Downstream implementation";
      process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = "export const downstream = true;\n";

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Missing agent dependency",
        requirement: "A missing agent step should stop downstream work.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("blocked");
      expect(executed.changedFiles).toHaveLength(0);
      // P2: missing agent now flows through the lead decision; with no scripted
      // decision the lead degrades to skip, so the step still fails and downstream
      // is skipped — same end state, recovery trail folded into the summary.
      expect(executed.agentSummary).toContain("1. Missing Agent (fail)");
      expect(executed.agentSummary).toContain("agent missing-agent not found in pool");
      expect(executed.agentSummary).toContain("2. Coder (fail): skipped: dependency failed (step_1)");
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWritePath === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      }
      if (oldWriteWhen === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = oldWriteWhen;
      }
      if (oldWriteContent === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
      }
      if (oldWrites === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITES_JSON;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITES_JSON = oldWrites;
      }
    }
  });

  it("counts reverting an already-dirty tracked file to clean as material output", async () => {
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    const oldOutput = process.env.REPOHELM_TEST_WORKER_OUTPUT;
    const oldPlan = process.env.REPOHELM_TEST_PLAN_JSON;
    const oldWritePath = process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
    const oldWriteWhen = process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
    const oldWriteContent = process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
    const oldWrites = process.env.REPOHELM_TEST_WORKER_WRITES_JSON;
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Revert dirty file validation",
        steps: [
          {
            id: "step_1",
            description: "Modify README",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "Code changes for README",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "README modified" }
          },
          {
            id: "step_2",
            description: "Restore README",
            agentId: "coder",
            agentName: "Coder",
            dependencies: ["step_1"],
            expectedOutput: "Code changes for README",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "README restored" }
          }
        ]
      });
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Direct edit complete.";
      process.env.REPOHELM_TEST_WORKER_WRITES_JSON = JSON.stringify([
        { contains: "Modify README", path: "README.md", content: "# Fixture\nchanged\n" },
        { contains: "Restore README", path: "README.md", content: "# Fixture\n" }
      ]);

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Restore dirty README",
        requirement: "step 1 modify README; step 2 restore README.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("blocked");
      expect(executed.changedFiles).toHaveLength(0);
      expect(executed.agentSummary).toContain("1. Coder (ok)");
      expect(executed.agentSummary).toContain("2. Coder (ok)");
      expect(executed.agentSummary).not.toContain("Worker completed without required material output");
    } finally {
      if (oldCommand === undefined) {
        delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      } else {
        process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      }
      if (oldOutput === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_OUTPUT;
      } else {
        process.env.REPOHELM_TEST_WORKER_OUTPUT = oldOutput;
      }
      if (oldPlan === undefined) {
        delete process.env.REPOHELM_TEST_PLAN_JSON;
      } else {
        process.env.REPOHELM_TEST_PLAN_JSON = oldPlan;
      }
      if (oldWritePath === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_PATH;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_PATH = oldWritePath;
      }
      if (oldWriteWhen === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_WHEN;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = oldWriteWhen;
      }
      if (oldWriteContent === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = oldWriteContent;
      }
      if (oldWrites === undefined) {
        delete process.env.REPOHELM_TEST_WORKER_WRITES_JSON;
      } else {
        process.env.REPOHELM_TEST_WORKER_WRITES_JSON = oldWrites;
      }
    }
  });

  // ── issue #4: lead-agent dynamic recovery (reassign / revise / retry caps) ──
  const RECOVERY_ENV_KEYS = [
    "REPOHELM_GENERIC_CLI_COMMAND",
    "REPOHELM_TEST_WORKER_OUTPUT",
    "REPOHELM_TEST_PLAN_JSON",
    "REPOHELM_TEST_LEAD_DECISION_JSON",
    "REPOHELM_TEST_WORKER_WRITE_PATH",
    "REPOHELM_TEST_WORKER_WRITE_WHEN",
    "REPOHELM_TEST_WORKER_WRITE_CONTENT",
    "REPOHELM_TEST_WORKER_WRITES_JSON",
    "REPOHELM_TEST_WORKER_FAIL_WHEN"
  ];
  function snapshotEnv(keys: string[]): () => void {
    const saved: Record<string, string | undefined> = {};
    for (const key of keys) saved[key] = process.env[key];
    return () => {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key]!;
      }
    };
  }

  async function addReviewerAgent(service: RepoHelmService) {
    await service.createSubAgent({
      id: "reviewer",
      name: "Reviewer",
      role: "Reviews and rescues work",
      capabilities: ["coding", "review"],
      modelKitId: "test-cli-kit",
      mode: "worker",
      permissions: { allowedTools: [], deniedTools: [] }
    });
  }

  it("reassigns a failed step to another agent when the lead decides reassign", async () => {
    const restore = snapshotEnv(RECOVERY_ENV_KEYS);
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      await addReviewerAgent(service);

      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Reassign on failure",
        steps: [
          {
            id: "step_1",
            description: "Implement the feature file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "Code changes",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Source code file written" }
          }
        ]
      });
      // Coder writes nothing (its prompt never contains "Reviewer"); the reviewer
      // does, so only the reassigned attempt produces the material file.
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Working on it.";
      process.env.REPOHELM_TEST_WORKER_WRITE_PATH = "src/feature.ts";
      process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = "Reviewer";
      process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = "export const feature = true;\n";
      process.env.REPOHELM_TEST_LEAD_DECISION_JSON = JSON.stringify({
        action: "reassign",
        reassignTo: "reviewer",
        reason: "Coder produced no file"
      });

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Reassign feature step",
        requirement: "Step 1: run the implementation; the first worker fails so the lead reassigns.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("ready");
      expect(executed.changedFiles.map((f) => f.path)).toContain("src/feature.ts");
      // The single step ends "ok" (recovered) and names the reassigned agent.
      expect(executed.agentSummary).toContain("1. Reviewer (ok)");
      expect(executed.agentSummary).toContain("reassigned");
    } finally {
      restore();
    }
  });

  it("revises and retries a failed step when the lead decides revise", async () => {
    const restore = snapshotEnv(RECOVERY_ENV_KEYS);
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);

      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Revise on failure",
        steps: [
          {
            id: "step_1",
            description: "Implement the feature file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "Code changes",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Source code file written" }
          }
        ]
      });
      // The worker only writes once its prompt carries the revised instruction.
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Working on it.";
      process.env.REPOHELM_TEST_WORKER_WRITE_PATH = "src/revised.ts";
      process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = "REVISED_USE_WRITE_TOOL";
      process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = "export const revised = true;\n";
      process.env.REPOHELM_TEST_LEAD_DECISION_JSON = JSON.stringify({
        action: "revise",
        revisedDescription: "Implement the feature file REVISED_USE_WRITE_TOOL"
      });

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Revise feature step",
        requirement: "Step 1: run the implementation; the first attempt fails so the lead revises and retries.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("ready");
      expect(executed.changedFiles.map((f) => f.path)).toContain("src/revised.ts");
      expect(executed.agentSummary).toContain("1. Coder (ok)");
    } finally {
      restore();
    }
  });

  it("stops retrying after the attempt cap even when the lead keeps choosing retry", async () => {
    const restore = snapshotEnv(RECOVERY_ENV_KEYS);
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);

      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Retry forever guarded by cap",
        steps: [
          {
            id: "step_1",
            description: "Implement the feature file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "Code changes",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Source code file written" }
          }
        ]
      });
      // Worker never writes anything → every attempt fails material validation.
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Still thinking, no file yet.";
      process.env.REPOHELM_TEST_LEAD_DECISION_JSON = JSON.stringify({ action: "retry" });

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Retry cap guardrail",
        requirement: "Step 1: run the implementation; the worker keeps failing and the lead keeps retrying.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      // Deterministic cap wins over the lead's endless retry → blocked, no files.
      expect(executed.status).toBe("blocked");
      expect(executed.changedFiles).toHaveLength(0);
      expect(executed.agentSummary).toContain("max attempts");
    } finally {
      restore();
    }
  });

  it("rolls back a failed attempt's residue so it is not delivered by a later success", async () => {
    const restore = snapshotEnv(RECOVERY_ENV_KEYS);
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);
      await addReviewerAgent(service);

      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Residue must not be delivered",
        steps: [
          {
            id: "step_1",
            description: "Implement the feature file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "Code changes",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Source code file written" }
          }
        ]
      });
      // Coder writes bad.ts then exits non-zero (CLI error). Reviewer writes good.ts
      // and succeeds. The failed coder residue (bad.ts) must be rolled back.
      process.env.REPOHELM_TEST_WORKER_WRITES_JSON = JSON.stringify([
        { contains: "Coder", path: "src/bad.ts", content: "export const bad = true;\n" },
        { contains: "Reviewer", path: "src/good.ts", content: "export const good = true;\n" }
      ]);
      process.env.REPOHELM_TEST_WORKER_FAIL_WHEN = "named \"Coder\"";
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "done";
      process.env.REPOHELM_TEST_LEAD_DECISION_JSON = JSON.stringify({
        action: "reassign",
        reassignTo: "reviewer"
      });

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Residue rollback",
        requirement: "Step 1: a first attempt writes residue then fails; a later attempt must rescue cleanly.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      const paths = executed.changedFiles.map((f) => f.path);
      expect(executed.status).toBe("ready");
      expect(paths).toContain("src/good.ts");
      expect(paths).not.toContain("src/bad.ts");
    } finally {
      restore();
    }
  });

  it("lets the lead reassign a missing-agent step to a valid worker", async () => {
    const restore = snapshotEnv(RECOVERY_ENV_KEYS);
    const { rootDir, service } = await createGitRepoService();
    const commandPath = await createWorkerCommand(rootDir);
    try {
      await service.bootstrap();
      await configureCliAgents(service, commandPath);

      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Recover from a hallucinated agent id",
        steps: [
          {
            id: "step_1",
            description: "Implement the feature file",
            agentId: "ghost-agent",
            agentName: "Ghost Agent",
            dependencies: [],
            expectedOutput: "Code changes",
            targetProjectId: "project_repohelm",
            contract: { doneCriteria: "Source code file written" }
          }
        ]
      });
      process.env.REPOHELM_TEST_WORKER_OUTPUT = "Rescued.";
      process.env.REPOHELM_TEST_WORKER_WRITE_PATH = "src/rescued.ts";
      process.env.REPOHELM_TEST_WORKER_WRITE_WHEN = "Coder";
      process.env.REPOHELM_TEST_WORKER_WRITE_CONTENT = "export const rescued = true;\n";
      process.env.REPOHELM_TEST_LEAD_DECISION_JSON = JSON.stringify({
        action: "reassign",
        reassignTo: "coder"
      });

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Missing agent reassign",
        requirement: "Step 1: the plan references a missing agent; the lead reassigns to a valid worker.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      expect(executed.status).toBe("ready");
      expect(executed.changedFiles.map((f) => f.path)).toContain("src/rescued.ts");
      expect(executed.agentSummary).toContain("1. Coder (ok)");
    } finally {
      restore();
    }
  });
});

describe("worker contract injection", () => {
  it("renders objective, boundaries, done criteria and upstream results", () => {
    const section = renderContractSection(
      resolveContract({
        id: "step_2",
        description: "Review A",
        agentId: "rev",
        agentName: "Reviewer",
        dependencies: ["step_1"],
        expectedOutput: "Review notes",
        contract: { boundaries: "No refactor", doneCriteria: "Notes written" }
      }),
      [{ stepId: "step_1", result: "implemented A" }]
    );
    expect(section).toContain("- Objective: Review A");
    expect(section).toContain("- Boundaries: No refactor");
    expect(section).toContain("- Done when: Notes written");
    expect(section).toContain("- step_1: implemented A");
  });
});

describe("CLI backend streaming integration", () => {
  function cliModelKit(): ModelKit {
    return {
      id: "stream-cli-kit",
      name: "Stream CLI",
      type: "cli",
      backendId: "generic",
      model: "default",
      config: { backendId: "generic" },
      metadata: {
        createdAt: "2025-01-01T00:00:00.000Z",
        testedAt: "2025-01-01T00:00:00.000Z",
        costTier: "free",
        performanceProfile: "fast"
      }
    };
  }

  async function writeStreamJsonCli(rootDir: string): Promise<string> {
    const commandPath = join(rootDir, "stream-cli.mjs");
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Planning the change" }] } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } }] }
      }),
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "All done" })
    ];
    await writeFile(
      commandPath,
      ["#!/usr/bin/env node", `const lines = ${JSON.stringify(lines)};`, "for (const l of lines) console.log(l);"].join(
        "\n"
      ),
      "utf8"
    );
    await chmod(commandPath, 0o755);
    return commandPath;
  }

  it("surfaces streamed tool calls and results as backend events", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-stream-cli-"));
    const commandPath = await writeStreamJsonCli(rootDir);
    process.env.REPOHELM_GENERIC_CLI_COMMAND = commandPath;

    try {
      const orchestrator = new SubAgentOrchestrator({} as RepoHelmService, rootDir);
      const backend = await orchestrator.createBackendFromModelKit(cliModelKit());
      const worktree: WorktreeState = {
        projectId: "project-a",
        status: "created",
        worktreePath: rootDir
      } as WorktreeState;

      const result = await backend.run({
        systemPrompt: "You are a coder.",
        messages: [{ role: "user", content: "Implement the feature." }],
        tools: [],
        worktrees: [worktree],
        quest: { id: "q1", title: "t", requirement: "r", worktrees: [worktree] } as Quest
      });

      const types = result.events.map((event) => event.type);
      expect(types).toContain("agent.tool_call");
      expect(types).toContain("agent.completed");
      const toolEvent = result.events.find((event) => event.type === "agent.tool_call");
      expect(toolEvent!.detail).toContain("pnpm test");
      expect(result.content).toContain("All done");
    } finally {
      delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
    }
  });
});

describe("CLI backend timeline propagation", () => {
  async function gitRepoService() {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-timeline-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: rootDir });
    await writeFile(join(rootDir, "README.md"), "# Fixture\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: rootDir });
    await execFileAsync(
      "git",
      ["-c", "user.name=RepoHelm", "-c", "user.email=repohelm@example.com", "commit", "-m", "init"],
      { cwd: rootDir }
    );
    return { rootDir, service: new RepoHelmService(new SqliteStateStore(rootDir), rootDir) };
  }

  async function streamingWorkerCli(rootDir: string): Promise<string> {
    const commandPath = join(rootDir, "stream-worker.mjs");
    await writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "const prompt = process.argv.slice(2).join('\\n');",
        "if (process.env.REPOHELM_TEST_PLAN_JSON && prompt.includes('Produce an execution plan')) {",
        "  console.log(process.env.REPOHELM_TEST_PLAN_JSON); process.exit(0);",
        "}",
        "mkdirSync(join(process.cwd(), 'src'), { recursive: true });",
        "writeFileSync(join(process.cwd(), 'src/impl.ts'), 'export const impl = true;\\n');",
        "console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' } }] } }));",
        "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }));"
      ].join("\n"),
      "utf8"
    );
    await chmod(commandPath, 0o755);
    return commandPath;
  }

  it("records streamed worker tool calls as quest timeline events", async () => {
    const { rootDir, service } = await gitRepoService();
    const commandPath = await streamingWorkerCli(rootDir);
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    process.env.REPOHELM_GENERIC_CLI_COMMAND = commandPath;

    try {
      await service.bootstrap();
      await service.createModelKit({
        id: "timeline-cli-kit",
        name: "Timeline CLI",
        type: "cli",
        backendId: "generic",
        model: "default",
        config: { backendId: "generic" }
      });
      await service.createSubAgent({
        id: "supervisor",
        name: "Supervisor",
        role: "Entry supervisor",
        capabilities: ["planning"],
        modelKitId: "timeline-cli-kit",
        mode: "entry",
        permissions: { allowedTools: [], deniedTools: [] }
      });
      await service.createSubAgent({
        id: "coder",
        name: "Coder",
        role: "Writes code",
        capabilities: ["coding"],
        modelKitId: "timeline-cli-kit",
        mode: "worker",
        permissions: { allowedTools: [], deniedTools: [] }
      });
      await service.setEntrySubAgent("supervisor");

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Timeline plan",
        steps: [
          {
            id: "step_1",
            description: "Implement the feature",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "Code",
            targetProjectId: project.id,
            contract: { doneCriteria: "Code file written" }
          }
        ]
      });

      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Timeline propagation",
        requirement: "Implement a feature and surface tool calls on the timeline.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      await service.approvePlan(quest.id);

      const events = (await service.getState()).events;
      const toolCall = events.find((event) => event.type === "agent.tool_call");
      expect(toolCall).toBeDefined();
      expect(toolCall!.detail).toContain("pnpm test");
    } finally {
      if (oldCommand === undefined) delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      else process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      delete process.env.REPOHELM_TEST_PLAN_JSON;
    }
  });
});

// Issue #2: the agent feedback-correction loop. A BYOK worker must be able to run
// a command, observe a FAILING result (stdout/stderr/exit code fed back as a tool
// result), then edit and re-run until it passes — all inside the bounded loop.
describe("worker run/observe/fix feedback loop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function gitRepoService() {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-feedback-loop-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: rootDir });
    await writeFile(join(rootDir, "README.md"), "# Fixture\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: rootDir });
    await execFileAsync(
      "git",
      ["-c", "user.name=RepoHelm", "-c", "user.email=repohelm@example.com", "commit", "-m", "init"],
      { cwd: rootDir }
    );
    return { rootDir, service: new RepoHelmService(new SqliteStateStore(rootDir), rootDir) };
  }

  // A CLI command used ONLY by the planner (supervisor). The worker is BYOK and
  // never touches this — its turns are scripted through the mocked fetch instead.
  async function plannerCli(rootDir: string): Promise<string> {
    const commandPath = join(rootDir, "planner-cli.mjs");
    await writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "const prompt = process.argv.slice(2).join('\\n');",
        "if (process.env.REPOHELM_TEST_PLAN_JSON && prompt.includes('Produce an execution plan')) {",
        "  console.log(process.env.REPOHELM_TEST_PLAN_JSON); process.exit(0);",
        "}",
        "console.log('planner fallback');"
      ].join("\n"),
      "utf8"
    );
    await chmod(commandPath, 0o755);
    return commandPath;
  }

  function chatResponse(message: Record<string, unknown>, finishReason: string): Response {
    return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  it("runs a failing command, feeds the failure back, then fixes and re-runs to pass", async () => {
    const { rootDir, service } = await gitRepoService();
    const commandPath = await plannerCli(rootDir);
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    process.env.REPOHELM_GENERIC_CLI_COMMAND = commandPath;

    // Scripted worker turns. The check command `cat sentinel.txt` fails until the
    // worker writes the file, mirroring "run tests -> see failure -> fix -> rerun".
    const chatBodies: Array<{ messages: Array<{ role: string; content?: string }> }> = [];
    const turns: Array<{ message: Record<string, unknown>; finish: string }> = [
      // Turn 1: just run the check — it will fail because sentinel.txt is absent.
      {
        finish: "tool_calls",
        message: {
          content: "",
          tool_calls: [
            { id: "c1", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "cat sentinel.txt" }) } }
          ]
        }
      },
      // Turn 2: having seen the failure, write the file and re-run the check.
      {
        finish: "tool_calls",
        message: {
          content: "",
          tool_calls: [
            { id: "c2", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "sentinel.txt", content: "ok\n" }) } },
            { id: "c3", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "cat sentinel.txt" }) } }
          ]
        }
      },
      // Turn 3: the check passed; conclude with no further tool calls.
      { finish: "stop", message: { content: "sentinel.txt now exists and the check passes. Done." } }
    ];
    let chatCalls = 0;
    const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
      const target = String(url);
      if (target.includes("/chat/completions")) {
        chatBodies.push(JSON.parse((init as RequestInit).body as string));
        const turn = turns[chatCalls] ?? { finish: "stop", message: { content: "done" } };
        chatCalls += 1;
        return chatResponse(turn.message, turn.finish);
      }
      // Any non-chat traffic (embeddings, etc.) gets a benign empty payload so it
      // never consumes a scripted worker turn.
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await service.bootstrap();
      // Allow only the exact check command the worker runs.
      await service.updateSecurityPolicy({ commandTemplates: ["cat sentinel.txt"] });

      await service.createModelKit({
        id: "planner-cli-kit",
        name: "Planner CLI",
        type: "cli",
        backendId: "generic",
        model: "default",
        config: { backendId: "generic" }
      });
      await service.createModelKit({
        id: "worker-byok-kit",
        name: "Worker BYOK",
        type: "byok",
        providerId: "openai",
        model: "gpt-test",
        config: { provider: "openai", baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "sk-test" }
      });
      await service.createSubAgent({
        id: "supervisor",
        name: "Supervisor",
        role: "Entry supervisor",
        capabilities: ["planning"],
        modelKitId: "planner-cli-kit",
        mode: "entry",
        permissions: { allowedTools: [], deniedTools: [] }
      });
      await service.createSubAgent({
        id: "coder",
        name: "Coder",
        role: "Writes code",
        capabilities: ["coding"],
        modelKitId: "worker-byok-kit",
        mode: "worker",
        permissions: { allowedTools: [], deniedTools: [] }
      });
      await service.setEntrySubAgent("supervisor");

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Feedback loop plan",
        steps: [
          {
            id: "step_1",
            description: "Make the sentinel check pass",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "sentinel.txt present",
            targetProjectId: project.id,
            contract: { doneCriteria: "sentinel.txt exists" }
          }
        ]
      });

      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Feedback loop",
        requirement: "Worker should run a check, see it fail, fix it, and re-run until it passes.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      const executed = await service.approvePlan(quest.id);

      // The loop recovered: the step succeeded and the fix materialized.
      expect(executed.status).toBe("ready");
      expect(executed.changedFiles.map((file) => file.path)).toContain("sentinel.txt");
      expect(executed.agentSummary).toContain("Coder (ok)");

      // The loop iterated past the failure: three worker turns (fail -> fix -> done).
      expect(chatCalls).toBe(3);

      // Criterion 2: the FAILING command's exit code and stderr flowed back into the
      // messages the model saw on its second turn.
      const secondTurnMessages = chatBodies[1]!.messages;
      const toolResult = secondTurnMessages.find((m) => m.role === "tool");
      expect(toolResult).toBeDefined();
      expect(toolResult!.content).toContain("\"exitCode\":1");
      expect(toolResult!.content).toContain("No such file");
    } finally {
      if (oldCommand === undefined) delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      else process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      delete process.env.REPOHELM_TEST_PLAN_JSON;
    }
  });
});

// Issue #3: a tool-capable (BYOK) worker should produce file changes through the
// write_file/edit_file tools, NOT by emitting fenced code blocks in prose. The
// prose-parsing safety net (extractFilesFromContent) is downgraded to a TRUE
// fallback: it only runs when the worker wrote nothing through tools.
describe("weakened prose fallback for tool-capable workers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function gitRepoService() {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-prose-fallback-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: rootDir });
    await writeFile(join(rootDir, "README.md"), "# Fixture\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: rootDir });
    await execFileAsync(
      "git",
      ["-c", "user.name=RepoHelm", "-c", "user.email=repohelm@example.com", "commit", "-m", "init"],
      { cwd: rootDir }
    );
    return { rootDir, service: new RepoHelmService(new SqliteStateStore(rootDir), rootDir) };
  }

  async function plannerCli(rootDir: string): Promise<string> {
    const commandPath = join(rootDir, "planner-cli.mjs");
    await writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "const prompt = process.argv.slice(2).join('\\n');",
        "if (process.env.REPOHELM_TEST_PLAN_JSON && prompt.includes('Produce an execution plan')) {",
        "  console.log(process.env.REPOHELM_TEST_PLAN_JSON); process.exit(0);",
        "}",
        "console.log('planner fallback');"
      ].join("\n"),
      "utf8"
    );
    await chmod(commandPath, 0o755);
    return commandPath;
  }

  function chatResponse(message: Record<string, unknown>, finishReason: string): Response {
    return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  async function runByokWorker(turns: Array<{ message: Record<string, unknown>; finish: string }>) {
    const { rootDir, service } = await gitRepoService();
    const commandPath = await plannerCli(rootDir);
    const oldCommand = process.env.REPOHELM_GENERIC_CLI_COMMAND;
    process.env.REPOHELM_GENERIC_CLI_COMMAND = commandPath;

    let chatCalls = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      const target = String(url);
      if (target.includes("/chat/completions")) {
        const turn = turns[chatCalls] ?? { finish: "stop", message: { content: "done" } };
        chatCalls += 1;
        return chatResponse(turn.message, turn.finish);
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await service.bootstrap();
      await service.createModelKit({
        id: "planner-cli-kit",
        name: "Planner CLI",
        type: "cli",
        backendId: "generic",
        model: "default",
        config: { backendId: "generic" }
      });
      await service.createModelKit({
        id: "worker-byok-kit",
        name: "Worker BYOK",
        type: "byok",
        providerId: "openai",
        model: "gpt-test",
        config: { provider: "openai", baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "sk-test" }
      });
      await service.createSubAgent({
        id: "supervisor",
        name: "Supervisor",
        role: "Entry supervisor",
        capabilities: ["planning"],
        modelKitId: "planner-cli-kit",
        mode: "entry",
        permissions: { allowedTools: [], deniedTools: [] }
      });
      await service.createSubAgent({
        id: "coder",
        name: "Coder",
        role: "Writes code",
        capabilities: ["coding"],
        modelKitId: "worker-byok-kit",
        mode: "worker",
        permissions: { allowedTools: [], deniedTools: [] }
      });
      await service.setEntrySubAgent("supervisor");

      const state = await service.getState();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      process.env.REPOHELM_TEST_PLAN_JSON = JSON.stringify({
        summary: "Prose fallback plan",
        steps: [
          {
            id: "step_1",
            description: "Produce a file",
            agentId: "coder",
            agentName: "Coder",
            dependencies: [],
            expectedOutput: "a file",
            targetProjectId: project.id,
            contract: { doneCriteria: "file written" }
          }
        ]
      });

      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Prose fallback",
        requirement: "Worker produces a file.",
        affectedProjectIds: [project.id]
      });

      await service.runQuest(quest.id);
      return await service.approvePlan(quest.id);
    } finally {
      if (oldCommand === undefined) delete process.env.REPOHELM_GENERIC_CLI_COMMAND;
      else process.env.REPOHELM_GENERIC_CLI_COMMAND = oldCommand;
      delete process.env.REPOHELM_TEST_PLAN_JSON;
    }
  }

  it("ignores stray code fences in prose once the worker has written via tools", async () => {
    const executed = await runByokWorker([
      // Turn 1: write a real file through the tool.
      {
        finish: "tool_calls",
        message: {
          content: "",
          tool_calls: [
            { id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "real.txt", content: "real\n" }) } }
          ]
        }
      },
      // Turn 2: final prose carries a stray fence that must NOT be materialized.
      {
        finish: "stop",
        message: { content: "Done. For reference:\n```bonus.txt\nshould-not-be-written\n```\n" }
      }
    ]);

    const paths = executed.changedFiles.map((file) => file.path);
    expect(paths).toContain("real.txt");
    expect(paths).not.toContain("bonus.txt");
    expect(executed.status).toBe("ready");
  });

  it("still materializes a code fence as a true fallback when no tool wrote files", async () => {
    const executed = await runByokWorker([
      // Only turn: no tool calls, just a fenced file in prose. The fallback applies.
      {
        finish: "stop",
        message: { content: "Here is the file:\n```fallback.txt\nfallback-content\n```\n" }
      }
    ]);

    const paths = executed.changedFiles.map((file) => file.path);
    expect(paths).toContain("fallback.txt");
    expect(executed.status).toBe("ready");
  });
});
