import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/agent/scenarios",
  timeout: 180_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-agent-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    launchOptions: {
      args: ["--proxy-server=direct://", "--proxy-bypass-list=*"]
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command:
      "rm -rf .repohelm/agent-state && export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= REPOHELM_ROOT=$PWD REPOHELM_STATE_ROOT=$PWD/.repohelm/agent-state REPOHELM_CODEX_COMMAND=$PWD/tests/agent/fixtures/golden-codex-backend.cjs REPOHELM_FAKE_MODELS=1 REPOHELM_FAKE_STREAM_TEXT='需求分析：QA golden flow fixture。\\n```json\\n{\"background\":\"QA golden flow\",\"userGoal\":\"验证完整用户流程\",\"functionalRequirements\":[\"添加 risk 字段\",\"导出 summarizeQuestRisks\",\"更新 README\"],\"nonFunctionalRequirements\":[\"流程可重复\"],\"affectedSurfaces\":[\"Workspace\",\"Repository\",\"Quest\",\"Artifact\"],\"outOfScope\":[\"真实外部模型调用\"],\"acceptanceCriteria\":[\"workspace 绑定仓库\",\"quest 进入待交付\",\"worktree 有真实 diff\",\"artifact 存在\"],\"openQuestions\":[]}\\n```' && pnpm dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
