import { expect, test } from "@playwright/test";

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

  await expect(page.locator("strong").filter({ hasText: "Worktree 计划已生成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Validation & Review" })).toBeVisible();
  await expect(page.getByText("Quest Memory: E2E 验证 worktree Quest")).toBeVisible();
  await expect(page.getByText("repohelm/e2e-worktree-quest")).toBeVisible();
  await expect(page.getByText("docs/specs/quest-spec.md")).toBeVisible();
});
