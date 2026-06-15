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
  // Wait until the fake LLM server answers on /docs before running the flow.
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

test("QA agent runs a BYOK worker that exercises the built-in tool set (search/web/process/image/todos)", async ({
  page
}) => {
  const repoRoot = process.cwd();
  const runId = `${scenarioId}-${Date.now()}`;
  const runDir = join(repoRoot, ".repohelm", "agent-runs", runId);
  const worktreeRoot = join(runDir, "worktrees");
  const repoPath = await createFixtureRepo({ repoRoot, runDir, fixtureName: "golden-toolset-repo" });

  const workspaceName = `QA Toolset Workspace ${runId}`;
  const questTitle = `Toolset Built-in Tools Quest ${Date.now().toString(36)}`;
  const requirement =
    "在 golden-toolset-repo 中用自带工具集（search_files 定位 findOffer、read_file 读取 assets/logo.png、" +
    "web_fetch 读取契约版本、write_todos 跟踪进度、start_process 验证）生成 src/generated-summary.md，记录各工具的真实输出。";
  const assertions: QaAssertion[] = [];
  let gitDiff = "";
  let workspaceId: string | undefined;
  let questId: string | undefined;
  let worktreePath: string | undefined;
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
      description: "QA agent validates the built-in worker tool set through the BYOK tool-calling loop.",
      worktreeRoot
    });
    await addRepositoryViaUi(page, repoPath);
    await linkRepositoriesViaUi(page, workspaceName, ["golden-toolset-repo"]);
    await runQuestViaUi(page, { workspaceName, questTitle, requirement });

    const state = await getState();
    const workspace = state.workspaces.find((item) => item.name === workspaceName);
    const project = state.projects.find((item) => item.path === repoPath);
    const quest = state.quests.find((item) => item.title === questTitle);
    workspaceId = workspace?.id;
    questId = quest?.id;
    worktreePath = quest?.worktrees.find((item) => item.projectId === project?.id)?.worktreePath;

    record("workspace exists", Boolean(workspace), workspace?.id ?? "workspace missing");
    record("repository registered through UI", Boolean(project), project?.name ?? "project missing");
    record(
      "workspace linked the repository",
      Boolean(workspace && project && workspace.projectIds.includes(project.id) && workspace.worktrees.length >= 1),
      `linked=${workspace?.projectIds.length ?? 0} worktrees=${workspace?.worktrees.length ?? 0}`
    );
    record("quest is ready for delivery", quest?.status === "ready", quest?.status ?? "quest missing");

    if (quest?.planPath) {
      const planMd = await readFile(quest.planPath, "utf8").catch(() => "");
      const stepCount = (planMd.match(/^### step_/gm) ?? []).length;
      record("plan persisted with at least one step", stepCount >= 1, `steps=${stepCount}`);
    } else {
      record("plan persisted", false, "quest.planPath missing");
    }

    if (worktreePath) {
      const paths = await changedPaths(worktreePath);
      const allowed = new Set(["src/generated-summary.md"]);
      const unexpected = paths.filter((p) => !allowed.has(p));
      gitDiff += await gitOutput(worktreePath, ["diff", "--", "src/generated-summary.md"]);

      record("worker created the summary file", paths.includes("src/generated-summary.md"), paths.join(", ") || "none");
      record("no unexpected files changed", unexpected.length === 0, unexpected.join(", ") || "none");

      const summary = await readFile(join(worktreePath, "src", "generated-summary.md"), "utf8").catch(() => "");
      const pngBytes = await stat(join(worktreePath, "assets", "logo.png")).then((s) => s.size).catch(() => -1);

      // A — search_files (regex + glob) located the contract in catalog.js.
      record("A: search_files located the contract", /search_hit=src\/catalog\.js:\d+/.test(summary), summary.match(/search_hit=.*/)?.[0] ?? "missing");
      // D — read_file returned the PNG as base64 with correct mediaType + byte count.
      record("D: read_file returned the image media type", summary.includes("image_media_type=image/png"), summary.match(/image_media_type=.*/)?.[0] ?? "missing");
      record("D: read_file reported the real image byte count", pngBytes > 0 && summary.includes(`image_bytes=${pngBytes}`), `expected ${pngBytes}; ${summary.match(/image_bytes=.*/)?.[0] ?? "missing"}`);
      // B — web_fetch read the contract version from the local docs endpoint.
      record("B: web_fetch read the contract version", summary.includes("contract_version=v2-toolset"), summary.match(/contract_version=.*/)?.[0] ?? "missing");
      // E — write_todos tracked the worker's task list.
      record("E: write_todos recorded the task list", summary.includes("todos=2"), summary.match(/todos=.*/)?.[0] ?? "missing");
      // C — start_process/read_process started and observed a real background command in the worktree.
      record(
        "C: background process started and observed",
        summary.includes("process_started=true") && summary.includes("process_observed=true"),
        [summary.match(/process_started=.*/)?.[0], summary.match(/process_exit=.*/)?.[0]].filter(Boolean).join(" ") || "missing"
      );
    } else {
      record("quest worktree created", false, "worktree missing");
    }

    if (questId) {
      const artifacts = await readdir(join(repoRoot, ".repohelm", "quests", questId, "artifacts")).catch(() => []);
      record("worker artifacts exist", artifacts.some((name) => name.endsWith(".md")), artifacts.join(", ") || "none");
    }

    const changedStatePaths = new Set(
      (quest?.changedFiles ?? []).map((file) => (typeof file === "string" ? file : file.path))
    );
    record(
      "state changed files match git evidence",
      changedStatePaths.has("src/generated-summary.md"),
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
      fixtureRepoPath: repoPath,
      questWorktreePath: worktreePath ?? "",
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
