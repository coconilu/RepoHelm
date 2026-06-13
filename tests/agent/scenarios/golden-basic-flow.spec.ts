import { expect, test } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, seedQaAgents } from "../support/api.js";
import { createFixtureRepo } from "../support/fixture-repo.js";
import { changedPaths, gitOutput } from "../support/git.js";
import { writeQaReport, type QaAssertion } from "../support/report.js";
import { addRepositoryViaUi, createWorkspaceViaUi, linkRepositoryViaUi, runQuestViaUi } from "../support/ui.js";

const scenarioId = "golden-basic-flow";

test("QA agent completes the basic workspace to quest delivery flow", async ({ page }) => {
  const repoRoot = process.cwd();
  const runId = `${scenarioId}-${Date.now()}`;
  const runDir = join(repoRoot, ".repohelm", "agent-runs", runId);
  const worktreeRoot = join(runDir, "worktrees");
  const fixtureRepoPath = await createFixtureRepo({
    repoRoot,
    runDir,
    fixtureName: "golden-basic-repo"
  });

  const workspaceName = `QA Golden Workspace ${runId}`;
  const questTitle = `Golden Basic Quest ${Date.now().toString(36)}`;
  const requirement =
    "In golden-basic-repo, add a risk field to each quest, expose summarizeQuestRisks() in src/quests.js, and update README with usage notes. Keep existing listQuests behavior.";
  const assertions: QaAssertion[] = [];
  let gitDiff = "";
  let workspaceId: string | undefined;
  let projectId: string | undefined;
  let questId: string | undefined;
  let workspaceWorktreePath: string | undefined;
  let questWorktreePath: string | undefined;
  let runError: unknown;

  const record = (name: string, pass: boolean, detail: string) => {
    assertions.push({ name, pass, detail });
  };

  try {
    await page.goto("/");
    await seedQaAgents();
    await page.reload();

    await createWorkspaceViaUi(page, {
      name: workspaceName,
      description: "QA agent validates the complete golden path through real UI actions.",
      worktreeRoot
    });
    await addRepositoryViaUi(page, fixtureRepoPath);
    await linkRepositoryViaUi(page, workspaceName, "golden-basic-repo");
    await runQuestViaUi(page, { workspaceName, questTitle, requirement });

    const state = await getState();
    const workspace = state.workspaces.find((item) => item.name === workspaceName);
    const project = state.projects.find((item) => item.path === fixtureRepoPath);
    const quest = state.quests.find((item) => item.title === questTitle);
    workspaceId = workspace?.id;
    projectId = project?.id;
    questId = quest?.id;
    workspaceWorktreePath = workspace?.worktrees.find((item) => item.projectId === project?.id)?.worktreePath;
    questWorktreePath = quest?.worktrees.find((item) => item.projectId === project?.id)?.worktreePath;

    record("workspace exists", Boolean(workspace), workspace?.id ?? "workspace missing");
    record(
      "repository registered through UI",
      Boolean(project && project.name === "golden-basic-repo"),
      project ? `${project.name} at ${project.path}` : "project missing"
    );
    record(
      "workspace linked repository",
      Boolean(workspace && project && workspace.projectIds.includes(project.id) && workspaceWorktreePath),
      workspaceWorktreePath ?? "workspace worktree missing"
    );
    record("quest exists", Boolean(quest), quest?.id ?? "quest missing");
    record("quest is ready for delivery", quest?.status === "ready", quest?.status ?? "quest missing");
    record(
      "quest worktree created",
      Boolean(questWorktreePath),
      questWorktreePath ?? "quest worktree missing"
    );

    if (questWorktreePath && questId) {
      const paths = await changedPaths(questWorktreePath);
      const allowedPaths = new Set(["README.md", "src/quests.js"]);
      const unexpectedPaths = paths.filter((path) => !allowedPaths.has(path));
      gitDiff = await gitOutput(questWorktreePath, ["diff", "--", "README.md", "src/quests.js"]);
      const questsJs = await readFile(join(questWorktreePath, "src", "quests.js"), "utf8");
      const readme = await readFile(join(questWorktreePath, "README.md"), "utf8");
      const artifacts = await readdir(join(repoRoot, ".repohelm", "quests", questId, "artifacts")).catch(() => []);

      record("expected files changed", paths.includes("README.md") && paths.includes("src/quests.js"), paths.join(", "));
      record("no unexpected files changed", unexpectedPaths.length === 0, unexpectedPaths.join(", ") || "none");
      record("risk metadata added", questsJs.includes('risk: "medium"') && questsJs.includes('risk: "low"'), "src/quests.js");
      record("risk summary exported", questsJs.includes("export function summarizeQuestRisks()"), "src/quests.js");
      record("README usage updated", readme.includes("summarizeQuestRisks()"), "README.md");
      record("worker artifact exists", artifacts.some((name) => name.endsWith(".md")), artifacts.join(", ") || "none");
      record(
        "state changed files match git evidence",
        Boolean(quest?.changedFiles.some((file) => typeof file !== "string" && file.path === "README.md")) &&
          Boolean(quest?.changedFiles.some((file) => typeof file !== "string" && file.path === "src/quests.js")),
        JSON.stringify(quest?.changedFiles.map((file) => (typeof file === "string" ? file : file.path)) ?? [])
      );
    }
  } catch (error) {
    runError = error;
    record("scenario completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    await writeQaReport(page, runDir, {
      runId,
      scenarioId,
      workspaceId,
      projectId,
      questId,
      fixtureRepoPath,
      workspaceWorktreePath,
      questWorktreePath,
      gitDiff,
      assertions
    });
  }

  if (runError) {
    throw runError;
  }

  const failed = assertions.filter((item) => !item.pass);
  expect(failed, `QA report: ${join(runDir, "summary.md")}`).toEqual([]);
});
