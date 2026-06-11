import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
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
      "rm -rf .repohelm/e2e && export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= REPOHELM_ROOT=$PWD REPOHELM_STATE_ROOT=$PWD/.repohelm/e2e REPOHELM_CODEX_COMMAND=\"node $PWD/e2e/fixtures/codex-backend-fixture.cjs\" && pnpm dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      REPOHELM_FAKE_MODELS: "1",
      REPOHELM_FAKE_STREAM_TEXT:
        '需求分析：这是一个测试用的需求。\n```json\n{"background":"测试背景","userGoal":"测试目标","functionalRequirements":["功能一"],"nonFunctionalRequirements":["非功能一"],"affectedSurfaces":["Quest"],"outOfScope":["范围外"],"acceptanceCriteria":["验收一","验收二","验收三"],"openQuestions":["待定问题"]}\n```',
      REPOHELM_FAKE_CHAT_JSON: JSON.stringify({
        pages: {
          overview: "Demo overview.",
          architecture: "Demo architecture.",
          modules: "Demo modules.",
          "key-flows": "Demo flows.",
          conventions: "Demo conventions.",
          decisions: "初次建立知识库。"
        }
      })
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
