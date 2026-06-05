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
      "rm -rf .repohelm/e2e && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= REPOHELM_ROOT=$PWD REPOHELM_STATE_ROOT=$PWD/.repohelm/e2e REPOHELM_CODEX_COMMAND=\"node $PWD/e2e/fixtures/codex-backend-fixture.cjs\" pnpm dev",
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
