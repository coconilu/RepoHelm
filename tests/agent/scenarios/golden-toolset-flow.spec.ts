import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getState, seedQaToolsetAgents } from "../support/api.js";
import { createFixtureRepo } from "../support/fixture-repo.js";
import { changedPaths, gitOutput } from "../support/git.js";
import { writeQaReport, type QaAssertion } from "../support/report.js";
import { addRepositoryViaUi, createWorkspaceViaUi, linkRepositoriesViaUi, runQuestViaUi } from "../support/ui.js";

const scenarioId = "golden-toolset-flow";
const FAKE_LLM_PORT = 4399;
const FAKE_LLM_BASE_URL = `http://127.0.0.1:${FAKE_LLM_PORT}`;

let fakeLlm: ChildProcess | undefined;

test.beforeAll(async () => {
  const serverPath = join(process.cwd(), "tests", "agent", "fixtures", "golden-toolset-llm-server.cjs");
  fakeLlm = spawn(process.execPath, [serverPath, String(FAKE_LLM_PORT)], { stdio: "inherit" });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(`${FAKE_LLM_BASE_URL}/docs`);
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

test("QA agent orchestrates a two-step, two-agent quest whose BYOK workers exercise the built-in tool set", async ({
  page
}) => {
  const repoRoot = process.cwd();
  const runId = `${scenarioId}-${Date.now()}`;
  const runDir = join(repoRoot, ".repohelm", "agent-runs", runId);
  const worktreeRoot = join(runDir, "worktrees");
  const apiRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-api-repo" });
  const webRepoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-web-repo" });

  const workspaceName = `QA Toolset Workspace ${runId}`;
  const questTitle = `Toolset Orchestration Quest ${Date.now().toString(36)}`;
  // Both repo names appear so inferAffectedProjectIds() pulls in BOTH projects;
  // the ordering keywords (首先/然后) keep it a non-simple, dependency-ordered plan.
  const requirement =
    "首先让 QA Researcher 在 golden-api-repo 中用 search_files/read_file/web_fetch 研究 listItems 契约并写 src/findings.md；" +
    "然后让 QA Implementer 在 golden-web-repo 中基于研究结果用 write_todos/start_process 验证并写 src/summary.md。";
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
    await seedQaToolsetAgents(FAKE_LLM_BASE_URL);
    await page.reload();

    await createWorkspaceViaUi(page, {
      name: workspaceName,
      description: "QA agent validates plan-based orchestration plus the built-in worker tool set.",
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
    record("quest is ready for delivery", quest?.status === "ready", quest?.status ?? "quest missing");

    // --- Orchestration evidence: 2 dependent steps, 2 target projects, 2 distinct agents. ---
    if (quest?.planPath) {
      const planMd = await readFile(quest.planPath, "utf8").catch(() => "");
      const stepCount = (planMd.match(/^### step_/gm) ?? []).length;
      const hasDependency = /- \*\*Dependencies\*\*: (?!none)/m.test(planMd);
      const targetProjects = new Set([...planMd.matchAll(/- \*\*Target Project\*\*: (\S+)/g)].map((m) => m[1]));
      const agentIds = new Set([...planMd.matchAll(/- \*\*Agent\*\*: .+ \(`([^`]+)`\)/g)].map((m) => m[1]));
      record("plan has two steps", stepCount === 2, `steps=${stepCount}`);
      record("plan encodes a dependency", hasDependency, hasDependency ? "yes" : "no dependency line");
      record("plan targets two distinct projects", targetProjects.size === 2, [...targetProjects].join(", "));
      record("plan delegates to two distinct agents", agentIds.size === 2, [...agentIds].join(", "));
    } else {
      record("plan persisted", false, "quest.planPath missing");
    }

    // --- step_1 (golden-api-repo / QA Researcher): search (A) + read_file image (D) + web_fetch (B). ---
    if (apiWorktreePath) {
      const paths = await changedPaths(apiWorktreePath);
      const unexpected = paths.filter((p) => p !== "src/findings.md");
      const findings = await readFile(join(apiWorktreePath, "src", "findings.md"), "utf8").catch(() => "");
      const pngBytes = await stat(join(apiWorktreePath, "assets", "logo.png")).then((s) => s.size).catch(() => -1);
      gitDiff += await gitOutput(apiWorktreePath, ["diff", "--", "src/findings.md"]);

      record("api worker created findings.md", paths.includes("src/findings.md"), paths.join(", ") || "none");
      record("api repo no unexpected files", unexpected.length === 0, unexpected.join(", ") || "none");
      record("A: search_files located the contract", /search_hit=src\/inventory\.js:\d+/.test(findings), findings.match(/search_hit=.*/)?.[0] ?? "missing");
      record("D: read_file returned the image media type", findings.includes("image_media_type=image/png"), findings.match(/image_media_type=.*/)?.[0] ?? "missing");
      record("D: read_file reported the real image byte count", pngBytes > 0 && findings.includes(`image_bytes=${pngBytes}`), `expected ${pngBytes}; ${findings.match(/image_bytes=.*/)?.[0] ?? "missing"}`);
      record("B: web_fetch read the contract version", findings.includes("contract_version=v2-toolset"), findings.match(/contract_version=.*/)?.[0] ?? "missing");
    } else {
      record("api worktree created", false, "api worktree missing");
    }

    // --- step_2 (golden-web-repo / QA Implementer): todos (E) + process (C) + search (A). ---
    if (webWorktreePath) {
      const paths = await changedPaths(webWorktreePath);
      const unexpected = paths.filter((p) => p !== "src/summary.md");
      const summary = await readFile(join(webWorktreePath, "src", "summary.md"), "utf8").catch(() => "");
      gitDiff += await gitOutput(webWorktreePath, ["diff", "--", "src/summary.md"]);

      record("web worker created summary.md", paths.includes("src/summary.md"), paths.join(", ") || "none");
      record("web repo no unexpected files", unexpected.length === 0, unexpected.join(", ") || "none");
      record("E: write_todos recorded the task list", summary.includes("todos=2"), summary.match(/todos=.*/)?.[0] ?? "missing");
      record(
        "C: background process started and observed",
        summary.includes("process_started=true") && summary.includes("process_observed=true"),
        [summary.match(/process_started=.*/)?.[0], summary.match(/process_exit=.*/)?.[0]].filter(Boolean).join(" ") || "missing"
      );
      record("A: search_files located the renderer", /search_hit=src\/storefront\.js:\d+/.test(summary), summary.match(/search_hit=.*/)?.[0] ?? "missing");
    } else {
      record("web worktree created", false, "web worktree missing");
    }

    if (questId) {
      const artifacts = await readdir(join(repoRoot, ".repohelm", "quests", questId, "artifacts")).catch(() => []);
      record("worker artifacts exist for both steps", artifacts.filter((name) => name.endsWith(".md")).length >= 2, artifacts.join(", ") || "none");
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
