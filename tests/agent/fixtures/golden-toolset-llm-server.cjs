#!/usr/bin/env node

// Fake OpenAI-compatible chat server for the `golden-toolset-flow` scenario.
//
// Two BYOK worker agents (researcher, implementer) point their ModelKit baseUrl
// here, so the REAL tool-calling loop (orchestrator.runWorkerWithFsTools) drives
// this server for each plan step. (callLlmWithModelKit ignores REPOHELM_FAKE_MODELS
// — only streaming spec generation honors it — so the worker hits a real endpoint;
// this is that endpoint.)
//
// It scripts a deterministic, per-repo tool sequence exercising issue #22 A–E:
//   golden-api-repo  (step_1, researcher):  write_todos(E) → search_files regex+glob(A)
//                                            → read_file png(D) → web_fetch /docs(B)
//                                            → write src/findings.md
//   golden-web-repo  (step_2, implementer): write_todos(E) → search_files(A)
//                                            → start_process "git status" + read_process(C)
//                                            → write src/summary.md
// Each worker writes a file echoing the REAL tool outputs, so the scenario asserts
// genuine tool behavior — on top of real plan-based orchestration (2 steps, a
// dependency, 2 target repos, 2 distinct worker agents).
//
// It also serves GET /docs as the web_fetch target (egress stays local, no SSRF).

const http = require("node:http");

const PORT = Number(process.env.REPOHELM_FAKE_LLM_PORT || process.argv[2] || 4399);
const DOCS_BODY = "CONTRACT_VERSION=v2-toolset\nlistItems() is the inventory read contract.\n";
const DOCS_URL = `http://127.0.0.1:${PORT}/docs`;

// Poll budget: a freshly spawned process may still be running on the first read,
// so we poll a few times within MAX_TOOL_LOOP_ITERATIONS (8).
const MAX_PROCESS_POLLS = 4;

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

// Which repo's worktree is this worker running in? Read it from the SYSTEM prompt,
// which embeds the worktree path (the dependency result in the user message may
// mention the other repo, so only the system message is authoritative).
function detectRepo(messages) {
  const system = messages.find((m) => m.role === "system");
  const text = (system && system.content) || "";
  if (text.includes("golden-web-repo")) return "web";
  if (text.includes("golden-api-repo")) return "api";
  return "api";
}

function collect(messages) {
  const out = { search: null, image: null, web: null, todos: null, startHandle: null, readProc: null, readCount: 0, wrote: null };
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
    } else if (obj.encoding === "base64") {
      out.image = { mediaType: obj.mediaType, bytes: obj.bytes };
    } else if (typeof obj.status === "number" && typeof obj.content === "string") {
      out.web = obj.content;
    } else if (Array.isArray(obj.todos)) {
      out.todos = obj.todos.length;
    } else if ("running" in obj) {
      out.readProc = { exitCode: obj.exitCode, running: obj.running };
      out.readCount += 1;
    } else if (typeof obj.path === "string" && obj.encoding === undefined && obj.bytes !== undefined) {
      out.wrote = obj.path; // fs write_file result
    } else if (obj.handle && obj.command) {
      out.startHandle = obj.handle;
    }
  }
  return out;
}

function countToolMessages(messages) {
  return messages.filter((m) => m.role === "tool").length;
}

function buildApiFindings(c) {
  const contractVersion = (c.web && (c.web.match(/CONTRACT_VERSION=(\S+)/) || [])[1]) || "unknown";
  return [
    "# API Contract Findings",
    "",
    "Researched by the BYOK worker using search_files (A), read_file (D) and web_fetch (B).",
    "",
    `search_hit=${c.search || "none"}`,
    `image_media_type=${c.image ? c.image.mediaType : "none"}`,
    `image_bytes=${c.image ? c.image.bytes : 0}`,
    `contract_version=${contractVersion}`,
    `todos=${c.todos == null ? 0 : c.todos}`,
    ""
  ].join("\n");
}

function buildWebSummary(c) {
  const procExit = c.readProc ? c.readProc.exitCode : "null";
  const procRunning = c.readProc ? c.readProc.running : "unknown";
  return [
    "# Storefront Summary",
    "",
    "Implemented by the BYOK worker using write_todos (E), start_process/read_process (C) and search_files (A).",
    "Built on step_1's findings (plan dependency).",
    "",
    `search_hit=${c.search || "none"}`,
    `todos=${c.todos == null ? 0 : c.todos}`,
    `process_started=${Boolean(c.startHandle)}`,
    `process_observed=${c.readProc != null}`,
    `process_exit=${procExit}`,
    `process_running=${procRunning}`,
    ""
  ].join("\n");
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url && req.url.startsWith("/docs")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(DOCS_BODY);
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
    const repo = detectRepo(messages);
    const n = countToolMessages(messages);
    const c = collect(messages);

    if (repo === "api") {
      // step_1 — researcher.
      if (n === 0) {
        reply(res, {
          role: "assistant",
          content: "Researching the inventory contract with the built-in tools.",
          tool_calls: [
            makeCall("write_todos", {
              todos: [
                { content: "locate listItems contract", status: "completed" },
                { content: "write findings", status: "in_progress" }
              ]
            }),
            makeCall("search_files", { query: "list\\w+", regex: true, filePattern: "**/*.js" }),
            makeCall("read_file", { path: "assets/logo.png" }),
            makeCall("web_fetch", { url: DOCS_URL })
          ]
        });
        return;
      }
      if (!c.wrote) {
        reply(res, {
          role: "assistant",
          content: "Writing src/findings.md from the collected tool outputs.",
          tool_calls: [makeCall("write_file", { path: "src/findings.md", content: buildApiFindings(c) })]
        });
        return;
      }
      reply(res, { role: "assistant", content: "Done. Wrote src/findings.md (search + image + web)." });
      return;
    }

    // repo === "web" — step_2 — implementer.
    if (n === 0) {
      reply(res, {
        role: "assistant",
        content: "Implementing the storefront summary with the built-in tools.",
        tool_calls: [
          makeCall("write_todos", {
            todos: [
              { content: "review api findings", status: "completed" },
              { content: "verify and summarize", status: "in_progress" }
            ]
          }),
          makeCall("search_files", { query: "render\\w+", regex: true, filePattern: "**/*.js" }),
          makeCall("start_process", { command: "git status" })
        ]
      });
      return;
    }
    if (!c.wrote) {
      const exited = c.readProc && c.readProc.running === false;
      if (!exited && c.readCount < MAX_PROCESS_POLLS) {
        reply(res, {
          role: "assistant",
          content: "Polling the verification process output.",
          tool_calls: [makeCall("read_process", { handle: c.startHandle || "proc-1" })]
        });
        return;
      }
      reply(res, {
        role: "assistant",
        content: "Writing src/summary.md from the collected tool outputs.",
        tool_calls: [makeCall("write_file", { path: "src/summary.md", content: buildWebSummary(c) })]
      });
      return;
    }
    reply(res, { role: "assistant", content: "Done. Wrote src/summary.md (todos + process + search)." });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[golden-toolset-llm-server] listening on http://127.0.0.1:${PORT}`);
});
