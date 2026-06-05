const fs = require("node:fs");
const path = require("node:path");

const outputDir = path.join(process.cwd(), "repohelm-quest-output");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "codex-cli-fixture.md"),
  [
    "# Codex CLI Fixture",
    "",
    `Quest: ${process.env.REPOHELM_QUEST_TITLE ?? "unknown"}`,
    "",
    "This artifact was written by the e2e Codex CLI backend fixture.",
    ""
  ].join("\n"),
  "utf8"
);

console.log("fixture backend wrote artifact");
