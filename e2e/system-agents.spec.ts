import { test, expect } from "@playwright/test";

test("系统 Agent 在设置面板中可见", async ({ page }) => {
  await page.goto("/");
  
  // 打开设置
  await page.getByRole("button", { name: "打开设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  
  // 切换到 Agent 标签
  await settingsDialog.getByRole("tab", { name: "Agent" }).click();
  
  // 验证系统 Agent 分区
  await expect(settingsDialog.locator("h3").filter({ hasText: "系统 Agent" })).toBeVisible();
  
  // 验证三个系统 Agent 卡片
  await expect(settingsDialog.locator(".system-agent-card").filter({ hasText: "知识库助手" })).toBeVisible();
  await expect(settingsDialog.locator(".system-agent-card").filter({ hasText: "用户习惯助手" })).toBeVisible();
  await expect(settingsDialog.locator(".system-agent-card").filter({ hasText: "失败经验助手" })).toBeVisible();
  
  // 验证每个系统 Agent 的标签
  const kbCard = settingsDialog.locator(".system-agent-card").filter({ hasText: "知识库助手" });
  await expect(kbCard.locator(".badge.green")).toContainText("知识库");
  await expect(kbCard.locator(".badge.blue")).toContainText("系统");
  
  // 验证 ModelKit 下拉框存在
  await expect(kbCard.locator("select")).toBeVisible();
  
  const habitsCard = settingsDialog.locator(".system-agent-card").filter({ hasText: "用户习惯助手" });
  await expect(habitsCard.locator(".badge.green")).toContainText("用户习惯");
  
  const failCard = settingsDialog.locator(".system-agent-card").filter({ hasText: "失败经验助手" });
  await expect(failCard.locator(".badge.green")).toContainText("失败经验");
  
  console.log("✅ 所有系统 Agent UI 验证通过");
});
