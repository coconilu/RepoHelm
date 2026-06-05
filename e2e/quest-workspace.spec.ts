import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const questTitle = `E2E Worktree Quest ${Date.now()}`;
const questSlug = questTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");

test.afterAll(async () => {
  const response = await fetch("http://127.0.0.1:4300/api/state");
  const state = await response.json();
  const targetQuests = state.quests.filter((quest: { title: string }) => quest.title === questTitle);
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
  await expect(page.getByRole("dialog", { name: "RepoHelm Demo Workspace" })).toBeVisible();
  await expect(page.getByText("关联项目")).toBeVisible();
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
});
