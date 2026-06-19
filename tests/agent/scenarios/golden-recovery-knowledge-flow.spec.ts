import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn, execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  getProjectKnowledge,
  getState,
  seedQaRecoveryKnowledgeAgents,
  type ProjectKnowledgeView
} from "../support/api.js";
import { createFixtureRepo } from "../support/fixture-repo.js";
import { changedPaths } from "../support/git.js";
import { writeQaReport, type QaAssertion } from "../support/report.js";
import {
  addRepositoryViaUi,
  createWorkspaceViaUi,
  linkRepositoriesViaUi,
  openKnowledgeCenterViaUi,
  runDelegationQuestViaUi,
  syncProjectKnowledgeViaUi
} from "../support/ui.js";

const scenarioId = "golden-recovery-knowledge-flow";
const FAKE_LLM_PORT = 4397;
const FAKE_LLM_BASE_URL = `http://127.0.0.1:${FAKE_LLM_PORT}`;

const execFileAsync = promisify(execFile);
let fakeLlm: ChildProcess | undefined;

test.beforeAll(async () => {
  const serverPath = join(process.cwd(), "tests", "agent", "fixtures", "golden-recovery-knowledge-llm-server.cjs");
  fakeLlm = spawn(process.execPath, [serverPath, String(FAKE_LLM_PORT)], { stdio: "inherit" });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(`${FAKE_LLM_BASE_URL}/`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("fake LLM server did not start in time");
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.afterAll(async () => {
  fakeLlm?.kill("SIGKILL");
});

async function commitExternalKnowledgeChange(repoPath: string): Promise<string> {
  await mkdir(join(repoPath, "docs"), { recursive: true });
  await writeFile(
    join(repoPath, "docs", "offer-status-contract.md"),
    [
      "# Offer Status Contract",
      "",
      "This external commit makes the API wiki stale before the recovery quest runs.",
      "The eventual delivery should preserve offerStatus across API and web consumers.",
      ""
    ].join("\n"),
    "utf8"
  );
  await execFileAsync("git", ["add", "docs/offer-status-contract.md"], { cwd: repoPath });
  await execFileAsync("git", ["commit", "-m", "Add offer status contract notes"], { cwd: repoPath });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoPath });
  return stdout.trim();
}

async function closeKnowledgeCenter(page: import("@playwright/test").Page) {
  const center = page.locator(".knowledge-center");
  if (!(await center.isVisible().catch(() => false))) return;
  await center.getByRole("button", { name: "返回" }).click();
  await expect(center).toHaveCount(0);
}

function recordFactory(assertions: QaAssertion[]) {
  return (name: string, pass: boolean, detail: string) => {
    assertions.push({ name, pass, detail });
  };
}

function changedFileSummary(quest: NonNullable<Awaited<ReturnType<typeof getState>>["quests"][number]> | undefined) {
  return (quest?.changedFiles ?? [])
    .map((file) => {
      if (typeof file === "string") return `# ${file}\n`;
      return [`# ${file.worktreePath}:${file.path}`, file.diff || "(no diff)", ""].join("\n");
    })
    .join("\n");
}

test("QA agent executes a preserved three-repo recovery + knowledge stale-sync scenario", async ({ page }) => {
  const repoRoot = process.cwd();
  const runStamp = Date.now().toString(36);
  const runId = `${scenarioId}-${runStamp}`;
  const runDir = join(repoRoot, ".repohelm", "agent-runs", runId);
  const worktreeRoot = join(runDir, "worktrees");

  const apiName = `golden-api-repo-${runStamp}`;
  const webName = `golden-web-repo-${runStamp}`;
  const docsName = `golden-docs-repo-${runStamp}`;
  const apiRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-api-repo", targetName: apiName });
  const webRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-web-repo", targetName: webName });
  const docsRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-docs-repo", targetName: docsName });

  const workspaceName = `QA Recovery Knowledge Workspace ${runStamp}`;
  const questTitle = `Recovery Knowledge Quest ${runStamp}`;
  const requirement =
    `在 ${apiName}、${webName}、${docsName} 中完成 offer status 交付。` +
    "需求包含契约研究、API 契约更新、Web 消费端更新、运营发布说明、验证失败可追踪、定向修复、知识库增量同步证据。";

  const assertions: QaAssertion[] = [];
  const record = recordFactory(assertions);
  let workspaceId: string | undefined;
  let questId: string | undefined;
  let apiWorktreePath: string | undefined;
  let webWorktreePath: string | undefined;
  let docsWorktreePath: string | undefined;
  let staleViewBeforeSync: ProjectKnowledgeView | undefined;
  let readyViewAfterSync: ProjectKnowledgeView | undefined;
  let gitDiff = "";
  let runError: unknown;

  try {
    await page.goto("/");
    await seedQaRecoveryKnowledgeAgents(FAKE_LLM_BASE_URL);
    await page.reload();

    await createWorkspaceViaUi(page, {
      name: workspaceName,
      description: "QA agent validates recovery, stale knowledge sync, and preserved evidence.",
      worktreeRoot
    });
    await addRepositoryViaUi(page, apiRepoPath);
    await addRepositoryViaUi(page, webRepoPath);
    await addRepositoryViaUi(page, docsRepoPath);
    await linkRepositoriesViaUi(page, workspaceName, [apiName, webName, docsName]);

    await syncProjectKnowledgeViaUi(page, apiName, /建立知识库|重新生成/);
    await syncProjectKnowledgeViaUi(page, webName, /建立知识库|重新生成/);
    await syncProjectKnowledgeViaUi(page, docsName, /建立知识库|重新生成/);
    await closeKnowledgeCenter(page);

    const externalSha = await commitExternalKnowledgeChange(apiRepoPath);
    await openKnowledgeCenterViaUi(page);
    const apiRow = page.locator(".knowledge-center .knowledge-repo-row").filter({ hasText: apiName }).last();
    await apiRow.click();
    await expect(page.locator(".knowledge-center .knowledge-regenerate")).toContainText(/有 1 个新提交,更新/, {
      timeout: 15_000
    });
    await closeKnowledgeCenter(page);

    await runDelegationQuestViaUi(page, { workspaceName, questTitle, requirement });

    const state = await getState();
    const workspace = state.workspaces.find((item) => item.name === workspaceName);
    const apiProject = state.projects.find((item) => item.path === apiRepoPath);
    const webProject = state.projects.find((item) => item.path === webRepoPath);
    const docsProject = state.projects.find((item) => item.path === docsRepoPath);
    const quest = state.quests.find((item) => item.title === questTitle);
    workspaceId = workspace?.id;
    questId = quest?.id;
    apiWorktreePath = quest?.worktrees.find((item) => item.projectId === apiProject?.id)?.worktreePath;
    webWorktreePath = quest?.worktrees.find((item) => item.projectId === webProject?.id)?.worktreePath;
    docsWorktreePath = quest?.worktrees.find((item) => item.projectId === docsProject?.id)?.worktreePath;
    gitDiff = changedFileSummary(quest);

    record("workspace exists", Boolean(workspace), workspace?.id ?? "workspace missing");
    record(
      "three repositories registered through UI",
      Boolean(apiProject && webProject && docsProject),
      [apiProject?.name, webProject?.name, docsProject?.name].filter(Boolean).join(", ") || "projects missing"
    );
    record(
      "workspace linked three repositories",
      Boolean(workspace && workspace.projectIds.length >= 3 && workspace.worktrees.length >= 3),
      `linked=${workspace?.projectIds.length ?? 0} worktrees=${workspace?.worktrees.length ?? 0}`
    );
    record(
      "quest affects all three projects",
      Boolean(
        apiProject &&
          webProject &&
          docsProject &&
          quest?.affectedProjectIds.includes(apiProject.id) &&
          quest.affectedProjectIds.includes(webProject.id) &&
          quest.affectedProjectIds.includes(docsProject.id)
      ),
      JSON.stringify(quest?.affectedProjectIds ?? [])
    );
    record("quest is ready for delivery after recovery", quest?.status === "ready", quest?.status ?? "quest missing");
    record("delegate mode produced no static plan", !quest?.planPath, quest?.planPath ?? "no planPath");

    const questEvents = (state.events ?? []).filter((event) => event.questId === questId);
    const delegateCalls = questEvents.filter((event) => event.type === "agent.tool_call" && event.title.startsWith("委派任务:"));
    const delegatedAgentIds = new Set(
      delegateCalls
        .map((event) => {
          try {
            return JSON.parse(event.detail).agentId as string;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    );
    const completedAgents = new Set(questEvents.filter((event) => event.type === "step.completed").map((event) => event.agent));
    const verifierFailedMessage = questEvents.find(
      (event) => event.agent === "QA Verifier" && event.type === "agent.message" && event.detail.includes("VALIDATION_FAILED")
    );
    const repairDelegation = delegateCalls.find((event) => event.detail.includes("Repair the web consumer"));
    record("supervisor issued at least seven delegate calls", delegateCalls.length >= 7, `delegate calls=${delegateCalls.length}`);
    record("supervisor used four distinct runtime workers", delegatedAgentIds.size >= 4, [...delegatedAgentIds].join(", "));
    record(
      "four worker roles completed after folding recovery",
      ["QA Researcher", "QA Implementer", "QA Verifier", "QA Knowledge Curator"].every((name) => completedAgents.has(name)),
      [...completedAgents].join(", ")
    );
    record("timeline preserved failed verifier output", Boolean(verifierFailedMessage), verifierFailedMessage?.detail ?? "missing");
    record("timeline contains targeted repair delegation", Boolean(repairDelegation), repairDelegation?.detail ?? "missing");
    record(
      "supervisor summary references recovered failure",
      Boolean(quest?.agentSummary?.includes("先经历 1 次失败后成功") || quest?.agentSummary?.includes("recovered_failure")),
      quest?.agentSummary?.slice(0, 500) ?? "missing"
    );

    if (apiWorktreePath) {
      const paths = await changedPaths(apiWorktreePath);
      const allowed = new Set(["src/inventory.js"]);
      const inventory = await readFile(join(apiWorktreePath, "src", "inventory.js"), "utf8");
      record("api worktree changed only the contract file", paths.every((path) => allowed.has(path)), paths.join(", ") || "none");
      record("api contract exposes getOfferStatus", inventory.includes("export function getOfferStatus(sku)"), "src/inventory.js");
      record("api contract keeps listItems", inventory.includes("export function listItems()"), "src/inventory.js");
    } else {
      record("api quest worktree exists", false, "missing");
    }

    if (webWorktreePath) {
      const paths = await changedPaths(webWorktreePath);
      const allowed = new Set(["src/storefront.js", "reports/final-validation.md"]);
      const storefront = await readFile(join(webWorktreePath, "src", "storefront.js"), "utf8");
      const validation = await readFile(join(webWorktreePath, "reports", "final-validation.md"), "utf8").catch(() => "");
      record("web worktree changed consumer and validation report only", paths.every((path) => allowed.has(path)), paths.join(", ") || "none");
      record("web consumer was repaired to offerStatus", storefront.includes("item.offerStatus"), "src/storefront.js");
      record("final validation report records recovered failure", validation.includes("recovered_failure=true"), validation || "missing");
    } else {
      record("web quest worktree exists", false, "missing");
    }

    if (docsWorktreePath) {
      const paths = await changedPaths(docsWorktreePath);
      const allowed = new Set(["docs/release-notes.md"]);
      const notes = await readFile(join(docsWorktreePath, "docs", "release-notes.md"), "utf8");
      record("docs worktree changed release notes only", paths.every((path) => allowed.has(path)), paths.join(", ") || "none");
      record("release notes mention recovery", notes.includes("first web validation failed") && notes.includes("knowledge_sync=required"), "docs/release-notes.md");
    } else {
      record("docs quest worktree exists", false, "missing");
    }

    if (questId) {
      const artifacts = await readdir(join(repoRoot, ".repohelm", "quests", questId, "artifacts")).catch(() => []);
      const artifactBodies = await Promise.all(
        artifacts.map((name) => readFile(join(repoRoot, ".repohelm", "quests", questId, "artifacts", name), "utf8"))
      );
      record("artifacts include failed validation output", artifactBodies.some((body) => body.includes("VALIDATION_FAILED")), artifacts.join(", ") || "none");
      record("artifacts include final validation output", artifactBodies.some((body) => body.includes("VALIDATION_PASSED")), artifacts.join(", ") || "none");
      record("artifacts include research notes", artifactBodies.some((body) => body.includes("Research findings")), artifacts.join(", ") || "none");
    }

    const changedStatePaths = new Set(
      (quest?.changedFiles ?? []).map((file) => (typeof file === "string" ? file : `${file.projectId}:${file.path}`))
    );
    record(
      "state changed files include expected delivery evidence",
      Boolean(
        apiProject &&
          webProject &&
          docsProject &&
          changedStatePaths.has(`${apiProject.id}:src/inventory.js`) &&
          changedStatePaths.has(`${webProject.id}:src/storefront.js`) &&
          changedStatePaths.has(`${webProject.id}:reports/final-validation.md`) &&
          changedStatePaths.has(`${docsProject.id}:docs/release-notes.md`)
      ),
      JSON.stringify([...changedStatePaths])
    );

    if (apiProject) {
      staleViewBeforeSync = await getProjectKnowledge(apiProject.id);
      record(
        "api knowledge remained stale before incremental sync",
        staleViewBeforeSync.status === "stale" && staleViewBeforeSync.pendingCommits === 1 && staleViewBeforeSync.head === externalSha,
        `status=${staleViewBeforeSync.status} pending=${staleViewBeforeSync.pendingCommits} head=${staleViewBeforeSync.head}`
      );
      await syncProjectKnowledgeViaUi(page, apiName, /有 1 个新提交,更新/);
      readyViewAfterSync = await getProjectKnowledge(apiProject.id);
      const keyFlows = readyViewAfterSync.pages.find((page) => page.slug === "key-flows");
      const wikiSource = keyFlows?.sourcePath ? await readFile(keyFlows.sourcePath, "utf8").catch(() => "") : "";
      record(
        "api knowledge is ready after incremental sync",
        readyViewAfterSync.status === "ready" && readyViewAfterSync.pendingCommits === 0,
        `status=${readyViewAfterSync.status} pending=${readyViewAfterSync.pendingCommits}`
      );
      record(
        "incremental wiki source records recovery flow",
        wikiSource.includes("Recovery knowledge flow") || keyFlows?.body.includes("Recovery knowledge flow") === true,
        keyFlows?.sourcePath ?? "missing key-flows source"
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
      questId,
      fixtureRepoPath: `${apiRepoPath}, ${webRepoPath}, ${docsRepoPath}`,
      questWorktreePath: [apiWorktreePath, webWorktreePath, docsWorktreePath].filter(Boolean).join(", "),
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
