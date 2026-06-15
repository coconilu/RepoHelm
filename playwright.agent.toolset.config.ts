import { defineConfig, devices } from "@playwright/test";

// Toolset QA agent scenario: a single-repo quest whose worker runs through the REAL
// BYOK tool-calling loop and exercises the built-in tool set (issue #22 A–E). The
// entry/supervisor keeps the deterministic CLI planning backend
// (golden-toolset-planning.cjs); the worker's BYOK ModelKit points at a fake LLM
// server the spec spawns. Web access is enabled so web_fetch is callable. Run via
// `pnpm test:agent:toolset`.
//
// REPOHELM_FAKE_STREAM_TEXT only feeds spec generation (streaming). The worker's
// non-streaming calls ignore REPOHELM_FAKE_MODELS and hit the fake server instead.
const FAKE_STREAM_TEXT =
  "需求分析：QA toolset built-in tools flow。\\n" +
  "```json\\n" +
  '{"background":"QA toolset built-in tools flow","userGoal":"用自带工具集生成契约摘要",' +
  '"functionalRequirements":["search_files 定位 findOffer","read_file 读取 logo.png","web_fetch 读取契约版本","write_todos 跟踪进度","start_process 验证"],' +
  '"nonFunctionalRequirements":["流程可重复","只新增 src/generated-summary.md"],' +
  '"affectedSurfaces":["Workspace","Repository","Quest","Artifact"],' +
  '"outOfScope":["真实外部模型调用"],' +
  '"acceptanceCriteria":["worker 走 BYOK 工具调用循环","生成 src/generated-summary.md","摘要含各工具真实输出","quest 进入待交付"],' +
  '"openQuestions":[]}\\n' +
  "```";

export default defineConfig({
  testDir: "./tests/agent/scenarios",
  testMatch: "golden-toolset-flow.spec.ts",
  timeout: 240_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-agent-toolset-report", open: "never" }]],
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
      "rm -rf .repohelm/agent-state-toolset && export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= " +
      "REPOHELM_ROOT=$PWD REPOHELM_STATE_ROOT=$PWD/.repohelm/agent-state-toolset " +
      "REPOHELM_CODEX_COMMAND=$PWD/tests/agent/fixtures/golden-toolset-planning.cjs " +
      "REPOHELM_ENABLE_WEB=1 " +
      `REPOHELM_FAKE_MODELS=1 REPOHELM_FAKE_STREAM_TEXT='${FAKE_STREAM_TEXT}' && pnpm dev`,
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
