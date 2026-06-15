import { defineConfig, devices } from "@playwright/test";

// Delegation QA agent scenario: a two-repo quest whose ENTRY/supervisor is a BYOK
// agent driving the REAL delegate loop (orchestrator.executeDelegated). The entry's
// BYOK ModelKit and the worker ModelKits all point at a fake LLM server the spec
// spawns. selectExecutionMode routes the (complex, open-ended, ≥2-worker, BYOK-entry)
// quest to delegate mode, so the supervisor picks workers at runtime — no static
// plan, no approval gate. Run via `pnpm test:agent:delegation`.
//
// REPOHELM_FAKE_STREAM_TEXT feeds the streaming spec generation only; the entry's
// and workers' non-streaming tool-calling calls ignore REPOHELM_FAKE_MODELS and hit
// the fake server instead.
const FAKE_STREAM_TEXT =
  "需求分析：QA delegation dynamic flow。\\n" +
  "```json\\n" +
  '{"background":"QA delegation dynamic flow","userGoal":"让 supervisor 运行时动态委派给两个 worker",' +
  '"functionalRequirements":["supervisor 用 delegate 工具动态选择 worker","researcher 在 api 仓库产出 findings","implementer 在 web 仓库产出 summary"],' +
  '"nonFunctionalRequirements":["无静态计划/审批","每次委派可审计"],' +
  '"affectedSurfaces":["Workspace","Repository","Quest","Artifact"],' +
  '"outOfScope":["真实外部模型调用"],' +
  '"acceptanceCriteria":["supervisor 动态委派给 ≥2 个不同 worker","两个 worker 各自真实写文件","quest 进入待交付"],' +
  '"openQuestions":[]}\\n' +
  "```";

export default defineConfig({
  testDir: "./tests/agent/scenarios",
  testMatch: "golden-delegation-flow.spec.ts",
  timeout: 300_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-agent-delegation-report", open: "never" }]],
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
      "rm -rf .repohelm/agent-state-delegation && export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= " +
      "REPOHELM_ROOT=$PWD REPOHELM_STATE_ROOT=$PWD/.repohelm/agent-state-delegation " +
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
