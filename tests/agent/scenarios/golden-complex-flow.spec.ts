import { expect, test } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, seedQaAgents } from "../support/api.js";
import { createFixtureRepo } from "../support/fixture-repo.js";
import { changedPaths, gitOutput } from "../support/git.js";
import { writeQaReport, type QaAssertion } from "../support/report.js";
import {
  addRepositoryViaUi,
  createWorkspaceViaUi,
  linkRepositoriesViaUi,
  runQuestViaUi
} from "../support/ui.js";

const scenarioId = "golden-complex-flow";

test("QA agent completes a cross-repo, dependency-ordered quest delivery flow", async ({ page }) => {
  const repoRoot = process.cwd();
  const runId = `${scenarioId}-${Date.now()}`;
  const runDir = join(repoRoot, ".repohelm", "agent-runs", runId);
  const worktreeRoot = join(runDir, "worktrees");
  const apiRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-api-repo" });
  const webRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-web-repo" });

  const workspaceName = `QA Complex Workspace ${runId}`;
  const questTitle = `Complex Cross-Repo Quest ${Date.now().toString(36)}`;
  // Both repo names appear in the requirement so inferAffectedProjectIds() pulls in BOTH
  // projects (direct name match), and the ordering keywords (首先/然后) keep it non-simple.
  const requirement =
    "首先在 golden-api-repo 的 src/inventory.js 中新增 findItem(sku) 并更新 README；" +
    "然后在 golden-web-repo 的 src/storefront.js 中新增 renderItemDetail(sku) 复用该契约，并更新 README 契约表。";
  const assertions: QaAssertion[] = [];
  let gitDiff = "";
  let workspaceId: string | undefined;
  let questId: string | undefined;
  let apiWorktreePath: string | undefined;
  let webWorktreePath: string | undefined;
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
      description: "QA agent validates a multi-repo, dependency-ordered quest through real UI actions.",
      worktreeRoot
    });
    await addRepositoryViaUi(page, apiRepoPath);
    await addRepositoryViaUi(page, webRepoPath);
    await linkRepositoriesViaUi(page, workspaceName, ["golden-api-repo", "golden-web-repo"]);
    await runQuestViaUi(page, { workspaceName, questTitle, requirement });

    const state = await getState();
    const workspace = state.workspaces.find((item) => item.name === workspaceName);
    const apiProject = state.projects.find((item) => item.path === apiRepoPath);
    const webProject = state.projects.find((item) => item.path === webRepoPath);
    const quest = state.quests.find((item) => item.title === questTitle);
    workspaceId = workspace?.id;
    questId = quest?.id;
    apiWorktreePath = quest?.worktrees.find((item) => item.projectId === apiProject?.id)?.worktreePath;
    webWorktreePath = quest?.worktrees.find((item) => item.projectId === webProject?.id)?.worktreePath;

    record("workspace exists", Boolean(workspace), workspace?.id ?? "workspace missing");
    record(
      "both repositories registered through UI",
      Boolean(apiProject && webProject),
      [apiProject?.name, webProject?.name].filter(Boolean).join(", ") || "projects missing"
    );
    record(
      "workspace linked both repositories",
      Boolean(
        workspace &&
          apiProject &&
          webProject &&
          workspace.projectIds.includes(apiProject.id) &&
          workspace.projectIds.includes(webProject.id) &&
          workspace.worktrees.length >= 2
      ),
      `linked=${workspace?.projectIds.length ?? 0} worktrees=${workspace?.worktrees.length ?? 0}`
    );
    record(
      "quest affects both projects",
      Boolean(
        apiProject &&
          webProject &&
          quest?.worktrees.some((w) => w.projectId === apiProject.id) &&
          quest?.worktrees.some((w) => w.projectId === webProject.id)
      ),
      JSON.stringify(quest?.worktrees.map((w) => w.projectId) ?? [])
    );
    record("quest is ready for delivery", quest?.status === "ready", quest?.status ?? "quest missing");

    // Result-first UI evidence: completed timelines land at the bottom result card,
    // while the raw audit drawer still exposes every quest event for replay.
    const questEventCount = state.events.filter((event) => event.questId === quest?.id).length;
    const resultCard = page.locator(".quest-result-card");
    const resultText = await resultCard.innerText({ timeout: 15_000 }).catch(() => "");
    record(
      "result-first card is visible",
      resultText.includes("结果已就绪，等待交付") && resultText.includes("4 文件"),
      resultText || "result card missing"
    );
    const chatScroll = await page.locator(".chat-thread").evaluate((el) => ({
      top: el.scrollTop,
      height: el.scrollHeight,
      client: el.clientHeight
    })).catch(() => undefined);
    record(
      "completed timeline lands on bottom result",
      Boolean(chatScroll && Math.abs(chatScroll.height - chatScroll.client - chatScroll.top) < 12),
      chatScroll ? JSON.stringify(chatScroll) : "chat thread missing"
    );
    const sectionOrder = await page.locator(".chat-thread > *").evaluateAll((nodes) =>
      nodes.map((node) => String((node as HTMLElement).className))
    ).catch(() => []);
    const rawAuditIndex = sectionOrder.findIndex((className) => className.includes("raw-audit-log"));
    const resultCardIndex = sectionOrder.findIndex((className) => className.includes("quest-result-card"));
    record(
      "result card follows raw audit in timeline order",
      rawAuditIndex >= 0 && resultCardIndex > rawAuditIndex,
      `rawAuditIndex=${rawAuditIndex} resultCardIndex=${resultCardIndex}`
    );
    const rawAudit = page.locator(".raw-audit-log");
    const expandAuditButton = rawAudit.getByRole("button", { name: "显示全部事件" });
    const canExpandAudit = await expandAuditButton.isVisible().catch(() => false);
    if (canExpandAudit) {
      await expandAuditButton.click();
      await expect(rawAudit.getByText("Raw Audit Log 已展开")).toBeVisible();
    }
    const rawRows = await page.locator(".raw-audit-row").count();
    record(
      "raw audit expands every quest event",
      canExpandAudit && rawRows === questEventCount && questEventCount > 0,
      `rows=${rawRows} stateEvents=${questEventCount}`
    );

    // Plan evidence: ≥2 steps, a real dependency, and two distinct target projects.
    if (quest?.planPath) {
      const planMd = await readFile(quest.planPath, "utf8").catch(() => "");
      const stepCount = (planMd.match(/^### step_/gm) ?? []).length;
      const hasDependency = /- \*\*Dependencies\*\*: (?!none)/m.test(planMd);
      const targetProjects = new Set(
        [...planMd.matchAll(/- \*\*Target Project\*\*: (\S+)/g)].map((m) => m[1])
      );
      record("plan has at least two steps", stepCount >= 2, `steps=${stepCount}`);
      record("plan encodes a dependency", hasDependency, hasDependency ? "yes" : "no dependency line");
      record("plan targets two distinct projects", targetProjects.size >= 2, [...targetProjects].join(", "));
    } else {
      record("plan persisted", false, "quest.planPath missing");
    }

    // API repo evidence.
    if (apiWorktreePath) {
      const paths = await changedPaths(apiWorktreePath);
      const allowed = new Set(["README.md", "src/inventory.js"]);
      const unexpected = paths.filter((p) => !allowed.has(p));
      const inventory = await readFile(join(apiWorktreePath, "src", "inventory.js"), "utf8");
      gitDiff += await gitOutput(apiWorktreePath, ["diff", "--", "README.md", "src/inventory.js"]);
      record("api repo changed expected files", paths.includes("src/inventory.js"), paths.join(", "));
      record("api repo no unexpected files", unexpected.length === 0, unexpected.join(", ") || "none");
      record("findItem exported in api repo", inventory.includes("export function findItem(sku)"), "src/inventory.js");
      record("listItems preserved in api repo", inventory.includes("export function listItems()"), "src/inventory.js");
    } else {
      record("api worktree created", false, "api worktree missing");
    }

    // Web repo evidence + cross-repo consistency.
    if (webWorktreePath) {
      const paths = await changedPaths(webWorktreePath);
      const allowed = new Set(["README.md", "src/storefront.js"]);
      const unexpected = paths.filter((p) => !allowed.has(p));
      const storefront = await readFile(join(webWorktreePath, "src", "storefront.js"), "utf8");
      const readme = await readFile(join(webWorktreePath, "README.md"), "utf8");
      gitDiff += await gitOutput(webWorktreePath, ["diff", "--", "README.md", "src/storefront.js"]);
      record("web repo changed expected files", paths.includes("src/storefront.js"), paths.join(", "));
      record("web repo no unexpected files", unexpected.length === 0, unexpected.join(", ") || "none");
      record(
        "renderItemDetail exported in web repo",
        storefront.includes("export function renderItemDetail(sku)"),
        "src/storefront.js"
      );
      record(
        "web repo documents the cross-repo contract",
        readme.includes("renderItemDetail(sku)"),
        "README.md"
      );
    } else {
      record("web worktree created", false, "web worktree missing");
    }

    // Artifacts for the executed steps.
    if (questId) {
      const artifacts = await readdir(join(repoRoot, ".repohelm", "quests", questId, "artifacts")).catch(() => []);
      record("worker artifacts exist", artifacts.some((name) => name.endsWith(".md")), artifacts.join(", ") || "none");
    }

    // State changedFiles must agree with the real git diffs across both repos.
    const changedStatePaths = new Set(
      (quest?.changedFiles ?? []).map((file) => (typeof file === "string" ? file : file.path))
    );
    record(
      "state changed files match git evidence",
      changedStatePaths.has("src/inventory.js") && changedStatePaths.has("src/storefront.js"),
      JSON.stringify([...changedStatePaths])
    );
  } catch (error) {
    runError = error;
    record("scenario completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    await writeQaReport(page, runDir, {
      runId,
      scenarioId,
      workspaceId,
      questId,
      fixtureRepoPath: `${apiRepoPath}, ${webRepoPath}`,
      questWorktreePath: [apiWorktreePath, webWorktreePath].filter(Boolean).join(", "),
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
