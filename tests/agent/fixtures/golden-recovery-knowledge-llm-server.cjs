#!/usr/bin/env node

// Fake OpenAI-compatible chat server for the `golden-recovery-knowledge-flow`
// scenario. It scripts a delegate-mode supervisor plus four BYOK workers:
// researcher, implementer, verifier, and knowledge curator.

const http = require("node:http");

const PORT = Number(process.env.REPOHELM_FAKE_LLM_PORT || process.argv[2] || 4397);

const VERIFIER_TASK =
  "Run the web repo validation and write a validation file reports/final-validation.md only when the check passes.";

let callId = 0;
let verifierRuns = 0;

function makeCall(name, args) {
  callId += 1;
  return { id: `call_${callId}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function reply(res, message) {
  const payload = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
    usage: { prompt_tokens: 0, completion_tokens: 0 }
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function systemText(messages) {
  const system = messages.find((m) => m.role === "system");
  return (system && system.content) || "";
}

function userText(messages) {
  const user = messages.find((m) => m.role === "user");
  return (user && user.content) || "";
}

function countToolMessages(messages) {
  return messages.filter((m) => m.role === "tool").length;
}

function toolPayloads(messages) {
  return messages
    .filter((m) => m.role === "tool" && typeof m.content === "string")
    .map((m) => {
      try {
        return JSON.parse(m.content);
      } catch {
        return {};
      }
    });
}

function findWorkerId(userPrompt, nameNeedle) {
  const re = /^- (\S+): (.+?) —/gm;
  let m;
  while ((m = re.exec(userPrompt)) !== null) {
    if (m[2].includes(nameNeedle)) return m[1];
  }
  return undefined;
}

function findProjectId(userPrompt, repoName) {
  const re = new RegExp(`^- (\\S+): ${repoName}\\b`, "m");
  const m = userPrompt.match(re);
  return m ? m[1] : undefined;
}

function handleEntry(res, messages) {
  const user = userText(messages);
  const researcher = findWorkerId(user, "Researcher");
  const implementer = findWorkerId(user, "Implementer");
  const verifier = findWorkerId(user, "Verifier");
  const curator = findWorkerId(user, "Knowledge Curator");
  const apiProject = findProjectId(user, "golden-api-repo");
  const webProject = findProjectId(user, "golden-web-repo");
  const docsProject = findProjectId(user, "golden-docs-repo");
  const n = countToolMessages(messages);

  if (n === 0) {
    return reply(res, {
      role: "assistant",
      content: "Delegating source and knowledge research.",
      tool_calls: [
        makeCall("delegate", {
          agentId: researcher,
          task: "Inspect and summarize the stale offer status knowledge and source contract. Return findings only.",
          context: { targetProjectId: apiProject }
        })
      ]
    });
  }
  if (n === 1) {
    return reply(res, {
      role: "assistant",
      content: "Delegating the API contract update.",
      tool_calls: [
        makeCall("delegate", {
          agentId: implementer,
          task: "Update the API offer status contract and run pnpm test.",
          context: { targetProjectId: apiProject }
        })
      ]
    });
  }
  if (n === 2) {
    return reply(res, {
      role: "assistant",
      content: "Delegating the first web implementation, intentionally exercising recovery.",
      tool_calls: [
        makeCall("delegate", {
          agentId: implementer,
          task: "First pass: update the web consumer for the offer status contract.",
          context: { targetProjectId: webProject }
        })
      ]
    });
  }
  if (n === 3) {
    return reply(res, {
      role: "assistant",
      content: "Delegating operator-facing notes and knowledge sync plan.",
      tool_calls: [
        makeCall("delegate", {
          agentId: curator,
          task: "Update operator release notes with the recovered offer status change.",
          context: { targetProjectId: docsProject }
        })
      ]
    });
  }
  if (n === 4) {
    return reply(res, {
      role: "assistant",
      content: "Delegating verification. A failed result must be preserved before repair.",
      tool_calls: [makeCall("delegate", { agentId: verifier, task: VERIFIER_TASK, context: { targetProjectId: webProject } })]
    });
  }
  if (n === 5) {
    return reply(res, {
      role: "assistant",
      content: "The verifier found the mismatch. Delegating a targeted repair.",
      tool_calls: [
        makeCall("delegate", {
          agentId: implementer,
          task: "Repair the web consumer so the offer status validation passes.",
          context: { targetProjectId: webProject }
        })
      ]
    });
  }
  if (n === 6) {
    return reply(res, {
      role: "assistant",
      content: "Rerunning only the affected web validation after repair.",
      tool_calls: [makeCall("delegate", { agentId: verifier, task: VERIFIER_TASK, context: { targetProjectId: webProject } })]
    });
  }
  return reply(res, {
    role: "assistant",
    content:
      "Recovery complete. QA Researcher inspected stale knowledge, QA Implementer updated API and web, QA Verifier preserved the failed validation then passed after repair, and QA Knowledge Curator updated release notes."
  });
}

function collect(messages) {
  const out = {
    search: null,
    read: {},
    shell: null,
    todos: 0,
    startHandle: null,
    readProc: null,
    readCount: 0,
    wrote: []
  };
  for (const obj of toolPayloads(messages)) {
    if (Array.isArray(obj.matches)) {
      const hit = obj.matches[0];
      if (hit) out.search = `${hit.file}:${hit.line}`;
    } else if (obj.path && typeof obj.content === "string") {
      out.read[obj.path] = obj.content;
    } else if (Array.isArray(obj.todos)) {
      out.todos = obj.todos.length;
    } else if (obj.handle && obj.command) {
      out.startHandle = obj.handle;
    } else if (obj.handle && "running" in obj) {
      out.readProc = obj;
      out.readCount += 1;
    } else if (obj.command && "exitCode" in obj && "stdout" in obj) {
      out.shell = obj;
    } else if (typeof obj.path === "string" && obj.bytes !== undefined) {
      out.wrote.push(obj.path);
    }
  }
  return out;
}

function apiInventory() {
  return `export const items = [
  {
    sku: "map-kit",
    name: "Map onboarding kit",
    stock: 12,
    offerStatus: "available"
  },
  {
    sku: "release-notes",
    name: "Release notes bundle",
    stock: 3,
    offerStatus: "limited"
  }
];

export function listItems() {
  return items;
}

export function getOfferStatus(sku) {
  const item = items.find((entry) => entry.sku === sku);
  return item ? item.offerStatus : "unknown";
}
`;
}

function brokenStorefront() {
  return `// The web storefront consumes the inventory contract owned by golden-api-repo.
const catalog = [
  { sku: "map-kit", label: "Map onboarding kit", offerStatus: "available" },
  { sku: "release-notes", label: "Release notes bundle", offerStatus: "limited" }
];

export function renderCatalog() {
  return catalog.map((item) => \`\${item.sku}: \${item.label}\`);
}

export function renderOfferStatus(sku) {
  const item = catalog.find((entry) => entry.sku === sku);
  return item ? \`\${sku}: \${item.offerState}\` : \`\${sku}: unknown\`;
}

throw new Error("contract mismatch: web expects offerState instead of offerStatus");
`;
}

function repairedStorefront() {
  return `// The web storefront consumes the inventory contract owned by golden-api-repo.
const catalog = [
  { sku: "map-kit", label: "Map onboarding kit", offerStatus: "available" },
  { sku: "release-notes", label: "Release notes bundle", offerStatus: "limited" }
];

export function renderCatalog() {
  return catalog.map((item) => \`\${item.sku}: \${item.label}\`);
}

export function renderOfferStatus(sku) {
  const item = catalog.find((entry) => entry.sku === sku);
  return item ? \`\${sku}: \${item.offerStatus}\` : \`\${sku}: unknown\`;
}
`;
}

function releaseNotes() {
  return `# Release Notes

## Offer status recovery

- API now exposes an offer status contract through getOfferStatus(sku).
- Web now renders offer status from the same contract shape.
- The first web validation failed and was repaired before delivery readiness.
- knowledge_sync=required
`;
}

function finalValidation(c) {
  const stdout = c.shell && c.shell.stdout ? c.shell.stdout.trim() : "";
  return `# Final Validation

status=passed
command=pnpm test
stdout=${stdout || "ok"}
recovered_failure=true
`;
}

function handleResearcher(res, messages) {
  const n = countToolMessages(messages);
  const c = collect(messages);
  if (n === 0) {
    return reply(res, {
      role: "assistant",
      content: "Searching the source contract.",
      tool_calls: [makeCall("search_files", { query: "listItems|offer", regex: true, filePattern: "**/*.js" })]
    });
  }
  return reply(res, {
    role: "assistant",
    content: `Research findings: stale_knowledge_checked=true; search_hit=${c.search || "none"}; recommended_contract=getOfferStatus(sku).`
  });
}

function handleImplementer(res, messages) {
  const n = countToolMessages(messages);
  const user = userText(messages);
  const sys = systemText(messages);
  const c = collect(messages);
  const isApi = sys.includes("golden-api-repo");
  const isRepair = /Repair the web consumer/i.test(user);

  if (n === 0) {
    return reply(res, {
      role: "assistant",
      content: "Reading current code and setting todos.",
      tool_calls: [
        makeCall("write_todos", {
          todos: [
            { content: "read current implementation", status: "completed" },
            { content: "write contract update", status: "in_progress" }
          ]
        }),
        makeCall("read_file", { path: isApi ? "src/inventory.js" : "src/storefront.js" })
      ]
    });
  }

  if (!c.wrote.length) {
    if (isApi) {
      return reply(res, {
        role: "assistant",
        content: "Writing API contract and running tests.",
        tool_calls: [
          makeCall("write_file", { path: "src/inventory.js", content: apiInventory() }),
          makeCall("run_command", { command: "pnpm test" })
        ]
      });
    }
    return reply(res, {
      role: "assistant",
      content: isRepair ? "Repairing the web consumer." : "Writing first web pass with a contract mismatch.",
      tool_calls: [
        makeCall("write_file", {
          path: "src/storefront.js",
          content: isRepair ? repairedStorefront() : brokenStorefront()
        })
      ]
    });
  }

  const shellNote = c.shell ? ` api_test_exit=${c.shell.exitCode}` : "";
  return reply(res, {
    role: "assistant",
    content: isApi
      ? `API contract updated.${shellNote}`
      : isRepair
        ? "Repair summary: web consumer now reads offerStatus and validation can pass."
        : "First web pass complete; verifier should catch the mismatch."
  });
}

function handleCurator(res, messages) {
  const c = collect(messages);
  if (!c.wrote.length) {
    return reply(res, {
      role: "assistant",
      content: "Writing release notes with recovery context.",
      tool_calls: [makeCall("write_file", { path: "docs/release-notes.md", content: releaseNotes() })]
    });
  }
  return reply(res, { role: "assistant", content: "Knowledge curator updated release notes and marked knowledge_sync=required." });
}

function handleVerifier(res, messages) {
  const n = countToolMessages(messages);
  const c = collect(messages);
  if (n === 0) {
    verifierRuns += 1;
    return reply(res, {
      role: "assistant",
      content: "Starting verifier process probe.",
      tool_calls: [
        makeCall("write_todos", {
          todos: [
            { content: "run web validation", status: "in_progress" },
            { content: "write final validation only after pass", status: "pending" }
          ]
        }),
        makeCall("start_process", { command: "git status" })
      ]
    });
  }
  if (n === 2) {
    return reply(res, {
      role: "assistant",
      content: "Reading verifier process probe.",
      tool_calls: [makeCall("read_process", { handle: c.startHandle || "proc-1" })]
    });
  }
  if (!c.shell) {
    return reply(res, {
      role: "assistant",
      content: "Running blocking web validation.",
      tool_calls: [makeCall("run_command", { command: "pnpm test" })]
    });
  }
  if (verifierRuns === 1 || c.shell.ok === false) {
    return reply(res, {
      role: "assistant",
      content: `VALIDATION_FAILED preserved=true command=pnpm test exit=${c.shell.exitCode} stderr=${(c.shell.stderr || "").slice(0, 120)}`
    });
  }
  if (!c.wrote.length) {
    return reply(res, {
      role: "assistant",
      content: "Validation passed; writing final validation report.",
      tool_calls: [makeCall("write_file", { path: "reports/final-validation.md", content: finalValidation(c) })]
    });
  }
  return reply(res, { role: "assistant", content: "VALIDATION_PASSED recovered_failure=true reran_only=web" });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let messages = [];
    try {
      messages = JSON.parse(body).messages || [];
    } catch {
      messages = [];
    }
    const sys = systemText(messages);
    if (sys.includes("DELEGATE mode")) return handleEntry(res, messages);
    if (sys.includes("QA Researcher")) return handleResearcher(res, messages);
    if (sys.includes("QA Verifier")) return handleVerifier(res, messages);
    if (sys.includes("QA Knowledge Curator")) return handleCurator(res, messages);
    return handleImplementer(res, messages);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[golden-recovery-knowledge-llm-server] listening on http://127.0.0.1:${PORT}`);
});
