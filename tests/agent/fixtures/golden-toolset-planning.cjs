#!/usr/bin/env node

// Deterministic planning backend for the `golden-toolset-flow` scenario.
//
// This fixture is wired as the ENTRY agent's CLI backend (REPOHELM_CODEX_COMMAND).
// It is only ever invoked for the planning phase: cwd is the RepoHelm root and the
// full planner prompt arrives as argv. Execution of the single step is handled by a
// BYOK worker (the fake LLM server), so this fixture never runs inside a worktree.
//
// It emits a ONE-step plan targeting golden-toolset-repo, assigned to the worker
// agent parsed from the "## Available Agent Pool" listing.

const prompt = process.argv.slice(2).join("\n");

// Worker agent id from "- subagent-xxx: Name — role".
const agentMatch = prompt.match(/- (subagent[-_][A-Za-z0-9_-]+): ([^\n]+?) —/);
const agentId = agentMatch?.[1] ?? "qa-coder";
const agentName = agentMatch?.[2]?.trim() ?? "QA Coder";

// Affected project id from "- project_xxx: golden-toolset-repo".
const projectRefs = [...prompt.matchAll(/- (project[-_][A-Za-z0-9_-]+): ([^\n]+)/g)].map((m) => ({
  id: m[1],
  name: m[2].trim()
}));
const toolsetProject = projectRefs.find((p) => /toolset/i.test(p.name)) ?? projectRefs[0];
const targetProjectId = toolsetProject?.id ?? "";

console.log(
  JSON.stringify({
    summary:
      "Use the built-in tool set (search, read image, web fetch, todos, process) to generate a contract summary in golden-toolset-repo.",
    steps: [
      {
        id: "step_1",
        description:
          "In golden-toolset-repo, locate findOffer with search_files, read assets/logo.png, fetch the contract docs, track progress with write_todos, verify with a background command, then write src/generated-summary.md capturing the real tool outputs.",
        agentId,
        agentName,
        dependencies: [],
        expectedOutput: "New src/generated-summary.md summarizing the tool outputs.",
        targetProjectId,
        contract: {
          boundaries: "Only create src/generated-summary.md in golden-toolset-repo. Do not modify existing files.",
          sourcesGuidance: "Use search_files, read_file, web_fetch, write_todos and start_process/read_process.",
          doneCriteria: "src/generated-summary.md exists and records the search hit, image bytes, contract version, todo count and process exit code."
        }
      }
    ],
    notes: "Deterministic QA toolset-flow fixture plan (single repo, BYOK worker exercises the built-in tools)."
  })
);
process.exit(0);
