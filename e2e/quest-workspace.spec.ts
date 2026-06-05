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
const tempProjectName = `Temporary E2E Project ${Date.now()}`;

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
  await page.getByRole("button", { name: "配置 RepoHelm Demo Workspace" }).click();
  const configDialog = page.getByRole("dialog", { name: "RepoHelm Demo Workspace" });
  await expect(configDialog).toBeVisible();
  await expect(configDialog.getByText("关联项目")).toBeVisible();
  await configDialog.getByRole("textbox", { name: "Workspace 描述" }).fill("E2E configured workspace");
  await configDialog.getByRole("textbox", { name: "Worktree Root" }).fill(e2eWorktreeRoot);
  await configDialog.getByRole("button", { name: "保存 Workspace" }).click();
  await expect(configDialog.getByRole("textbox", { name: "Worktree Root" })).toHaveValue(e2eWorktreeRoot);

  await configDialog.getByRole("button", { name: "检查状态" }).first().click();
  await expect(configDialog.locator(".health-pill.ok").first()).toBeVisible();

  const addProjectForm = configDialog.locator(".add-project-form");
  await addProjectForm.getByRole("textbox", { name: "项目名称" }).fill(tempProjectName);
  await addProjectForm.getByRole("textbox", { name: "项目路径" }).fill(join(repoRoot, "docs"));
  await addProjectForm.getByRole("combobox", { name: "项目角色" }).selectOption("documentation");
  await addProjectForm.getByRole("textbox", { name: "验证命令" }).fill("pnpm test");
  await addProjectForm.getByRole("button", { name: "添加项目" }).click();
  const tempProjectCard = configDialog.locator(".project-config-card").filter({ hasText: tempProjectName });
  await expect(tempProjectCard).toBeVisible();
  await tempProjectCard.getByRole("button", { name: "移除" }).click();
  await expect(tempProjectCard).toBeHidden();
  await page.getByRole("button", { name: "关闭 workspace 配置" }).click();

  await page
    .getByRole("textbox", { name: "需求" })
    .fill(`${questTitle}\n从浏览器创建 Quest，生成 Spec，运行 mock agent，并展示 worktree、review 和 knowledge。`);
  await expect(page.getByRole("combobox", { name: "Agent Backend" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "执行模式" })).toBeVisible();
  await page.getByRole("button", { name: "发送给 Agent" }).click();

  await expect(page.getByRole("button", { name: new RegExp(questTitle) }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: questTitle })).toBeVisible();
  await expect(page.locator(".run-context").filter({ hasText: "Mock Implementation Agent" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "从浏览器创建 Quest" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent Spec" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "验收标准" })).toBeVisible();

  await page.getByRole("button", { name: "运行 Request" }).click();

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

  await page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" }).click();
  await page
    .getByRole("textbox", { name: "需求" })
    .fill(`${codexQuestTitle}\n从浏览器选择 Codex CLI backend，并验证外部 CLI fixture 写入产物。`);
  await page.getByRole("combobox", { name: "Agent Backend" }).selectOption("codex-cli");
  await page.getByRole("button", { name: "发送给 Agent" }).click();
  await expect(page.getByRole("heading", { name: codexQuestTitle })).toBeVisible();
  await expect(page.locator(".run-context").filter({ hasText: "Codex CLI" })).toBeVisible();

  await page.getByRole("button", { name: "运行 Request" }).click();
  await expect(page.locator("strong").filter({ hasText: "Codex CLI 已启动" })).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: "Agent 输出已标准化" })).toBeVisible();

  await page.locator(".inspector-tabs").getByRole("button", { name: "文件" }).click();
  const codexChangedFileRow = page.locator(".changed-file-row").filter({ hasText: "repohelm-quest-output/codex-cli-fixture.md" });
  await expect(codexChangedFileRow).toBeVisible();
  await codexChangedFileRow.click();
  await expect(page.getByText("e2e Codex CLI backend fixture")).toBeVisible();
});
