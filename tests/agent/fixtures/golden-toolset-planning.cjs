#!/usr/bin/env node

// Deterministic planning backend for the `golden-toolset-flow` scenario.
//
// Wired as the ENTRY agent's CLI backend (REPOHELM_CODEX_COMMAND). Only ever
// invoked for planning: cwd is the RepoHelm root and the planner prompt arrives
// as argv. Step execution is handled by BYOK workers (the fake LLM server).
//
// It emits a TWO-step, dependency-ordered plan across two repos assigned to two
// DISTINCT worker agents — exercising real plan-based orchestration:
//   step_1 → golden-api-repo  → "QA Researcher"  (search + read image + web_fetch)
//   step_2 → golden-web-repo  → "QA Implementer" (todos + process + search), deps [step_1]

const prompt = process.argv.slice(2).join("\n");

// Worker agents from "- subagent-xxx: Name — role".
const agents = [...prompt.matchAll(/- (subagent[-_][A-Za-z0-9_-]+): ([^\n]+?) —/g)].map((m) => ({
  id: m[1],
  name: m[2].trim()
}));
const researcher = agents.find((a) => /research/i.test(a.name)) ?? agents[0];
const implementer = agents.find((a) => /implement/i.test(a.name)) ?? agents[1] ?? agents[0];

// Affected projects from "- project_xxx: repo-name".
const projects = [...prompt.matchAll(/- (project[-_][A-Za-z0-9_-]+): ([^\n]+)/g)].map((m) => ({
  id: m[1],
  name: m[2].trim()
}));
const apiProject = projects.find((p) => /api/i.test(p.name)) ?? projects[0];
const webProject = projects.find((p) => /web/i.test(p.name)) ?? projects[1] ?? projects[0];

console.log(
  JSON.stringify({
    summary:
      "Research the inventory contract in golden-api-repo with the built-in tools, then implement and document the matching summary in golden-web-repo.",
    steps: [
      {
        id: "step_1",
        description:
          "In golden-api-repo, research the contract: use search_files to locate listItems, read assets/logo.png, fetch the contract docs, and write src/findings.md capturing the real tool outputs.",
        agentId: researcher?.id ?? "qa-researcher",
        agentName: researcher?.name ?? "QA Researcher",
        dependencies: [],
        expectedOutput: "New src/findings.md in golden-api-repo.",
        targetProjectId: apiProject?.id ?? "",
        contract: {
          boundaries: "Only create src/findings.md in golden-api-repo. Do not modify existing files.",
          sourcesGuidance: "Use search_files (regex+glob), read_file (image) and web_fetch.",
          doneCriteria: "src/findings.md records the search hit, image bytes and contract version."
        }
      },
      {
        id: "step_2",
        description:
          "In golden-web-repo, using step_1's findings, track progress with write_todos, verify with a background command, search the renderCatalog surface, and write src/summary.md.",
        agentId: implementer?.id ?? "qa-implementer",
        agentName: implementer?.name ?? "QA Implementer",
        dependencies: ["step_1"],
        expectedOutput: "New src/summary.md in golden-web-repo.",
        targetProjectId: webProject?.id ?? "",
        contract: {
          boundaries: "Only create src/summary.md in golden-web-repo. Do not modify existing files.",
          sourcesGuidance: "Use write_todos, start_process/read_process and search_files. Build on step_1's findings.",
          doneCriteria: "src/summary.md records the search hit, todo count and background-process state."
        }
      }
    ],
    notes: "Deterministic QA toolset-flow plan (two repos, two workers, dependency-ordered; BYOK workers exercise the built-in tools)."
  })
);
process.exit(0);
