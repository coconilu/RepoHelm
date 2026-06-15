#!/usr/bin/env node

// Fake OpenAI-compatible chat server for the `golden-delegation-flow` scenario.
//
// Unlike the toolset flow (CLI entry + static plan), here the ENTRY/supervisor is
// a BYOK agent that drives the REAL delegate loop (orchestrator.executeDelegated →
// delegation.runDelegationLoop). This one server answers THREE distinct callers,
// told apart by their system prompt:
//
//   1. ENTRY (system contains "DELEGATE mode"): the supervisor's delegation loop.
//      It reads the valid worker agentIds + project ids straight out of the user
//      prompt (buildDelegationPrompt lists them), then emits, turn by turn:
//        turn 1: delegate(<researcher>, …, {targetProjectId: <api project>})
//        turn 2: delegate(<implementer>, …, {targetProjectId: <web project>})
//        turn 3: a plain-text summary (no tools) → loop ends.
//      => the supervisor dynamically picks 2 DIFFERENT workers at runtime.
//
//   2. api-repo WORKER (researcher): search_files(A) → write src/findings.md.
//   3. web-repo WORKER (implementer): write_todos(E) + search_files(A) → write src/summary.md.
//
// Each worker writes a file echoing its REAL tool outputs, so the scenario proves
// genuine worker execution on top of runtime-decided (not pre-planned) delegation.

const http = require("node:http");

const PORT = Number(process.env.REPOHELM_FAKE_LLM_PORT || process.argv[2] || 4398);

let callId = 0;
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

// --- ENTRY (delegate loop) helpers ---------------------------------------------

// Pull "- <id>: <name> — …" worker lines out of the delegation user prompt.
function findWorkerId(userPrompt, nameNeedle) {
  const re = /^- (\S+): (.+?) —/gm;
  let m;
  while ((m = re.exec(userPrompt)) !== null) {
    if (m[2].includes(nameNeedle)) return m[1];
  }
  return undefined;
}

// Pull the project id whose listed name matches the repo dir, from the
// "## Affected Projects" section ("- <projId>: <projName>").
function findProjectId(userPrompt, repoName) {
  const re = new RegExp(`^- (\\S+): ${repoName}\\b`, "m");
  const m = userPrompt.match(re);
  return m ? m[1] : undefined;
}

function handleEntry(res, messages) {
  const user = userText(messages);
  const researcher = findWorkerId(user, "Researcher");
  const implementer = findWorkerId(user, "Implementer");
  const apiProject = findProjectId(user, "golden-api-repo");
  const webProject = findProjectId(user, "golden-web-repo");
  const n = countToolMessages(messages);

  if (n === 0 && researcher) {
    reply(res, {
      role: "assistant",
      content: "Delegating the contract research to the researcher first.",
      tool_calls: [
        makeCall("delegate", {
          agentId: researcher,
          task: "Research the offer/listItems contract in the api repo and write src/findings.md.",
          context: { targetProjectId: apiProject }
        })
      ]
    });
    return;
  }
  if (n === 1 && implementer) {
    reply(res, {
      role: "assistant",
      content: "Research is in; delegating implementation/verification to the implementer.",
      tool_calls: [
        makeCall("delegate", {
          agentId: implementer,
          task: "Implement and verify the storefront summary in the web repo and write src/summary.md.",
          context: { targetProjectId: webProject }
        })
      ]
    });
    return;
  }
  reply(res, {
    role: "assistant",
    content:
      "Delegated research to QA Researcher (api) and implementation to QA Implementer (web); both completed."
  });
}

// --- WORKER helpers ------------------------------------------------------------

function collect(messages) {
  const out = { search: null, todos: null, wrote: null };
  for (const m of messages) {
    if (m.role !== "tool" || typeof m.content !== "string") continue;
    let obj;
    try {
      obj = JSON.parse(m.content);
    } catch {
      continue;
    }
    if (Array.isArray(obj.matches)) {
      const hit = obj.matches[0];
      if (hit) out.search = `${hit.file}:${hit.line}`;
    } else if (Array.isArray(obj.todos)) {
      out.todos = obj.todos.length;
    } else if (typeof obj.path === "string" && obj.encoding === undefined && obj.bytes !== undefined) {
      out.wrote = obj.path;
    }
  }
  return out;
}

function buildApiFindings(c) {
  return [
    "# API Contract Findings",
    "",
    "Researched by the delegated BYOK worker (chosen at runtime by the supervisor).",
    "",
    `search_hit=${c.search || "none"}`,
    ""
  ].join("\n");
}

function buildWebSummary(c) {
  return [
    "# Storefront Summary",
    "",
    "Implemented by the delegated BYOK worker (chosen at runtime by the supervisor).",
    "",
    `search_hit=${c.search || "none"}`,
    `todos=${c.todos == null ? 0 : c.todos}`,
    ""
  ].join("\n");
}

function handleApiWorker(res, messages) {
  const n = countToolMessages(messages);
  const c = collect(messages);
  if (n === 0) {
    reply(res, {
      role: "assistant",
      content: "Researching the inventory contract.",
      tool_calls: [makeCall("search_files", { query: "list\\w+", regex: true, filePattern: "**/*.js" })]
    });
    return;
  }
  if (!c.wrote) {
    reply(res, {
      role: "assistant",
      content: "Writing src/findings.md.",
      tool_calls: [makeCall("write_file", { path: "src/findings.md", content: buildApiFindings(c) })]
    });
    return;
  }
  reply(res, { role: "assistant", content: "Done. Wrote src/findings.md." });
}

function handleWebWorker(res, messages) {
  const n = countToolMessages(messages);
  const c = collect(messages);
  if (n === 0) {
    reply(res, {
      role: "assistant",
      content: "Implementing the storefront summary.",
      tool_calls: [
        makeCall("write_todos", {
          todos: [
            { content: "review api findings", status: "completed" },
            { content: "summarize storefront", status: "in_progress" }
          ]
        }),
        makeCall("search_files", { query: "render\\w+", regex: true, filePattern: "**/*.js" })
      ]
    });
    return;
  }
  if (!c.wrote) {
    reply(res, {
      role: "assistant",
      content: "Writing src/summary.md.",
      tool_calls: [makeCall("write_file", { path: "src/summary.md", content: buildWebSummary(c) })]
    });
    return;
  }
  reply(res, { role: "assistant", content: "Done. Wrote src/summary.md." });
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
    if (sys.includes("DELEGATE mode")) {
      handleEntry(res, messages);
    } else if (sys.includes("golden-web-repo")) {
      handleWebWorker(res, messages);
    } else {
      handleApiWorker(res, messages);
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[golden-delegation-llm-server] listening on http://127.0.0.1:${PORT}`);
});
