import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test.afterAll(async () => {
  const response = await fetch("http://127.0.0.1:4300/api/state");
  const state = await response.json();
  const targetQuest = state.quests.find((quest: { title: string }) => quest.title === "E2E 验证 worktree Quest");
  if (!targetQuest) {
    return;
  }
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
});

test("creates and runs a Quest from the workspace UI", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "RepoHelm Demo Workspace" })).toBeVisible();
  await expect(page.getByText("Projects")).toBeVisible();

  await page.getByRole("textbox", { name: "标题" }).fill("E2E 验证 worktree Quest");
  await page
    .getByRole("textbox", { name: "需求" })
    .fill("从浏览器创建 Quest，生成 Spec，运行 mock agent，并展示 worktree、review 和 knowledge。");
  await page.getByRole("button", { name: /生成 Spec/ }).click();

  await expect(page.getByRole("button", { name: /E2E 验证 worktree Quest/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "E2E 验证 worktree Quest" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "从浏览器创建 Quest" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "验收标准" })).toBeVisible();

  await page.getByRole("button", { name: /运行 Quest/ }).click();

  await expect(page.locator("strong").filter({ hasText: "Worktree 已创建" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Validation & Review" })).toBeVisible();
  await expect(page.getByText("Quest Memory: E2E 验证 worktree Quest")).toBeVisible();
  await expect(page.getByText(/repohelm\/e2e-worktree-quest-/)).toBeVisible();
  await expect(page.getByText("created")).toBeVisible();
  await expect(page.getByText("当前 worktree 暂无文件变更")).toBeVisible();
});
