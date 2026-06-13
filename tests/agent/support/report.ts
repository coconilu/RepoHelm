import type { Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface QaAssertion {
  name: string;
  pass: boolean;
  detail: string;
}

export interface QaReportInput {
  runId: string;
  scenarioId: string;
  workspaceId?: string;
  projectId?: string;
  questId?: string;
  fixtureRepoPath: string;
  workspaceWorktreePath?: string;
  questWorktreePath?: string;
  gitDiff?: string;
  assertions: QaAssertion[];
}

export async function writeQaReport(page: Page, runDir: string, input: QaReportInput): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const screenshotPath = join(runDir, "final-ui.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(join(runDir, "assertions.json"), JSON.stringify(input.assertions, null, 2), "utf8");
  if (input.gitDiff) {
    await writeFile(join(runDir, "git-diff.patch"), input.gitDiff, "utf8");
  }
  const failed = input.assertions.filter((item) => !item.pass);
  const summary = [
    `# ${input.scenarioId}`,
    "",
    `Run: ${input.runId}`,
    `Status: ${failed.length === 0 ? "PASS" : "FAIL"}`,
    "",
    "## Evidence",
    "",
    `- Fixture repo: ${input.fixtureRepoPath}`,
    `- Workspace ID: ${input.workspaceId ?? "(not found)"}`,
    `- Project ID: ${input.projectId ?? "(not found)"}`,
    `- Quest ID: ${input.questId ?? "(not found)"}`,
    `- Workspace worktree: ${input.workspaceWorktreePath ?? "(not found)"}`,
    `- Quest worktree: ${input.questWorktreePath ?? "(not found)"}`,
    `- Screenshot: ${screenshotPath}`,
    "",
    "## Assertions",
    "",
    ...input.assertions.map((item) => `- [${item.pass ? "x" : " "}] ${item.name}: ${item.detail}`)
  ].join("\n");
  await writeFile(join(runDir, "summary.md"), `${summary}\n`, "utf8");
}
