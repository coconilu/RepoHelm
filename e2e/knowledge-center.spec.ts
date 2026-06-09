import { expect, test } from "@playwright/test";

test("opens knowledge center, renders a wiki page, and exits", async ({ page }) => {
  await page.goto("/");

  // 等工作区加载
  await expect(
    page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" })
  ).toBeVisible();

  // 进入知识中心
  await page.getByRole("button", { name: "知识中心" }).click();
  await expect(page.locator(".knowledge-center")).toBeVisible();
  await expect(page.getByRole("button", { name: "Repo Wiki" })).toBeVisible();
  await expect(page.getByRole("button", { name: "记忆" })).toBeVisible();

  // 展开第一个仓库,点开首个页面
  const firstRepo = page.locator(".knowledge-repo-row").first();
  await firstRepo.click();
  const firstPage = page.locator(".knowledge-page-row").first();
  // fixture 仓库若已建库则有页面;否则跳过页面断言
  if (await firstPage.count()) {
    await firstPage.click();
    await expect(page.locator(".knowledge-content-body")).toBeVisible();
    // 切到源码模式
    await page.getByRole("button", { name: "源码" }).click();
    await expect(page.locator(".knowledge-source")).toBeVisible();
  }

  // 切到记忆 tab
  await page.getByRole("button", { name: "记忆" }).click();
  await expect(page.locator(".knowledge-search input")).toHaveAttribute("placeholder", "搜索记忆");

  // 返回退出知识中心,回到 Quest 模式
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page.locator(".knowledge-center")).toHaveCount(0);
  await expect(page.locator(".quest-stage, .chat-stage")).toBeVisible();
});
