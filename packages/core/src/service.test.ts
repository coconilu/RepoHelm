import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  it("adds and removes projects from a workspace", async () => {
    const { service } = await createService();
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;

    const project = await service.createProject({
      workspaceId: workspace.id,
      name: "Docs",
      path: "/tmp/repohelm-docs",
      role: "documentation",
      defaultBranch: "main",
      validationCommand: "npm test"
    });
    const withProject = await service.getState();

    expect(withProject.workspaces[0]?.projectIds).toContain(project.id);
    expect(withProject.projects.find((item) => item.id === project.id)?.validationCommand).toBe("npm test");

    const withoutProject = await service.removeProject(project.id);

    expect(withoutProject.workspaces[0]?.projectIds).not.toContain(project.id);
    expect(withoutProject.projects.some((item) => item.id === project.id)).toBe(false);
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
    expect(nextState.events.filter((event) => event.questId === quest.id)).toHaveLength(4);
    expect(await service.searchKnowledge(workspace.id, "RepoHelm")).not.toHaveLength(0);
  });

  it("lists available agent backends with mock enabled by default", async () => {
    const { service } = await createService();

    const backends = await service.listAgentBackends();

    expect(backends.find((backend) => backend.id === "mock")).toMatchObject({
      available: true,
      configured: true
    });
    expect(backends.map((backend) => backend.id)).toEqual(["mock", "codex-cli", "claude-code", "opencode"]);
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
    expect(questEvents).toHaveLength(11);
    expect(questMemory?.type).toBe("memory");
    expect(questMemory?.body).toContain("1 个可 review 变更");
    expect(questMemory?.sourcePath).toContain(join(rootDir, ".repohelm", "knowledge"));
    await expect(readFile(questMemory!.sourcePath!, "utf8")).resolves.toContain(`Quest Memory: ${quest.title}`);
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
