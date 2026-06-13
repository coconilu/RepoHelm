#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
const questsPath = path.join(cwd, "src", "quests.js");
const readmePath = path.join(cwd, "README.md");

if (!fs.existsSync(questsPath) || !fs.existsSync(readmePath)) {
  const prompt = process.argv.slice(2).join("\n");
  const agentMatch = prompt.match(/- (subagent-[^:]+): ([^\n]+?) —/);
  const projectMatch = prompt.match(/"targetProjectId" specifying which affected project's worktree[\s\S]*?project-[A-Za-z0-9_-]+|project-[A-Za-z0-9_-]+/);
  const agentId = agentMatch?.[1] ?? "qa-coder";
  const agentName = agentMatch?.[2] ?? "QA Coder";
  const projectId = projectMatch?.[0].match(/project-[A-Za-z0-9_-]+/)?.[0] ?? "";
  console.log(JSON.stringify({
    summary: "Update the golden fixture quest catalog with risk metadata and README usage notes.",
    steps: [
      {
        id: "step_1",
        description: "Add risk metadata to quests, export summarizeQuestRisks, and document usage in README.",
        agentId,
        agentName,
        dependencies: [],
        expectedOutput: "Implementation code and artifacts",
        targetProjectId: projectId,
        contract: {
          boundaries: "Only update README.md and src/quests.js.",
          sourcesGuidance: "Use the current fixture files as source of truth.",
          doneCriteria: "README.md and src/quests.js are changed, listQuests still returns the quest list, and summarizeQuestRisks is exported."
        }
      }
    ],
    notes: "Deterministic QA fixture plan."
  }));
  process.exit(0);
}

const questsSource = fs.readFileSync(questsPath, "utf8");
const readmeSource = fs.readFileSync(readmePath, "utf8");

const updatedQuests = questsSource
  .replace('owner: "product"', 'owner: "product",\n    risk: "medium"')
  .replace('owner: "docs"', 'owner: "docs",\n    risk: "low"')
  .replace(
    "export function listQuests() {\n  return quests;\n}\n",
    `export function listQuests() {
  return quests;
}

export function summarizeQuestRisks() {
  return quests.reduce((summary, quest) => {
    const risk = quest.risk ?? "unknown";
    summary[risk] = (summary[risk] ?? 0) + 1;
    return summary;
  }, {});
}
`
  );

const updatedReadme = `${readmeSource.trim()}

## Risk Summary

Each quest includes a \`risk\` field. Use \`summarizeQuestRisks()\` to count quests by risk level.
`;

fs.writeFileSync(questsPath, updatedQuests, "utf8");
fs.writeFileSync(readmePath, updatedReadme, "utf8");

console.log(`Updated files in ${cwd}`);
console.log("```src/quests.js");
console.log(updatedQuests.trimEnd());
console.log("```");
console.log("```README.md");
console.log(updatedReadme.trimEnd());
console.log("```");
