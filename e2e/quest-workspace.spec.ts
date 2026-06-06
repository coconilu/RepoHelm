import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const questTitle = `E2E Worktree Quest ${Date.now()}`;
const codexQuestTitle = `E2E Codex Backend Quest ${Date.now()}`;
const questSlug = questTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
const repoRoot = process.cwd();
const e2eWorktreeRoot = join(repoRoot, ".repohelm", "e2e", "configured-worktrees");
const docsPath = join(repoRoot, "docs");
// Repos are now added by directory; the name is auto-derived from the basename.
const boundRepoName = "docs";

test.afterAll(async () => {
  const response = await fetch("http://127.0.0.1:4300/api/state");
  const state = await response.json();
  const targetTitles = new Set([questTitle, codexQuestTitle]);
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
  await page.goto("/");

  await expect(page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "清理" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "运行 Request" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "仓库管理" })).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "大模型接入" })).toBeVisible();
  await expect(settingsDialog.getByRole("heading", { name: "仓库管理" })).toBeVisible();
  await expect(settingsDialog.getByText("RepoHelm").first()).toBeVisible();
  // Repos are global now: register the docs directory once, then link it from the workspace below.
  await settingsDialog.getByRole("textbox", { name: "项目路径" }).fill(docsPath);
  await settingsDialog.getByRole("button", { name: "添加目录" }).click();
  const settingsProjectRow = settingsDialog.locator(".settings-project-row").filter({ hasText: docsPath });
  await expect(settingsProjectRow).toBeVisible();
  await expect(settingsProjectRow.getByRole("button", { name: "打开目录" })).toBeVisible();
  await expect(settingsProjectRow.getByRole("button", { name: "检查状态" })).toBeVisible();
  await settingsDialog.getByRole("tab", { name: "大模型接入" }).click();
  await expect(settingsDialog.getByRole("button", { name: "OpenAI" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "API Key" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "Base URL" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "模型" })).toBeVisible();
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
  await expect(configDialog.getByRole("heading", { name: "关联仓库" })).toBeVisible();
  await configDialog.getByRole("textbox", { name: "Workspace 描述" }).fill("E2E configured workspace");
  await configDialog.getByRole("textbox", { name: "Worktree Root" }).fill(e2eWorktreeRoot);
  await configDialog.getByRole("button", { name: "保存 Workspace" }).click();
  await expect(configDialog.getByRole("textbox", { name: "Worktree Root" })).toHaveValue(e2eWorktreeRoot);

  // Link the global docs repo into the workspace; this checks out a real worktree.
  await expect(configDialog.getByRole("combobox", { name: "选择要关联的仓库" })).toBeEnabled();
  await configDialog.getByRole("button", { name: "关联并 checkout worktree" }).click();
  const linkedRepoRow = configDialog.locator(".settings-project-row").filter({ hasText: boundRepoName });
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
  await expect(page.getByRole("combobox", { name: "Agent Backend" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "执行模式" })).toBeVisible();
  await page.getByRole("button", { name: "发送给 Agent" }).click();

  await expect(page.getByRole("button", { name: new RegExp(questTitle) }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: questTitle })).toBeVisible();
  await expect(page.locator(".chat-header").getByRole("button", { name: "交付" })).toBeVisible();
  await expect(page.locator(".run-context").filter({ hasText: "Mock Implementation Agent" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "从浏览器创建 Quest" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent Spec" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "验收标准" })).toBeVisible();
  await page.locator(".inspector-tabs").getByRole("button", { name: "能力" }).click();
  const securityCapability = page.locator(".capability-row").filter({ hasText: "Security Review Skill" });
  await expect(securityCapability).toBeVisible();
  await expect(securityCapability.getByText("read:changed-files")).toBeVisible();
  await securityCapability.getByRole("button", { name: "确认启用" }).click();
  await expect(securityCapability.getByText("accepted")).toBeVisible();

  await expect(page.locator("strong").filter({ hasText: "Worktree 已创建" })).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: "验证完成" })).toBeVisible();

  await page.getByRole("button", { name: /知识中心/ }).click();
  await expect(page.getByText(`Quest Memory: ${questTitle}`).first()).toBeVisible();
  await page.getByRole("textbox", { name: "搜索知识" }).fill(questTitle);
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByText(`Quest Memory: ${questTitle}`).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`\\.repohelm/e2e/knowledge/.+${questSlug}`))).toBeVisible();
  await page.getByRole("button", { name: "关闭知识中心" }).click();

  await page.locator(".inspector-tabs").getByRole("button", { name: "概要" }).click();
  await expect(page.getByText("Spec validation").first()).toBeVisible();
  await expect(page.getByText(new RegExp(`repohelm/${questSlug}-`))).toBeVisible();
  await expect(page.locator(".badge.green").filter({ hasText: "created" })).toBeVisible();

  await page.locator(".inspector-tabs").getByRole("button", { name: "文件" }).click();
  const changedFileRow = page.locator(".changed-file-row").filter({ hasText: `repohelm-quest-output/${questSlug}.md` });
  await expect(changedFileRow).toBeVisible();
  await changedFileRow.click();
  await expect(page.getByText("MVP mock Implementation Agent")).toBeVisible();

  await page.getByRole("button", { name: "交付", exact: true }).click();
  await expect(page.locator("strong").filter({ hasText: "交付准备完成" })).toBeVisible();
  await expect(page.getByText("pr_ready").first()).toBeVisible();
  await expect(page.getByText("RepoHelm: E2E Worktree Quest").first()).toBeVisible();

  await page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" }).click();
  await page
    .getByRole("textbox", { name: "需求" })
    .fill(`${codexQuestTitle}\n从浏览器选择 Codex CLI backend，并验证外部 CLI fixture 写入产物。`);
  await page.getByRole("combobox", { name: "Agent Backend" }).selectOption("codex-cli");
  await page.getByRole("button", { name: "发送给 Agent" }).click();
  await expect(page.getByRole("heading", { name: codexQuestTitle })).toBeVisible();
  await expect(page.locator(".run-context").filter({ hasText: "Codex CLI" })).toBeVisible();

  await expect(page.locator("strong").filter({ hasText: "Codex CLI 已启动" })).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: "Agent 输出已标准化" })).toBeVisible();

  await page.locator(".inspector-tabs").getByRole("button", { name: "文件" }).click();
  const codexChangedFileRow = page.locator(".changed-file-row").filter({ hasText: "repohelm-quest-output/codex-cli-fixture.md" });
  await expect(codexChangedFileRow).toBeVisible();
  await codexChangedFileRow.click();
  await expect(page.getByText("e2e Codex CLI backend fixture")).toBeVisible();

  await page.locator(".inspector-tabs").getByRole("button", { name: "安全" }).click();
  await expect(page.getByText("Permission Model")).toBeVisible();
  await expect(page.getByText("Command approval")).toBeVisible();
  await expect(page.getByText("node").first()).toBeVisible();
  await expect(page.locator(".audit-row").filter({ hasText: "Codex CLI" }).filter({ hasText: "allowed" })).toBeVisible();

  await page.locator(".inspector-tabs").getByRole("button", { name: "产品" }).click();
  await expect(page.getByRole("heading", { name: "完整产品形态" })).toBeVisible();
  await expect(page.getByText("M8", { exact: true })).toBeVisible();
  await expect(page.getByText("prototype-ready")).toBeVisible();
  await expect(page.getByText("Secure Agent Workspace")).toBeVisible();
  await expect(page.getByText("Testing")).toBeVisible();
});
