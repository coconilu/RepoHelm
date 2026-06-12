import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const questTitle = `E2E Worktree Quest ${Date.now()}`;
const repoRoot = process.cwd();
const e2eWorktreeRoot = join(repoRoot, ".repohelm", "e2e", "configured-worktrees");
const docsPath = join(repoRoot, "docs");
// Repos are now added by directory; the name is auto-derived from the basename.
const boundRepoName = "docs";

test.afterAll(async () => {
  const response = await fetch("http://127.0.0.1:4300/api/state");
  const state = await response.json();
  const targetTitles = new Set([questTitle]);
  const targetQuests = state.quests.filter((quest: { title: string }) => targetTitles.has(quest.title));
  for (const targetQuest of targetQuests) {
    for (const worktree of targetQuest.worktrees ?? []) {
      const project = state.projects.find((item: { id: string }) => item.id === worktree.projectId);
      if (!project || worktree.status !== "created") {
        continue;
      }
      await execFileAsync("git", ["worktree", "remove", "--force", worktree.worktreePath], { cwd: project.path }).catch(
        () => undefined
      );
      await execFileAsync("git", ["branch", "-D", worktree.branchName], { cwd: project.path }).catch(() => undefined);
    }
  }
});

test("creates and runs a Quest from the workspace UI", async ({ page }) => {
  // Heavy end-to-end flow: settings + real git worktree checkout + streamed spec + delivery.
  test.setTimeout(120_000);
  const apiBase = "http://127.0.0.1:4300";
  await page.goto("/");

  // The fresh e2e state has no ModelKit, so seedBuiltInAgents skips and no entry sub-agent
  // exists — which leaves the composer's send button disabled. Inject a mock CLI ModelKit
  // plus an entry sub-agent so the workspace has a usable agent.
  const kit = await (await fetch(`${apiBase}/api/model-kits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "e2e-mock", type: "cli", backendId: "mock", model: "default", config: { backendId: "mock" } })
  })).json();
  const entryAgent = await (await fetch(`${apiBase}/api/sub-agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Supervisor",
      role: "Entry supervisor that decomposes requests and aggregates worker results.",
      capabilities: ["planning"],
      modelKitId: kit.id,
      mode: "entry",
      permissions: { allowedTools: ["delegate"], deniedTools: [] }
    })
  })).json();
  // The orchestrator delegates to worker agents; a fresh e2e state has none, so add a coder.
  await fetch(`${apiBase}/api/sub-agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Coder",
      role: "Implements code and plans concrete file-level changes.",
      capabilities: ["coding", "planning"],
      modelKitId: kit.id,
      mode: "worker",
      permissions: { allowedTools: [], deniedTools: [] }
    })
  });
  await fetch(`${apiBase}/api/sub-agents/set-entry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: entryAgent.id })
  });
  await page.reload();

  await expect(page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "清理" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "运行 Request" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "仓库管理" })).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "模型管理" })).toBeVisible();
  await expect(settingsDialog.getByRole("heading", { name: "仓库管理" })).toBeVisible();
  await expect(settingsDialog.getByText("RepoHelm").first()).toBeVisible();
  // Repos are global now: register the docs directory once, then link it from the workspace below.
  await settingsDialog.getByRole("textbox", { name: "项目路径" }).fill(docsPath);
  await settingsDialog.getByRole("button", { name: "添加仓库" }).click();
  const settingsProjectRow = settingsDialog.locator(".settings-project-row").filter({ hasText: docsPath });
  await expect(settingsProjectRow).toBeVisible();
  await expect(settingsProjectRow.getByRole("button", { name: "打开目录" })).toBeVisible();
  await expect(settingsProjectRow.getByRole("button", { name: "检查状态" })).toBeVisible();
  await settingsDialog.getByRole("tab", { name: "模型管理" }).click();
  await expect(settingsDialog.getByRole("tab", { name: "本机 CLI" })).toBeVisible();
  await expect(settingsDialog.getByRole("heading", { name: /你的 CLI/ })).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: "重新扫描" })).toBeVisible();
  await settingsDialog.getByRole("tab", { name: "BYOK" }).click();
  await expect(settingsDialog.getByRole("button", { name: "OpenAI" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "API Key" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "Base URL" })).toBeVisible();
  await expect(settingsDialog.getByRole("combobox", { name: "模型" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "手动模型" })).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: /刷新模型/ })).toBeVisible();
  await page.getByRole("button", { name: "关闭设置" }).click();

  await page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" }).click();
  await expect(page.locator(".request-list")).toBeHidden();
  await page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" }).click();
  await expect(page.locator(".request-list")).toBeVisible();
  await page.getByRole("button", { name: "创建 Workspace" }).click();
  const workspaceCreateDialog = page.getByRole("dialog", { name: "创建 Workspace" });
  await expect(workspaceCreateDialog).toBeVisible();
  await expect(workspaceCreateDialog.getByRole("textbox", { name: "Workspace 名称" })).toBeVisible();
  await page.getByRole("button", { name: "关闭 workspace 创建" }).click();
  await page.getByRole("button", { name: "为 RepoHelm Demo Workspace 创建 Request" }).click();
  await expect(page.getByRole("heading", { name: "把需求交给 Agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新 Request 草稿" })).toBeVisible();
  await expect(page.locator(".quest-row.active")).toContainText("新 Request");
  const defaultComposerHeight = (await page.getByRole("textbox", { name: "需求" }).boundingBox())?.height ?? 0;
  expect(defaultComposerHeight).toBeLessThanOrEqual(70);

  await page.getByRole("button", { name: "配置 RepoHelm Demo Workspace" }).click();
  const configDialog = page.getByRole("dialog", { name: "RepoHelm Demo Workspace" });
  await expect(configDialog).toBeVisible();
  // The workspace config dialog is now split into 基本信息 / 关联仓库 tabs; basic fields live on the default tab.
  await expect(configDialog.getByRole("tab", { name: "关联仓库" })).toBeVisible();
  await configDialog.getByRole("textbox", { name: "Workspace 描述" }).fill("E2E configured workspace");
  await configDialog.getByRole("textbox", { name: "Worktree Root" }).fill(e2eWorktreeRoot);
  await configDialog.getByRole("button", { name: "保存 Workspace" }).click();
  await expect(configDialog.getByRole("textbox", { name: "Worktree Root" })).toHaveValue(e2eWorktreeRoot);

  // Link the global docs repo into the workspace; this checks out a real worktree.
  await configDialog.getByRole("tab", { name: "关联仓库" }).click();
  await expect(configDialog.getByRole("heading", { name: "关联仓库" })).toBeVisible();
  await expect(configDialog.getByRole("combobox", { name: "选择要关联的仓库" })).toBeEnabled();
  await configDialog.getByRole("button", { name: "关联并 checkout worktree" }).click();
  const linkedRepoRow = configDialog.locator(".worktree-row").filter({ hasText: boundRepoName });
  await expect(linkedRepoRow).toBeVisible();
  await expect(linkedRepoRow.locator(".health-pill.ok")).toBeVisible();
  await linkedRepoRow.getByRole("button", { name: "删除" }).click();
  await expect(linkedRepoRow).toBeHidden();
  await page.getByRole("button", { name: "关闭 workspace 配置" }).click();

  await page
    .getByRole("textbox", { name: "需求" })
    .fill(`${questTitle}\n从浏览器创建 Quest，生成 Spec，推荐 security skill 审查 MCP manifest，运行 mock agent，并展示 worktree、review 和 knowledge。`);
  const expandedComposerHeight = (await page.getByRole("textbox", { name: "需求" }).boundingBox())?.height ?? 0;
  expect(expandedComposerHeight).toBeGreaterThan(defaultComposerHeight);
  await page.getByRole("button", { name: "发送给 Agent" }).click();

  await expect(page.getByRole("button", { name: new RegExp(questTitle) }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: questTitle })).toBeVisible();
  await expect(page.locator(".chat-header").getByRole("button", { name: "交付" })).toBeVisible();

  // Capability recommendation surfaced during the streaming creation flow.
  await page.locator(".inspector-tabs").getByRole("button", { name: "能力" }).click();
  const securityCapability = page.locator(".capability-row").filter({ hasText: "Security Review Skill" });
  await expect(securityCapability).toBeVisible();
  await expect(securityCapability.getByText("read:changed-files")).toBeVisible();

  // The orchestrator produced an approval-gated plan. The test stops here: quest execution
  // moved from the legacy direct mock-backend (which this test used to assert) to sub-agent
  // orchestration with a human Approve & Execute gate, covered by unit/integration tests.
  await expect(page.getByText("编排计划已生成").first()).toBeVisible();

  // Navigate to the Plan tab and verify the task contract is rendered.
  // Under REPOHELM_FAKE_MODELS=1 the planner output is not valid plan JSON, so parsePlanFromResponse
  // falls back to a single step with minimalContract("Implementation code and artifacts"),
  // which sets doneCriteria = "Implementation code and artifacts". This path is deterministic.
  await page.locator(".inspector-tabs").getByRole("button", { name: "Plan" }).click();
  await expect(page.getByText("完成判据:").first()).toBeVisible();
  await expect(page.getByText(/完成判据:.*Implementation code and artifacts/).first()).toBeVisible();
});
