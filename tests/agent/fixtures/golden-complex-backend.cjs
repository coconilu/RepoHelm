#!/usr/bin/env node

// Deterministic QA fixture backend for the `golden-complex-flow` scenario.
//
// It is invoked in two phases by createCliBackend (orchestrator.ts):
//   1. Planning  — cwd is the RepoHelm root (no fixture worktree created yet). The full
//      planner prompt is passed as argv. We emit a TWO-step plan with a real dependency,
//      pointing step 1 at golden-api-repo and step 2 at golden-web-repo by parsing the
//      "## Affected Projects" section (id: name) that planning.ts now surfaces.
//   2. Execution — cwd IS the target project's worktree. We detect which repo we are in
//      by file presence and apply that repo's edit.

const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
const inventoryPath = path.join(cwd, "src", "inventory.js");
const storefrontPath = path.join(cwd, "src", "storefront.js");

const inWorktree = fs.existsSync(inventoryPath) || fs.existsSync(storefrontPath);

if (!inWorktree) {
  // ---- Planning phase -------------------------------------------------------
  const prompt = process.argv.slice(2).join("\n");

  // Worker agent id from the "## Available Agent Pool" listing: "- subagent-...: Name — role".
  const agentMatch = prompt.match(/- (subagent-[^:]+): ([^\n]+?) —/);
  const agentId = agentMatch?.[1] ?? "qa-coder";
  const agentName = agentMatch?.[2] ?? "QA Coder";

  // Affected projects from "## Affected Projects" listing: "- project_xxx: repo-name".
  // Project IDs use an underscore separator (id("project") -> "project_xxx").
  const projectRefs = [...prompt.matchAll(/- (project[-_][A-Za-z0-9_-]+): ([^\n]+)/g)].map((m) => ({
    id: m[1],
    name: m[2].trim()
  }));
  const apiProject = projectRefs.find((p) => /api/i.test(p.name));
  const webProject = projectRefs.find((p) => /web/i.test(p.name));

  // Fall back to positional order if names did not match (keeps the plan two-step either way).
  const apiProjectId = (apiProject ?? projectRefs[0])?.id ?? "";
  const webProjectId = (webProject ?? projectRefs[1] ?? projectRefs[0])?.id ?? "";

  console.log(
    JSON.stringify({
      summary:
        "Extend the inventory API with findItem, then make the storefront consume it and update the contract docs.",
      steps: [
        {
          id: "step_1",
          description:
            "In golden-api-repo, add findItem(sku) to src/inventory.js (return the matching item or undefined) and document it in README.",
          agentId,
          agentName,
          dependencies: [],
          expectedOutput: "Updated src/inventory.js and README.md",
          targetProjectId: apiProjectId,
          contract: {
            boundaries: "Only edit src/inventory.js and README.md in golden-api-repo. Keep listItems() behavior.",
            sourcesGuidance: "Use the current fixture files as source of truth.",
            doneCriteria: "findItem(sku) is exported and README lists it under the API surface."
          }
        },
        {
          id: "step_2",
          description:
            "In golden-web-repo, add renderItemDetail(sku) to src/storefront.js mirroring the API's findItem, and update the README contract table.",
          agentId,
          agentName,
          dependencies: ["step_1"],
          expectedOutput: "Updated src/storefront.js and README.md",
          targetProjectId: webProjectId,
          contract: {
            boundaries: "Only edit src/storefront.js and README.md in golden-web-repo. Keep renderCatalog() behavior.",
            sourcesGuidance: "Mirror the findItem surface added in step_1.",
            doneCriteria: "renderItemDetail(sku) is exported and the README contract table references findItem()."
          }
        }
      ],
      notes: "Deterministic QA complex-flow fixture plan (cross-repo, dependency-ordered)."
    })
  );
  process.exit(0);
}

// ---- Execution phase --------------------------------------------------------
function emitChange(file, relPath, contents) {
  fs.writeFileSync(file, contents, "utf8");
  console.log(`Updated ${relPath} in ${cwd}`);
  console.log("```" + relPath);
  console.log(contents.trimEnd());
  console.log("```");
}

if (fs.existsSync(inventoryPath)) {
  // golden-api-repo: add findItem(sku) + README note.
  const source = fs.readFileSync(inventoryPath, "utf8");
  const updated = source.replace(
    /export function listItems\(\) \{\n  return items;\n\}\n?/,
    `export function listItems() {
  return items;
}

export function findItem(sku) {
  return items.find((item) => item.sku === sku);
}
`
  );
  emitChange(inventoryPath, "src/inventory.js", updated);

  const readmePath = path.join(cwd, "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  const updatedReadme = `${readme.trim()}
- \`findItem(sku)\` — returns the matching item or \`undefined\`.
`;
  emitChange(readmePath, "README.md", updatedReadme);
  process.exit(0);
}

// golden-web-repo: add renderItemDetail(sku) consuming the findItem contract + README table.
const storefront = fs.readFileSync(storefrontPath, "utf8");
const updatedStorefront = storefront.replace(
  /export function renderCatalog\(\) \{\n  return catalog\.map\(\(item\) => `\$\{item\.sku\}: \$\{item\.label\}`\);\n\}\n?/,
  `export function renderCatalog() {
  return catalog.map((item) => \`\${item.sku}: \${item.label}\`);
}

// Mirrors findItem(sku) from golden-api-repo's inventory contract.
export function renderItemDetail(sku) {
  const item = catalog.find((entry) => entry.sku === sku);
  return item ? \`\${item.sku}: \${item.label}\` : "not found";
}
`
);
emitChange(storefrontPath, "src/storefront.js", updatedStorefront);

const webReadmePath = path.join(cwd, "README.md");
const webReadme = fs.readFileSync(webReadmePath, "utf8");
const updatedWebReadme = webReadme.replace(
  "| `listItems()` | `renderCatalog()` |",
  "| `listItems()` | `renderCatalog()` |\n| `findItem(sku)` | `renderItemDetail(sku)` |"
);
emitChange(webReadmePath, "README.md", updatedWebReadme);
process.exit(0);
