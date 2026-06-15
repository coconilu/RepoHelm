import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, seedQaDelegationAgents } from "../support/api.js";
import { createFixtureRepo } from "../support/fixture-repo.js";
import { changedPaths, gitOutput } from "../support/git.js";
import { writeQaReport, type QaAssertion } from "../support/report.js";
import {
  addRepositoryViaUi,
  createWorkspaceViaUi,
  linkRepositoriesViaUi,
  runDelegationQuestViaUi
} from "../support/ui.js";

const scenarioId = "golden-delegation-flow";
const FAKE_LLM_PORT = 4398;
const FAKE_LLM_BASE_URL = `http://127.0.0.1:${FAKE_LLM_PORT}`;

let fakeLlm: ChildProcess | undefined;

test.beforeAll(async () => {
  const serverPath = join(process.cwd(), "tests", "agent", "fixtures", "golden-delegation-llm-server.cjs");
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

test("Supervisor dynamically delegates a two-repo quest to two distinct workers at runtime", async ({ page }) => {
  const repoRoot = process.cwd();
  const runId = `${scenarioId}-${Date.now()}`;
  const runDir = join(repoRoot, ".repohelm", "agent-runs", runId);
  const worktreeRoot = join(runDir, "worktrees");
  const apiRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-api-repo" });
  const webRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-web-repo" });

  const workspaceName = `QA Delegation Workspace ${runId}`;
  const questTitle = `Delegation Orchestration Quest ${Date.now().toString(36)}`;
  // Both repo names appear so inferAffectedProjectIds() pulls in BOTH projects
  // (=> not simple). Crucially there are NO ordering keywords (首先/然后/step/…),
  // so the requirement reads as open-ended — selectExecutionMode routes it to the
  // adaptive delegate path (BYOK entry + ≥2 workers + complex + no explicit steps).
  const requirement =
    "在 golden-api-repo 和 golden-web-repo 两个仓库中梳理并改进 offer 契约处理,让两端保持一致。" +
    "请自行判断如何拆分子任务、把每个子任务交给最合适的 worker 执行,并综合各 worker 的产出给出结论。";
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
    await seedQaDelegationAgents(FAKE_LLM_BASE_URL);
    await page.reload();

    await createWorkspaceViaUi(page, {
      name: workspaceName,
      description: "QA agent validates runtime dynamic delegation (delegate mode).",
      worktreeRoot
    });
    await addRepositoryViaUi(page, apiRepoPath);
    await addRepositoryViaUi(page, webRepoPath);
    await linkRepositoriesViaUi(page, workspaceName, ["golden-api-repo", "golden-web-repo"]);
    await runDelegationQuestViaUi(page, { workspaceName, questTitle, requirement });

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
    record("quest is ready for delivery", quest?.status === "ready", quest?.status ?? "quest missing");

    // --- Delegate mode (not plan mode): no static plan was generated/approved. ---
    record("ran without a static plan (delegate path)", !quest?.planPath, quest?.planPath ?? "no planPath");

    // --- Dynamic delegation evidence: the supervisor emitted ≥2 delegate tool ---
    // --- calls to two DISTINCT workers, decided at runtime in its loop.        ---
    const questEvents = (state.events ?? []).filter((e) => e.questId === questId);
    const delegateCalls = questEvents.filter((e) => e.type === "agent.tool_call" && e.title.startsWith("委派任务:"));
    const delegatedAgentIds = new Set(
      delegateCalls
        .map((e) => {
          try {
            return JSON.parse(e.detail).agentId as string;
          } catch {
            return (e.title.match(/委派任务:\s*(\S+)/) ?? [])[1];
          }
        })
        .filter(Boolean)
    );
    record(
      "supervisor issued ≥2 delegate tool calls",
      delegateCalls.length >= 2,
      `delegate calls=${delegateCalls.length}`
    );
    record(
      "delegated to two distinct workers",
      delegatedAgentIds.size >= 2,
      [...delegatedAgentIds].join(", ") || "none"
    );

    // Two distinct workers actually executed (step.completed events).
    const completedWorkers = new Set(
      questEvents.filter((e) => e.type === "step.completed").map((e) => e.agent)
    );
    record(
      "two distinct workers completed work",
      completedWorkers.has("QA Researcher") && completedWorkers.has("QA Implementer"),
      [...completedWorkers].join(", ") || "none"
    );

    // --- Each delegated worker produced real file output in its target repo. ---
    if (apiWorktreePath) {
      const paths = await changedPaths(apiWorktreePath);
      const findings = await readFile(join(apiWorktreePath, "src", "findings.md"), "utf8").catch(() => "");
      gitDiff += await gitOutput(apiWorktreePath, ["diff", "--", "src/findings.md"]);
      record("researcher created findings.md in api repo", paths.includes("src/findings.md"), paths.join(", ") || "none");
      record(
        "findings.md echoes a real search hit",
        /search_hit=src\/inventory\.js:\d+/.test(findings),
        findings.match(/search_hit=.*/)?.[0] ?? "missing"
      );
    } else {
      record("api worktree created", false, "api worktree missing");
    }

    if (webWorktreePath) {
      const paths = await changedPaths(webWorktreePath);
      const summary = await readFile(join(webWorktreePath, "src", "summary.md"), "utf8").catch(() => "");
      gitDiff += await gitOutput(webWorktreePath, ["diff", "--", "src/summary.md"]);
      record("implementer created summary.md in web repo", paths.includes("src/summary.md"), paths.join(", ") || "none");
      record(
        "summary.md echoes real tool outputs",
        /search_hit=src\/storefront\.js:\d+/.test(summary) && summary.includes("todos=2"),
        [summary.match(/search_hit=.*/)?.[0], summary.match(/todos=.*/)?.[0]].filter(Boolean).join(" ") || "missing"
      );
    } else {
      record("web worktree created", false, "web worktree missing");
    }

    // --- Supervisor synthesized both workers' results into the final summary. ---
    record(
      "supervisor summary references both workers",
      Boolean(quest?.agentSummary?.includes("QA Researcher") && quest?.agentSummary?.includes("QA Implementer")),
      quest?.agentSummary?.split("\n").slice(0, 4).join(" / ") ?? "missing"
    );

    if (questId) {
      const artifacts = await readdir(join(repoRoot, ".repohelm", "quests", questId, "artifacts")).catch(() => []);
      record(
        "worker artifacts exist for both delegations",
        artifacts.filter((name) => name.endsWith(".md")).length >= 2,
        artifacts.join(", ") || "none"
      );
    }

    const changedStatePaths = new Set(
      (quest?.changedFiles ?? []).map((file) => (typeof file === "string" ? file : file.path))
    );
    record(
      "state changed files match git evidence",
      changedStatePaths.has("src/findings.md") && changedStatePaths.has("src/summary.md"),
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
