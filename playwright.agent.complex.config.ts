import { defineConfig, devices } from "@playwright/test";

// Complex QA agent scenario: a multi-repo, dependency-ordered quest. It uses its own
// deterministic backend (golden-complex-backend.cjs) and an isolated state root so it
// never collides with the basic flow. Run via `pnpm test:agent:complex`.
//
// REPOHELM_FAKE_STREAM_TEXT mirrors the basic config's literal format: prose + a fenced
// JSON spec block. The scenario asserts on the plan and worktree diffs, not the spec
// text, so the spec only needs to be a parseable, on-topic stub.
const FAKE_STREAM_TEXT =
  "需求分析：QA complex cross-repo flow。\\n" +
  "```json\\n" +
  '{"background":"QA complex cross-repo flow","userGoal":"验证跨仓库按依赖分步的完整流程",' +
  '"functionalRequirements":["golden-api-repo 新增 findItem","golden-web-repo 新增 renderItemDetail 复用契约","更新两个 README"],' +
  '"nonFunctionalRequirements":["流程可重复","步骤按依赖顺序"],' +
  '"affectedSurfaces":["Workspace","Repository","Quest","Artifact"],' +
  '"outOfScope":["真实外部模型调用"],' +
  '"acceptanceCriteria":["workspace 绑定两个仓库","计划至少两步且含依赖","两个 worktree 都有真实 diff","quest 进入待交付"],' +
  '"openQuestions":[]}\\n' +
  "```";

export default defineConfig({
  testDir: "./tests/agent/scenarios",
  testMatch: "golden-complex-flow.spec.ts",
  timeout: 240_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-agent-complex-report", open: "never" }]],
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
      "rm -rf .repohelm/agent-state-complex && export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= " +
      "REPOHELM_ROOT=$PWD REPOHELM_STATE_ROOT=$PWD/.repohelm/agent-state-complex " +
      "REPOHELM_CODEX_COMMAND=$PWD/tests/agent/fixtures/golden-complex-backend.cjs " +
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
