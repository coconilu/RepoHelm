import { defineConfig, devices } from "@playwright/test";

// Recovery + knowledge QA agent scenario. This config intentionally preserves
// `.repohelm/agent-state-recovery-knowledge` so the created workspace, quests,
// events, wiki source files, worktrees, and QA reports remain available for review.

const FAKE_STREAM_TEXT =
  "需求分析：QA recovery knowledge flow。\\n" +
  "```json\\n" +
  '{"background":"QA recovery knowledge flow","userGoal":"完成三仓库 offer status 恢复交付",' +
  '"functionalRequirements":["动态委派四类 worker","保留失败验证证据","修复后重新验证","更新发布说明","验证知识库 stale 到 ready"],' +
  '"nonFunctionalRequirements":["保留 workspace 和工作记录","不依赖外部模型"],' +
  '"affectedSurfaces":["Workspace","Repository","Quest","Artifact","Knowledge Center"],' +
  '"outOfScope":["真实外部模型调用"],' +
  '"acceptanceCriteria":["quest 进入待交付","失败验证 artifact 被保留","知识库完成增量同步"],' +
  '"openQuestions":[]}\\n' +
  "```";

const FAKE_CHAT_JSON = JSON.stringify({
  pages: {
    overview: "Recovery knowledge flow bootstrap overview.",
    architecture: "Three repositories participate: API, web, and docs.",
    modules: "API contract, web consumer, release notes, and validation report.",
    "key-flows": "Bootstrap flow before the external stale commit.",
    conventions: "Preserve QA evidence and avoid deleting generated workspaces.",
    decisions: "Initial knowledge index for the recovery scenario."
  },
  updatedPages: {
    "key-flows": "Recovery knowledge flow incremental update: stale API knowledge was detected, verifier failure was recovered, and final validation evidence was preserved."
  },
  decisionEntry: "Recovery knowledge flow captured an offer status contract update."
});

export default defineConfig({
  testDir: "./tests/agent/scenarios",
  testMatch: "golden-recovery-knowledge-flow.spec.ts",
  timeout: 420_000,
  expect: {
    timeout: 20_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-agent-recovery-knowledge-report", open: "never" }]],
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
      "mkdir -p .repohelm/agent-state-recovery-knowledge && export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= " +
      "REPOHELM_ROOT=$PWD REPOHELM_STATE_ROOT=$PWD/.repohelm/agent-state-recovery-knowledge " +
      `REPOHELM_FAKE_MODELS=1 REPOHELM_FAKE_STREAM_TEXT='${FAKE_STREAM_TEXT}' REPOHELM_FAKE_CHAT_JSON='${FAKE_CHAT_JSON}' && pnpm dev`,
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
