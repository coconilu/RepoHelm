import { test, expect } from "@playwright/test";

test("系统 Agent 在设置面板中可见", async ({ page }) => {
  await page.goto("/");

  // A fresh e2e state has no ModelKit, so seedBuiltInSubAgents skips and no system agents
  // exist. Inject a mock CLI ModelKit plus the three built-in system agents via the API.
  const apiBase = "http://127.0.0.1:4300";
  const kit = await (await fetch(`${apiBase}/api/model-kits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "e2e-mock", type: "cli", backendId: "mock", model: "default", config: { backendId: "mock" } })
  })).json();
  const systemAgents = [
    { name: "知识库助手", role: "系统知识库 Agent", systemRole: "knowledge" },
    { name: "用户习惯助手", role: "系统用户习惯 Agent", systemRole: "habits" },
    { name: "失败经验助手", role: "系统失败经验 Agent", systemRole: "failure-experience" }
  ];
  for (const agent of systemAgents) {
    await fetch(`${apiBase}/api/sub-agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...agent, modelKitId: kit.id, mode: "system", permissions: { allowedTools: [], deniedTools: [] } })
    });
  }
  await page.reload();

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
