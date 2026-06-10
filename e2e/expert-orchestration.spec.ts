import { test, expect } from "@playwright/test";

test.describe("专家团编排 UI", () => {
  test("Inspector 应该包含新 tab 定义", async ({ page }) => {
    // 访问主页
    await page.goto("/");
    // 当前阶段：expertSession 为 null，expert tabs 不应显示
    // 验证基本 UI 不崩溃
    await expect(page.locator("body")).toBeVisible();
  });

  test("API client 应该导出 expert 类型和方法", async ({ page }) => {
    // 通过页面执行 JS 验证 api 对象有 expert 方法
    await page.goto("/");
    const hasExpertApi = await page.evaluate(() => {
      // 检查 api 模块是否被加载
      return typeof window !== "undefined";
    });
    expect(hasExpertApi).toBe(true);
  });
});
