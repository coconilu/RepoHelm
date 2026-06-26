import { expect, type Page } from "@playwright/test";

export async function createWorkspaceViaUi(page: Page, input: {
  name: string;
  description: string;
  worktreeRoot: string;
}) {
  await page.getByRole("button", { name: "创建 Workspace" }).first().click();
  const dialog = page.getByRole("dialog", { name: "创建 Workspace" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Workspace 名称" }).fill(input.name);
  await dialog.getByRole("textbox", { name: "Workspace 描述" }).fill(input.description);
  await dialog.getByRole("textbox", { name: "Worktree Root" }).fill(input.worktreeRoot);
  await dialog.getByRole("button", { name: "创建 Workspace" }).click();
  await expect(page.locator(".workspace-title-button").filter({ hasText: input.name })).toBeVisible();
}

export async function addRepositoryViaUi(page: Page, repoPath: string) {
  await page.getByRole("button", { name: "打开设置" }).click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "仓库管理" }).click();
  await dialog.getByRole("textbox", { name: "项目路径" }).fill(repoPath);
  await dialog.getByRole("button", { name: "添加仓库" }).click();
  await expect(dialog.locator(".settings-project-row").filter({ hasText: repoPath })).toBeVisible();
  await page.getByRole("button", { name: "关闭设置" }).click();
}

export async function linkRepositoryViaUi(page: Page, workspaceName: string, repoName: string) {
  await page.getByRole("button", { name: `配置 ${workspaceName}` }).click();
  const dialog = page.getByRole("dialog", { name: workspaceName });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "关联仓库" }).click();
  await dialog.getByRole("button", { name: "关联并 checkout worktree" }).click();
  const row = dialog.locator(".worktree-row").filter({ hasText: repoName });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.locator(".health-pill.ok")).toBeVisible();
  await page.getByRole("button", { name: "关闭 workspace 配置" }).click();
}

/**
 * Link multiple repositories to a workspace in one config session. Unlike
 * linkRepositoryViaUi (which relies on the single default selection), this explicitly
 * picks each repo from the combobox, so order and count are deterministic.
 */
export async function linkRepositoriesViaUi(page: Page, workspaceName: string, repoNames: string[]) {
  await page.getByRole("button", { name: `配置 ${workspaceName}` }).click();
  const dialog = page.getByRole("dialog", { name: workspaceName });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "关联仓库" }).click();

  for (const repoName of repoNames) {
    const combobox = dialog.getByRole("combobox", { name: "选择要关联的仓库" });
    await expect(combobox).toBeEnabled();
    await combobox.click();
    await page.getByRole("option", { name: new RegExp(repoName) }).click();
    await dialog.getByRole("button", { name: "关联并 checkout worktree" }).click();
    const row = dialog.locator(".worktree-row").filter({ hasText: repoName });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator(".health-pill.ok")).toBeVisible();
  }

  await page.getByRole("button", { name: "关闭 workspace 配置" }).click();
}

export async function runQuestViaUi(page: Page, input: {
  workspaceName: string;
  questTitle: string;
  requirement: string;
}) {
  const workspaceRow = page.locator(".workspace-node").filter({ hasText: input.workspaceName });
  await workspaceRow.getByRole("button", { name: `为 ${input.workspaceName} 创建 Request` }).click();
  await expect(page.getByRole("heading", { name: "把需求交给 Agent" })).toBeVisible();
  await page.getByRole("textbox", { name: "需求" }).fill(`${input.questTitle}\n${input.requirement}`);
  await page.getByRole("button", { name: "发送给 Agent" }).click();
  await expect(page.getByRole("heading", { name: input.questTitle })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("编排计划已生成").first()).toBeVisible({ timeout: 30_000 });
  await page.locator(".chat-header").getByRole("button", { name: "证据" }).click();
  await page.locator(".inspector-tabs").getByRole("button", { name: "Plan" }).click();
  await expect(page.getByRole("button", { name: "Approve & Execute" })).toBeVisible();
  await page.getByRole("button", { name: "Approve & Execute" }).click();
  await page.getByRole("button", { name: "关闭 Evidence Drawer" }).click();
  await expect(page.locator(".quest-row").filter({ hasText: input.questTitle }).getByText("待交付")).toBeVisible({
    timeout: 60_000
  });
}

/**
 * Drive a quest that runs in DELEGATE mode. There is no static plan to approve:
 * sending the request triggers createQuest → runQuest, which executes the entry
 * agent's adaptive delegation loop synchronously, so the quest goes straight to
 * "待交付" with no plan-generated / Approve & Execute step.
 */
export async function runDelegationQuestViaUi(page: Page, input: {
  workspaceName: string;
  questTitle: string;
  requirement: string;
}) {
  const workspaceRow = page.locator(".workspace-node").filter({ hasText: input.workspaceName });
  await workspaceRow.getByRole("button", { name: `为 ${input.workspaceName} 创建 Request` }).click();
  await expect(page.getByRole("heading", { name: "把需求交给 Agent" })).toBeVisible();
  await page.getByRole("textbox", { name: "需求" }).fill(`${input.questTitle}\n${input.requirement}`);
  await page.getByRole("button", { name: "发送给 Agent" }).click();
  await expect(page.getByRole("heading", { name: input.questTitle })).toBeVisible({ timeout: 30_000 });
  // Delegate mode skips plan generation/approval and runs the loop synchronously.
  await expect(page.locator(".quest-row").filter({ hasText: input.questTitle }).getByText("待交付")).toBeVisible({
    timeout: 120_000
  });
}

export async function openKnowledgeCenterViaUi(page: Page) {
  const existing = page.locator(".knowledge-center");
  if (await existing.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: /打开知识中心/ }).click();
  await expect(existing).toBeVisible({ timeout: 15_000 });
}

export async function syncProjectKnowledgeViaUi(page: Page, repoName: string, expectedButton?: RegExp) {
  await openKnowledgeCenterViaUi(page);
  const center = page.locator(".knowledge-center");
  const row = center.locator(".knowledge-repo-row").filter({ hasText: repoName }).last();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const meta = center.locator(".knowledge-content-meta").filter({ hasText: repoName });
  if (!(await meta.isVisible({ timeout: 1_000 }).catch(() => false))) {
    // If the repo row was already expanded but not selected, the first click only
    // collapses it. A second click expands and selects it.
    await row.click();
  }
  await expect(meta).toBeVisible({ timeout: 15_000 });

  const button = center.locator(".knowledge-regenerate");
  if (expectedButton) {
    await expect(button).toContainText(expectedButton, { timeout: 15_000 });
  }
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await expect(center.locator(".knowledge-toast").filter({ hasText: "知识库更新成功" })).toBeVisible({
    timeout: 15_000
  });
}
