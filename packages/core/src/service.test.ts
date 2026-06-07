import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { RepoHelmService } from "./service.js";
import { JsonStateStore, SqliteStateStore } from "./store.js";

const execFileAsync = promisify(execFile);

async function createService() {
  const rootDir = await mkdtemp(join(tmpdir(), "repohelm-core-test-"));
  return {
    rootDir,
    service: new RepoHelmService(new SqliteStateStore(rootDir), rootDir)
  };
}

async function createGitRepoService() {
  const rootDir = await mkdtemp(join(tmpdir(), "repohelm-core-git-test-"));
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

describe("RepoHelmService", () => {
  it("bootstraps a demo workspace with one linked project and seed knowledge", async () => {
    const { rootDir, service } = await createService();

    const state = await service.bootstrap();
    const persisted = await new RepoHelmService(new SqliteStateStore(rootDir), rootDir).getState();

    expect(state.workspaces).toHaveLength(1);
    expect(state.projects).toHaveLength(1);
    expect(state.knowledge).toHaveLength(2);
    expect(state.workspaces[0]?.projectIds).toEqual([state.projects[0]?.id]);
    expect(state.workspaces[0]?.worktreeRoot).toContain(join(rootDir, ".repohelm", "worktrees"));
    expect(state.projects[0]?.path).toBe(rootDir);
    expect(state.projects[0]?.validationCommand).toBe("pnpm test:all");
    expect(state.projects[0]?.health.status).toBe("unknown");
    expect(state.knowledge.every((item) => item.sourcePath)).toBe(true);
    await expect(access(state.knowledge[0]!.sourcePath!)).resolves.toBeUndefined();
    await expect(access(join(rootDir, ".repohelm", "state.sqlite"))).resolves.toBeUndefined();
    expect(persisted.workspaces[0]?.id).toBe(state.workspaces[0]?.id);
  });

  it("persists state through SQLite and migrates legacy JSON state", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-core-legacy-test-"));
    const legacyService = new RepoHelmService(new JsonStateStore(rootDir), rootDir);
    await legacyService.bootstrap();

    const sqliteService = new RepoHelmService(new SqliteStateStore(rootDir), rootDir);
    const sqliteState = await sqliteService.getState();
    const secondSqliteService = new RepoHelmService(new SqliteStateStore(rootDir), rootDir);
    const persistedState = await secondSqliteService.getState();

    expect(sqliteState.workspaces[0]?.name).toBe("RepoHelm Demo Workspace");
    expect(persistedState.workspaces[0]?.id).toBe(sqliteState.workspaces[0]?.id);
    await expect(access(join(rootDir, ".repohelm", "state.sqlite"))).resolves.toBeUndefined();
  });

  it("updates workspace and project configuration with health checks", async () => {
    const { rootDir, service } = await createGitRepoService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const project = state.projects[0]!;
    const nextWorktreeRoot = join(rootDir, ".repohelm", "custom-worktrees");

    const updatedWorkspace = await service.updateWorkspace(workspace.id, {
      name: "Configured Workspace",
      description: "M2 workspace config",
      worktreeRoot: nextWorktreeRoot
    });
    const updatedProject = await service.updateProject(project.id, {
      name: "RepoHelm Core",
      role: "library",
      path: rootDir,
      defaultBranch: "main",
      validationCommand: "pnpm test"
    });
    const checkedProject = await service.checkProjectHealth(project.id);
    const nextState = await service.getState();

    expect(updatedWorkspace).toMatchObject({
      name: "Configured Workspace",
      description: "M2 workspace config",
      worktreeRoot: nextWorktreeRoot
    });
    expect(updatedProject).toMatchObject({
      name: "RepoHelm Core",
      role: "library",
      validationCommand: "pnpm test"
    });
    expect(checkedProject.health.status).toBe("ok");
    expect(checkedProject.health.message).toContain("Git 仓库可用");
    expect(nextState.workspaces[0]?.name).toBe("Configured Workspace");
    expect(nextState.projects[0]?.health.status).toBe("ok");
  });

  it("registers a global repo and links it to a workspace with a checked-out worktree", async () => {
    const { rootDir, service } = await createGitRepoService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;

    const project = await service.createProject({
      name: "Docs",
      path: rootDir,
      role: "documentation",
      defaultBranch: "main",
      validationCommand: "npm test"
    });
    const registered = await service.getState();

    // Global repos are not bound to any workspace until explicitly linked.
    expect(registered.projects.some((item) => item.id === project.id)).toBe(true);
    expect(registered.workspaces[0]?.projectIds).not.toContain(project.id);

    const linked = await service.linkProjectToWorkspace(workspace.id, project.id);
    expect(linked.projectIds).toContain(project.id);
    expect(linked.worktrees).toHaveLength(1);
    expect(linked.worktrees[0]?.projectId).toBe(project.id);
    expect(linked.worktrees[0]?.status).toBe("created");
    expect(linked.worktrees[0]?.baseBranch).toBe("main");
    await expect(access(linked.worktrees[0]!.worktreePath)).resolves.toBeUndefined();

    const unlinked = await service.unlinkProjectFromWorkspace(workspace.id, project.id);
    expect(unlinked.projectIds).not.toContain(project.id);
    expect(unlinked.worktrees).toHaveLength(0);
    await expect(access(linked.worktrees[0]!.worktreePath)).rejects.toThrow();

    const withoutProject = await service.removeProject(project.id);
    expect(withoutProject.projects.some((item) => item.id === project.id)).toBe(false);
  });

  it("lists branches of a repo path and detects the default branch", async () => {
    const { rootDir, service } = await createGitRepoService();
    await execFileAsync("git", ["branch", "feature/extra"], { cwd: rootDir });

    const result = await service.listBranches(rootDir);

    expect(result.branches).toContain("main");
    expect(result.branches).toContain("feature/extra");
    expect(result.defaultBranch).toBe("main");
  });

  it("lists local CLIs with built-in default models and a synthetic default option", async () => {
    const { service } = await createService();

    const clis = await service.listLocalClis(false);

    expect(clis.map((cli) => cli.id)).toEqual(["claude-code", "codex-cli", "gemini-cli", "opencode"]);
    for (const cli of clis) {
      expect(cli.models[0]).toMatchObject({ id: "default", label: "Default (CLI config)" });
      expect(cli.modelsLive).toBe(false);
    }
  });

  it("reports a failed test for an unknown CLI", async () => {
    const { service } = await createService();

    const result = await service.testLocalCli("does-not-exist");

    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBe(0);
  });

  it("seeds an engine config and persists engine updates", async () => {
    const { rootDir, service } = await createService();

    const engine = await service.getEngine();
    expect(engine.mode).toBe("cli");
    expect(engine.cliId).toBe("claude-code");

    const updated = await service.updateEngine({
      mode: "byok",
      cliModels: { "opencode": "openai/gpt-5" },
      byokProviders: { openai: { model: "deepseek-chat" } },
      activeByokProviderId: "openai"
    });
    expect(updated.mode).toBe("byok");
    expect(updated.cliModels.opencode).toBe("openai/gpt-5");
    expect(updated.byokProviders.openai?.model).toBe("deepseek-chat");
    expect(updated.byokProviders.openai?.baseUrl).toBe("");
    expect(updated.activeByokProviderId).toBe("openai");

    const reloaded = await new RepoHelmService(new SqliteStateStore(rootDir), rootDir).getEngine();
    expect(reloaded.mode).toBe("byok");
    expect(reloaded.byokProviders.openai?.model).toBe("deepseek-chat");
  });

  it("isolates BYOK API keys per provider", async () => {
    const { service } = await createService();

    // Save config for DeepSeek
    const withDeepSeek = await service.updateEngine({
      mode: "byok",
      byokProviders: {
        deepseek: {
          provider: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-chat",
          apiKey: "sk-deepseek-key"
        }
      },
      activeByokProviderId: "deepseek"
    });
    expect(withDeepSeek.byokProviders.deepseek?.apiKey).toBe("sk-deepseek-key");
    expect(withDeepSeek.activeByokProviderId).toBe("deepseek");

    // Save config for OpenAI - should not affect DeepSeek
    const withOpenAI = await service.updateEngine({
      byokProviders: {
        openai: {
          provider: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o",
          apiKey: "sk-openai-key"
        }
      },
      activeByokProviderId: "openai"
    });
    expect(withOpenAI.byokProviders.openai?.apiKey).toBe("sk-openai-key");
    expect(withOpenAI.byokProviders.deepseek?.apiKey).toBe("sk-deepseek-key");
    expect(withOpenAI.activeByokProviderId).toBe("openai");

    // Update DeepSeek config - should not affect OpenAI
    const updatedDeepSeek = await service.updateEngine({
      byokProviders: {
        deepseek: {
          model: "deepseek-coder",
          apiKey: "sk-deepseek-new-key"
        }
      },
      activeByokProviderId: "deepseek"
    });
    expect(updatedDeepSeek.byokProviders.deepseek?.apiKey).toBe("sk-deepseek-new-key");
    expect(updatedDeepSeek.byokProviders.deepseek?.model).toBe("deepseek-coder");
    expect(updatedDeepSeek.byokProviders.deepseek?.baseUrl).toBe("https://api.deepseek.com");
    expect(updatedDeepSeek.byokProviders.openai?.apiKey).toBe("sk-openai-key");
    expect(updatedDeepSeek.activeByokProviderId).toBe("deepseek");
  });

  it("migrates old byok format to byokProviders on load", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-"));
    const repohelmDir = join(rootDir, ".repohelm");
    const statePath = join(repohelmDir, "state.json");

    // Create .repohelm directory
    await mkdir(repohelmDir, { recursive: true });

    // Write old format state with byok field
    const oldState = {
      workspaces: [],
      projects: [],
      quests: [],
      events: [],
      knowledge: [],
      capabilities: [],
      securityPolicy: {
        commandApprovalMode: "allowlist",
        allowedCommands: ["mock"],
        fileScopes: ["workspace"],
        networkScopes: ["localhost"],
        secretsPolicy: "redact-env",
        sandboxRuntime: "local",
        updatedAt: new Date().toISOString()
      },
      auditLog: [],
      engine: {
        mode: "byok",
        cliId: "claude-code",
        cliModels: {},
        byok: {
          provider: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-chat",
          apiKey: "sk-old-deepseek-key"
        },
        updatedAt: new Date().toISOString()
      },
      modelCache: {}
    };

    await writeFile(statePath, JSON.stringify(oldState), "utf8");

    // Load with JsonStateStore - should migrate
    const store = new JsonStateStore(rootDir);
    const state = await store.read();

    expect(state.engine.byokProviders.deepseek).toBeDefined();
    expect(state.engine.byokProviders.deepseek?.provider).toBe("DeepSeek");
    expect(state.engine.byokProviders.deepseek?.baseUrl).toBe("https://api.deepseek.com");
    expect(state.engine.byokProviders.deepseek?.model).toBe("deepseek-chat");
    expect(state.engine.byokProviders.deepseek?.apiKey).toBe("sk-old-deepseek-key");
    expect(state.engine.activeByokProviderId).toBe("deepseek");
    expect((state.engine as any).byok).toBeUndefined();
  });

  it("creates a quest with a lightweight spec and planning events", async () => {
    const { service } = await createService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;

    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "Add worktree execution",
      requirement: "为 RepoHelm 的每个受影响项目创建隔离 worktree。"
    });
    const nextState = await service.getState();

    expect(quest.status).toBe("planning");
    expect(quest.agentBackendId).toBe("mock");
    expect(quest.affectedProjectIds).toEqual(workspace.projectIds);
    expect(quest.spec.userGoal).toContain("隔离 worktree");
    expect(quest.spec.acceptanceCriteria).toHaveLength(3);
    expect(quest.spec.background).toContain("workspace 知识");
    expect(quest.capabilityRecommendations.length).toBeGreaterThan(0);
    expect(nextState.events.filter((event) => event.questId === quest.id)).toHaveLength(5);
    expect(await service.searchKnowledge(workspace.id, "RepoHelm")).not.toHaveLength(0);
  });

  it("recommends auditable capabilities and records manual acceptance", async () => {
    const { service } = await createService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;

    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "Audit MCP permissions",
      requirement: "需要 security skill 审查 MCP manifest 和 secrets 权限。"
    });
    const securityRecommendation = quest.capabilityRecommendations.find(
      (recommendation) => recommendation.capabilityId === "cap_security_skill"
    );
    const mcpRecommendation = quest.capabilityRecommendations.find(
      (recommendation) => recommendation.capabilityId === "cap_mcp_manifest"
    );

    expect(securityRecommendation?.status).toBe("pending");
    expect(mcpRecommendation?.requiredPermissions).toContain("read:mcp-manifest");

    const acceptedQuest = await service.acceptCapabilityRecommendation(quest.id, "cap_security_skill");
    const nextState = await service.getState();

    expect(
      acceptedQuest.capabilityRecommendations.find((recommendation) => recommendation.capabilityId === "cap_security_skill")
        ?.status
    ).toBe("accepted");
    expect(nextState.capabilities.find((capability) => capability.id === "cap_security_skill")?.installed).toBe(true);
    expect(nextState.events.find((event) => event.questId === quest.id && event.type === "capability.accepted")).toBeTruthy();
  });

  it("reports M8 product readiness with templates and a workspace dependency map", async () => {
    const { service } = await createService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const apiProject = await service.createProject({
      name: "API",
      path: "/tmp/repohelm-api",
      role: "backend"
    });
    await service.linkProjectToWorkspace(workspace.id, apiProject.id);

    const readiness = await service.getProductReadiness(workspace.id);

    expect(readiness.version).toBe("M8");
    expect(readiness.status).toBe("prototype-ready");
    expect(readiness.milestones.find((item) => item.id === "m8")).toMatchObject({
      status: "ready"
    });
    expect(readiness.workspaceTemplates.map((item) => item.id)).toContain("secure-agent");
    expect(readiness.dependencyMap.nodes.length).toBeGreaterThanOrEqual(2);
    expect(readiness.governance.find((item) => item.id === "testing")?.status).toBe("ready");
  });

  it("lists available agent backends with mock enabled by default", async () => {
    const { service } = await createService();

    const backends = await service.listAgentBackends();

    expect(backends.find((backend) => backend.id === "mock")).toMatchObject({
      available: true,
      configured: true
    });
    expect(backends.map((backend) => backend.id)).toEqual([
      "mock",
      "codex-cli",
      "claude-code",
      "opencode",
      "openai-compatible"
    ]);
  });

  it("runs a configured Codex CLI backend command and captures its artifact output", async () => {
    const previousCommand = process.env.REPOHELM_CODEX_COMMAND;
    process.env.REPOHELM_CODEX_COMMAND =
      "node -e \"const fs=require('node:fs');fs.mkdirSync('repohelm-quest-output',{recursive:true});fs.writeFileSync('repohelm-quest-output/codex-cli-fixture.md', 'Codex CLI fixture for '+process.env.REPOHELM_QUEST_TITLE+'\\n');console.log('fixture backend wrote artifact')\"";
    try {
      const { service } = await createGitRepoService();
      const state = await service.bootstrap();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Run real backend",
        requirement: "通过配置的 Codex CLI backend 写入实现产物。",
        agentBackendId: "codex-cli",
        affectedProjectIds: [project.id]
      });

      const completedQuest = await service.runQuest(quest.id);
      const nextState = await service.getState();
      const questEvents = nextState.events.filter((event) => event.questId === quest.id);

      expect(completedQuest.status).toBe("ready");
      expect(completedQuest.agentSummary).toContain("Codex CLI executed 1/1");
      expect(completedQuest.changedFiles.find((file) => file.path === ".repohelm/agent-input.json")).toBeTruthy();
      expect(completedQuest.changedFiles.find((file) => file.path === "repohelm-quest-output/codex-cli-fixture.md")).toMatchObject({
        status: "untracked"
      });
      expect(
        questEvents.find((event) => event.type === "agent.backend.completed")?.detail
      ).toContain("fixture backend wrote artifact");
      expect(questEvents.find((event) => event.type === "agent.artifacts.standardized")).toBeTruthy();
    } finally {
      if (previousCommand === undefined) {
        delete process.env.REPOHELM_CODEX_COMMAND;
      } else {
        process.env.REPOHELM_CODEX_COMMAND = previousCommand;
      }
    }
  });

  it("blocks an external backend command that is not allowed by the security policy", async () => {
    const previousCommand = process.env.REPOHELM_CODEX_COMMAND;
    process.env.REPOHELM_CODEX_COMMAND = "python -c \"print('not allowed')\"";
    try {
      const { service } = await createGitRepoService();
      const state = await service.bootstrap();
      const workspace = state.workspaces[0]!;
      const project = state.projects[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id,
        title: "Blocked backend",
        requirement: "尝试运行不在 allowlist 中的外部命令。",
        agentBackendId: "codex-cli",
        affectedProjectIds: [project.id]
      });

      const completedQuest = await service.runQuest(quest.id);
      const auditLog = await service.listAuditLog();

      expect(completedQuest.status).toBe("blocked");
      expect(completedQuest.agentSummary).toContain("不在 allowlist");
      expect(auditLog[0]).toMatchObject({
        type: "command",
        decision: "denied",
        subject: "Codex CLI"
      });
    } finally {
      if (previousCommand === undefined) {
        delete process.env.REPOHELM_CODEX_COMMAND;
      } else {
        process.env.REPOHELM_CODEX_COMMAND = previousCommand;
      }
    }
  });

  it("runs a quest into ready state with a real git worktree, validation, review, and memory", async () => {
    const { rootDir, service } = await createGitRepoService();
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
    expect(completedQuest.worktrees[0]?.status).toBe("created");
    expect(completedQuest.worktrees[0]?.branchName).toMatch(/^repohelm\/run-mvp-loop-/);
    expect(completedQuest.worktrees[0]?.worktreePath).toContain(join(rootDir, ".repohelm", "worktrees"));
    await expect(readFile(join(completedQuest.worktrees[0]!.worktreePath, "README.md"), "utf8")).resolves.toContain("Fixture");
    expect(completedQuest.validationResults.length).toBeGreaterThan(0);
    expect(completedQuest.reviewNotes.length).toBeGreaterThan(0);
    expect(completedQuest.changedFiles).toHaveLength(1);
    expect(completedQuest.changedFiles[0]?.path).toBe("repohelm-quest-output/run-mvp-loop.md");
    expect(completedQuest.changedFiles[0]?.status).toBe("untracked");
    expect(completedQuest.changedFiles[0]?.diff).toContain("MVP mock Implementation Agent");
    expect(completedQuest.agentSummary).toContain("Mock backend");
    expect(questEvents).toHaveLength(12);
    expect(questMemory?.type).toBe("memory");
    expect(questMemory?.body).toContain("1 个可 review 变更");
    expect(questMemory?.sourcePath).toContain(join(rootDir, ".repohelm", "knowledge"));
    await expect(readFile(questMemory!.sourcePath!, "utf8")).resolves.toContain(`Quest Memory: ${quest.title}`);
  });

  it("delivers a ready quest by validating and committing each created worktree", async () => {
    const { service } = await createGitRepoService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const project = state.projects[0]!;
    await service.updateProject(project.id, {
      validationCommand: "node --version"
    });
    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "Deliver worktree",
      requirement: "提交 worktree 中的 Agent 产物并生成 PR handoff。",
      affectedProjectIds: [project.id]
    });
    await service.runQuest(quest.id);

    const deliveredQuest = await service.deliverQuest(quest.id);
    const nextState = await service.getState();
    const deliveryEvent = nextState.events.find((event) => event.questId === quest.id && event.type === "delivery.completed");

    expect(deliveredQuest.status).toBe("delivered");
    expect(deliveredQuest.deliveryResults).toHaveLength(1);
    expect(deliveredQuest.deliveryResults[0]).toMatchObject({
      projectId: project.id,
      status: "pr_ready",
      commitMessage: "RepoHelm: Deliver worktree"
    });
    expect(deliveredQuest.deliveryResults[0]?.commitSha).toMatch(/[a-f0-9]{40}/);
    expect(deliveredQuest.deliveryResults[0]?.validationOutput).toContain("v");
    expect(deliveryEvent?.title).toBe("交付准备完成");
  });

  it("cleans up quest worktrees and can retry the quest into a fresh worktree", async () => {
    const { service } = await createGitRepoService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const project = state.projects[0]!;
    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "Retry worktree",
      requirement: "清理 worktree 后重新运行 Quest。",
      affectedProjectIds: [project.id]
    });
    const readyQuest = await service.runQuest(quest.id);
    const worktreePath = readyQuest.worktrees[0]!.worktreePath;

    const cleanedQuest = await service.cleanupQuestWorktrees(quest.id);
    await expect(access(worktreePath)).rejects.toBeTruthy();
    const retriedQuest = await service.retryQuest(quest.id);

    expect(cleanedQuest.worktrees[0]?.status).toBe("cleaned");
    expect(retriedQuest.status).toBe("ready");
    expect(retriedQuest.worktrees[0]?.status).toBe("created");
    await expect(access(retriedQuest.worktrees[0]!.worktreePath)).resolves.toBeUndefined();
  });

  it("blocks a quest when the affected project is not a git repository", async () => {
    const { service } = await createService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const project = state.projects[0]!;
    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "Non git project",
      requirement: "尝试为非 Git 项目创建 worktree。",
      affectedProjectIds: [project.id]
    });

    const completedQuest = await service.runQuest(quest.id);

    expect(completedQuest.status).toBe("blocked");
    expect(completedQuest.worktrees).toHaveLength(1);
    expect(completedQuest.worktrees[0]?.status).toBe("failed");
    expect(completedQuest.worktrees[0]?.note).toContain("not a git repository");
    expect(completedQuest.changedFiles).toEqual([]);
  });
});
