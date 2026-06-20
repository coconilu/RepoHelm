import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const questTitle = `E2E Worktree Quest ${Date.now()}`;
const repoRoot = process.cwd();
const apiBase = process.env.REPOHELM_E2E_API_BASE ?? "http://127.0.0.1:4300";
const e2eWorktreeRoot = join(repoRoot, ".repohelm", "e2e", "configured-worktrees");
const docsPath = join(repoRoot, "docs");
// Repos are now added by directory; the name is auto-derived from the basename.
const boundRepoName = "docs";

test.afterAll(async () => {
  const response = await fetch(`${apiBase}/api/state`);
  const state = await response.json();
  const targetTitles = new Set([questTitle]);
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

test("selects the owning workspace when clicking a request from another workspace", async ({ page }) => {
  const runId = Date.now().toString(36);
  const firstWorkspaceName = `Cross Workspace Source ${runId}`;
  const firstQuestTitle = `Cross Workspace First Quest ${runId}`;
  const secondWorkspaceName = `Cross Workspace Second ${runId}`;
  const secondQuestTitle = `Cross Workspace Second Quest ${runId}`;
  const createdAt = new Date().toISOString();

  const firstWorkspace = {
    id: `ws-source-${runId}`,
    name: firstWorkspaceName,
    description: "Selection regression workspace",
    projectIds: [],
    worktrees: [],
    worktreeRoot: "",
    createdAt,
    updatedAt: createdAt
  };
  const secondWorkspace = {
    ...firstWorkspace,
    id: `ws-second-${runId}`,
    name: secondWorkspaceName
  };
  const spec = {
    background: "Selection regression",
    userGoal: "Switch request details across workspaces",
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    affectedSurfaces: ["Workspace sidebar"],
    outOfScope: [],
    acceptanceCriteria: [],
    openQuestions: []
  };
  const firstQuest = {
    id: `quest-source-${runId}`,
    workspaceId: firstWorkspace.id,
    title: firstQuestTitle,
    requirement: "First workspace request",
    status: "ready",
    spec,
    agentBackendId: "mock",
    affectedProjectIds: [],
    worktrees: [],
    changedFiles: [],
    validationResults: [],
    reviewNotes: [],
    deliveryResults: [],
    capabilityRecommendations: [],
    autoApprovePlan: false,
    createdAt,
    updatedAt: createdAt
  };
  const secondQuest = {
    ...firstQuest,
    id: `quest-second-${runId}`,
    workspaceId: secondWorkspace.id,
    title: secondQuestTitle,
    requirement: "Second workspace request"
  };

  await page.route("**/api/state", (route) => route.fulfill({
    json: {
      workspaces: [firstWorkspace, secondWorkspace],
      projects: [],
      quests: [firstQuest, secondQuest],
      events: [],
      knowledge: [],
      capabilities: [],
      securityPolicy: {
        commandApprovalMode: "allowlist",
        allowedCommands: [],
        commandTemplates: [],
        fileScopes: [],
        networkScopes: [],
        secretsPolicy: "redact-env",
        sandboxRuntime: "local-worktree",
        updatedAt: createdAt
      },
      auditLog: [],
      commandApprovals: [],
      engine: {
        mode: "cli",
        cliId: "mock",
        cliModels: {},
        byokProviders: {},
        activeByokProviderId: "openai",
        modelKits: {},
        updatedAt: createdAt
      },
      subAgents: {},
      userPreferences: {},
      failurePatterns: {}
    }
  }));
  await page.route("**/api/agent-backends", (route) => route.fulfill({
    json: [{ id: "mock", name: "Mock Agent", available: true, configured: true, detail: "Mock backend" }]
  }));
  await page.route("**/api/product-readiness", (route) => route.fulfill({
    json: {
      version: "test",
      status: "prototype-ready",
      milestones: [],
      workspaceTemplates: [],
      dependencyMap: { nodes: [], edges: [] },
      governance: []
    }
  }));

  await page.goto("/");
  await page.locator(".workspace-title-button").filter({ hasText: secondWorkspaceName }).click();
  await expect(page.getByRole("heading", { name: secondQuestTitle })).toBeVisible();

  const firstQuestButton = page.getByRole("button", { name: firstQuestTitle, exact: false });
  await firstQuestButton.click();
  await expect(page.getByRole("heading", { name: firstQuestTitle })).toBeVisible();
});

test("surfaces failed command details in the default Quest timeline", async ({ page }) => {
  const runId = Date.now().toString(36);
  const workspaceName = `Failure Timeline ${runId}`;
  const questTitle = `Blocked Quest ${runId}`;
  const createdAt = new Date().toISOString();
  const at = (offset: number) => new Date(Date.parse(createdAt) + offset).toISOString();
  const workspace = {
    id: `ws-failure-${runId}`,
    name: workspaceName,
    description: "Failure timeline regression workspace",
    projectIds: [],
    worktrees: [],
    worktreeRoot: "",
    createdAt,
    updatedAt: createdAt
  };
  const spec = {
    background: "Failure visibility regression",
    userGoal: "Keep failed command output visible",
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    affectedSurfaces: ["Quest timeline"],
    outOfScope: [],
    acceptanceCriteria: [],
    openQuestions: []
  };
  const quest = {
    id: `quest-failure-${runId}`,
    workspaceId: workspace.id,
    title: questTitle,
    requirement: "Show failed command output without expanding raw audit.",
    status: "blocked",
    spec,
    agentBackendId: "mock",
    affectedProjectIds: [],
    worktrees: [],
    changedFiles: [],
    validationResults: [],
    reviewNotes: ["Worker failed while running validation."],
    deliveryResults: [],
    capabilityRecommendations: [],
    autoApprovePlan: false,
    createdAt,
    updatedAt: createdAt
  };
  const events = [
    {
      id: `event-command-${runId}`,
      questId: quest.id,
      type: "agent.command",
      title: "执行命令 (exit 1)",
      detail: "pnpm test src/inventory.test.js\nstderr: missing findItem export",
      agent: "QA Coder",
      phase: "validate",
      visibility: "process",
      severity: "error",
      createdAt: at(1)
    },
    {
      id: `event-internal-${runId}`,
      questId: quest.id,
      type: "agent.backend.started",
      title: "内部后端启动",
      detail: "Internal backend bootstrap token preserved for audit.",
      agent: "System",
      phase: "prepare",
      visibility: "audit",
      severity: "info",
      createdAt: at(2)
    },
    {
      id: `event-output-${runId}`,
      questId: quest.id,
      type: "agent.output",
      title: "错误",
      detail: "CLI failed before completion: model overloaded",
      agent: "QA Coder",
      phase: "execute",
      visibility: "audit",
      severity: "error",
      createdAt: at(3)
    },
    {
      id: `event-step-${runId}`,
      questId: quest.id,
      type: "step.failed",
      title: "步骤失败: QA Coder",
      detail: "Validation failed.",
      agent: "QA Coder",
      phase: "execute",
      visibility: "milestone",
      severity: "error",
      createdAt: at(4)
    },
    {
      id: `event-orchestrator-${runId}`,
      questId: quest.id,
      type: "orchestrator.failed",
      title: "编排执行失败",
      detail: "执行失败，保留错误输出供审计。",
      agent: "QA Supervisor",
      phase: "review",
      visibility: "summary",
      severity: "error",
      createdAt: at(5)
    }
  ];

  await page.route("**/api/state", (route) => route.fulfill({
    json: {
      workspaces: [workspace],
      projects: [],
      quests: [quest],
      events,
      knowledge: [],
      capabilities: [],
      securityPolicy: {
        commandApprovalMode: "allowlist",
        allowedCommands: [],
        commandTemplates: [],
        fileScopes: [],
        networkScopes: [],
        secretsPolicy: "redact-env",
        sandboxRuntime: "local-worktree",
        updatedAt: createdAt
      },
      auditLog: [],
      commandApprovals: [],
      engine: {
        mode: "cli",
        cliId: "mock",
        cliModels: {},
        byokProviders: {},
        activeByokProviderId: "openai",
        modelKits: {},
        updatedAt: createdAt
      },
      subAgents: {},
      userPreferences: {},
      failurePatterns: {}
    }
  }));
  await page.route("**/api/agent-backends", (route) => route.fulfill({
    json: [{ id: "mock", name: "Mock Agent", available: true, configured: true, detail: "Mock backend" }]
  }));
  await page.route("**/api/product-readiness", (route) => route.fulfill({
    json: {
      version: "test",
      status: "prototype-ready",
      milestones: [],
      workspaceTemplates: [],
      dependencyMap: { nodes: [], edges: [] },
      governance: []
    }
  }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: questTitle })).toBeVisible();
  await expect(page.locator(".evidence-drawer")).toHaveCount(0);
  const rawAudit = page.getByLabel("原始审计日志");
  await expect(rawAudit.getByText("Raw Audit Log 已折叠")).toBeVisible();
  await expect(rawAudit.getByText("5 条原始事件完整保留")).toBeVisible();
  await expect(rawAudit.getByText("其中 1 条为 internal 事件")).toBeVisible();
  await expect(rawAudit.getByText("Internal backend bootstrap token preserved for audit.")).toHaveCount(0);
  await expect(page.getByText("stderr: missing findItem export")).toBeVisible();
  await expect(page.getByText("CLI failed before completion: model overloaded")).toBeVisible();
  const openAuditDrawerButton = rawAudit.getByRole("button", { name: "打开 Audit Drawer" });
  await openAuditDrawerButton.click();
  const evidenceDrawer = page.getByRole("dialog", { name: "Audit" });
  await expect(evidenceDrawer).toBeVisible();
  await expect(evidenceDrawer).toHaveAttribute("aria-modal", "true");
  await expect(evidenceDrawer).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await evidenceDrawer.evaluate((drawer) => drawer.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  expect(await evidenceDrawer.evaluate((drawer) => drawer.contains(document.activeElement))).toBe(true);
  await expect(evidenceDrawer.locator(".inspector-tabs").getByRole("button", { name: "Audit" })).toBeVisible();
  await expect(evidenceDrawer.getByText("完整事件回溯")).toBeVisible();
  await expect(evidenceDrawer.getByText("5 条事件")).toBeVisible();
  await expect(evidenceDrawer.getByText("Internal backend bootstrap token preserved for audit.")).toBeVisible();
  const overlayBeforeResize = await evidenceDrawer.boundingBox();
  const overlayResizeHandle = page.locator(".evidence-drawer-resize-handle");
  const overlayResizeBox = await overlayResizeHandle.boundingBox();
  expect(overlayBeforeResize).not.toBeNull();
  expect(overlayResizeBox).not.toBeNull();
  if (overlayBeforeResize && overlayResizeBox) {
    await page.mouse.move(overlayResizeBox.x + overlayResizeBox.width / 2, overlayResizeBox.y + overlayResizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(overlayResizeBox.x - 70, overlayResizeBox.y + overlayResizeBox.height / 2);
    await page.mouse.up();
    const overlayAfterResize = await evidenceDrawer.boundingBox();
    expect(overlayAfterResize?.width ?? 0).toBeGreaterThan(overlayBeforeResize.width + 30);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".evidence-drawer")).toHaveCount(0);
  await expect(openAuditDrawerButton).toBeFocused();
  await openAuditDrawerButton.click();
  await expect(evidenceDrawer).toBeVisible();
  await evidenceDrawer.getByRole("button", { name: "固定 Evidence Drawer" }).click();
  const dockedEvidence = page.getByRole("complementary", { name: "Audit" });
  await expect(dockedEvidence).toBeVisible();
  await expect(dockedEvidence).not.toHaveAttribute("aria-modal", "true");
  await expect(page.getByRole("dialog", { name: "Audit" })).toHaveCount(0);
  await expect(page.locator(".quest-main-region.evidence-docked")).toBeVisible();
  await dockedEvidence.locator(".inspector-tabs").getByRole("button", { name: "Audit" }).focus();
  let focusLeftDockedEvidence = false;
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    focusLeftDockedEvidence = await dockedEvidence.evaluate((drawer) => !drawer.contains(document.activeElement));
    if (focusLeftDockedEvidence) {
      break;
    }
  }
  expect(focusLeftDockedEvidence).toBe(true);
  await expect(page.getByRole("heading", { name: questTitle })).toBeVisible();
  const beforeResize = await dockedEvidence.boundingBox();
  const resizeHandle = page.locator(".evidence-resize-handle");
  const resizeBox = await resizeHandle.boundingBox();
  expect(beforeResize).not.toBeNull();
  expect(resizeBox).not.toBeNull();
  if (beforeResize && resizeBox) {
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x - 80, resizeBox.y + resizeBox.height / 2);
    await page.mouse.up();
    const afterResize = await dockedEvidence.boundingBox();
    expect(afterResize?.width ?? 0).toBeGreaterThan(beforeResize.width + 40);
  }
  await dockedEvidence.getByRole("button", { name: "关闭 Evidence Drawer" }).click();
  await expect(page.locator(".evidence-drawer")).toHaveCount(0);
  await page.setViewportSize({ width: 1000, height: 720 });
  await openAuditDrawerButton.click();
  const compactEvidenceDrawer = page.getByRole("dialog", { name: "Audit" });
  await expect(compactEvidenceDrawer).toBeVisible();
  await expect(compactEvidenceDrawer.getByRole("button", { name: "固定 Evidence Drawer" })).toBeDisabled();
  await expect(page.locator(".quest-main-region.evidence-docked")).toHaveCount(0);
  await compactEvidenceDrawer.getByRole("button", { name: "关闭 Evidence Drawer" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await rawAudit.getByRole("button", { name: "显示全部事件" }).click();
  await expect(rawAudit.getByText("Raw Audit Log 已展开")).toBeVisible();
  await expect(rawAudit.getByText("agent.backend.started")).toBeVisible();
  await expect(rawAudit.getByText("Internal backend bootstrap token preserved for audit.")).toBeVisible();
});

test("creates and runs a Quest from the workspace UI", async ({ page }) => {
  // Heavy end-to-end flow: settings + real git worktree checkout + streamed spec + delivery.
  test.setTimeout(120_000);
  await page.goto("/");

  // The fresh e2e state has no ModelKit, so seedBuiltInAgents skips and no entry sub-agent
  // exists — which leaves the composer's send button disabled. Inject a mock CLI ModelKit
  // plus an entry sub-agent so the workspace has a usable agent.
  const kit = await (await fetch(`${apiBase}/api/model-kits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "e2e-mock", type: "cli", backendId: "mock", model: "default", config: { backendId: "mock" } })
  })).json();
  const entryAgent = await (await fetch(`${apiBase}/api/sub-agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Supervisor",
      role: "Entry supervisor that decomposes requests and aggregates worker results.",
      capabilities: ["planning"],
      modelKitId: kit.id,
      mode: "entry",
      permissions: { allowedTools: ["delegate"], deniedTools: [] }
    })
  })).json();
  // The orchestrator delegates to worker agents; a fresh e2e state has none, so add a coder.
  await fetch(`${apiBase}/api/sub-agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Coder",
      role: "Implements code and plans concrete file-level changes.",
      capabilities: ["coding", "planning"],
      modelKitId: kit.id,
      mode: "worker",
      permissions: { allowedTools: [], deniedTools: [] }
    })
  });
  await fetch(`${apiBase}/api/sub-agents/set-entry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: entryAgent.id })
  });
  await page.reload();

  await expect(page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "清理" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "运行 Request" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "仓库管理" })).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "模型管理" })).toBeVisible();
  await expect(settingsDialog.getByRole("heading", { name: "仓库管理" })).toBeVisible();
  await expect(settingsDialog.getByText("RepoHelm").first()).toBeVisible();
  // Repos are global now: register the docs directory once, then link it from the workspace below.
  await settingsDialog.getByRole("textbox", { name: "项目路径" }).fill(docsPath);
  await settingsDialog.getByRole("button", { name: "添加仓库" }).click();
  const settingsProjectRow = settingsDialog.locator(".settings-project-row").filter({ hasText: docsPath });
  await expect(settingsProjectRow).toBeVisible();
  await expect(settingsProjectRow.getByRole("button", { name: "打开目录" })).toBeVisible();
  await expect(settingsProjectRow.getByRole("button", { name: "检查状态" })).toBeVisible();
  await settingsDialog.getByRole("tab", { name: "模型管理" }).click();
  await expect(settingsDialog.getByRole("tab", { name: "本机 CLI" })).toBeVisible();
  await expect(settingsDialog.getByRole("heading", { name: /你的 CLI/ })).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: "重新扫描" })).toBeVisible();
  await settingsDialog.getByRole("tab", { name: "BYOK" }).click();
  await expect(settingsDialog.getByRole("button", { name: "OpenAI" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "API Key" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "Base URL" })).toBeVisible();
  await expect(settingsDialog.getByRole("combobox", { name: "模型" })).toBeVisible();
  await expect(settingsDialog.getByRole("textbox", { name: "手动模型" })).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: /刷新模型/ })).toBeVisible();
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
  // The workspace config dialog is now split into 基本信息 / 关联仓库 tabs; basic fields live on the default tab.
  await expect(configDialog.getByRole("tab", { name: "关联仓库" })).toBeVisible();
  await configDialog.getByRole("textbox", { name: "Workspace 描述" }).fill("E2E configured workspace");
  await configDialog.getByRole("textbox", { name: "Worktree Root" }).fill(e2eWorktreeRoot);
  await configDialog.getByRole("button", { name: "保存 Workspace" }).click();
  await expect(configDialog.getByRole("textbox", { name: "Worktree Root" })).toHaveValue(e2eWorktreeRoot);

  // Link the global docs repo into the workspace; this checks out a real worktree.
  await configDialog.getByRole("tab", { name: "关联仓库" }).click();
  await expect(configDialog.getByRole("heading", { name: "关联仓库" })).toBeVisible();
  const linkProjectSelect = configDialog.getByRole("combobox", { name: "选择要关联的仓库" });
  await expect(linkProjectSelect).toBeEnabled();
  await linkProjectSelect.click();
  await page.getByRole("option", { name: /docs ·/ }).click();
  await configDialog.getByRole("button", { name: "关联并 checkout worktree" }).click();
  const linkedRepoRow = configDialog.locator(".worktree-row").filter({ hasText: boundRepoName });
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
  await page.getByRole("button", { name: "发送给 Agent" }).click();

  await expect(page.getByRole("button", { name: new RegExp(questTitle) }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: questTitle })).toBeVisible();
  await expect(page.locator(".chat-header").getByRole("button", { name: "交付" })).toBeVisible();

  // Capability recommendation surfaced during the streaming creation flow.
  await page.locator(".chat-header").getByRole("button", { name: "证据" }).click();
  await expect(page.getByRole("dialog", { name: "概要" })).toBeVisible();
  await page.locator(".inspector-tabs").getByRole("button", { name: "能力" }).click();
  await expect(page.getByRole("dialog", { name: "能力" })).toBeVisible();
  const securityCapability = page.locator(".capability-row").filter({ hasText: "Security Review Skill" });
  await expect(securityCapability).toBeVisible();
  await expect(securityCapability.getByText("read:changed-files")).toBeVisible();

  // The orchestrator produced an approval-gated plan. The test stops here: quest execution
  // moved from the legacy direct mock-backend (which this test used to assert) to sub-agent
  // orchestration with a human Approve & Execute gate, covered by unit/integration tests.
  await expect(page.getByText("编排计划已生成").first()).toBeVisible();

  // Navigate to the Plan tab and verify the task contract is rendered.
  // Under REPOHELM_FAKE_MODELS=1 the planner output is not valid plan JSON, so parsePlanFromResponse
  // falls back to a single step with minimalContract("Implementation code and artifacts"),
  // which sets doneCriteria = "Implementation code and artifacts". This path is deterministic.
  await page.locator(".inspector-tabs").getByRole("button", { name: "Plan" }).click();
  await expect(page.getByRole("dialog", { name: "Plan" })).toBeVisible();
  await expect(page.getByText("完成判据:").first()).toBeVisible();
  await expect(page.getByText(/完成判据:.*Implementation code and artifacts/).first()).toBeVisible();
});
