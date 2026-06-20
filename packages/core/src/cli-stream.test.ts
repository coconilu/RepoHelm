import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliStreamLine, runStreamingCli } from "./cli-stream.js";

const AGENT = "Codex CLI";

describe("parseCliStreamLine", () => {
  it("maps a Claude Code assistant text block to an agent.message event", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Updating the router config." }] }
    });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.message");
    expect(event!.detail).toContain("Updating the router config.");
    expect(event!.agent).toBe(AGENT);
    expect(event).toMatchObject({ phase: "execute", visibility: "process", severity: "info" });
  });

  it("maps a Claude Code tool_use block to an agent.tool_call event with the tool name", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } }]
      }
    });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.tool_call");
    expect(event!.title).toContain("Bash");
    expect(event!.detail).toContain("pnpm test");
    expect(event).toMatchObject({ phase: "execute", visibility: "audit", severity: "info" });
  });

  it("maps a Claude Code success result to an agent.completed event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Done. All tests pass."
    });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.completed");
    expect(event!.detail).toContain("Done. All tests pass.");
    expect(event).toMatchObject({ phase: "execute", visibility: "milestone", severity: "success" });
  });

  it("treats a plain (non-JSON) text line as agent.output", () => {
    const event = parseCliStreamLine("Refactoring complete.", AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.output");
    expect(event!.detail).toContain("Refactoring complete.");
    expect(event).toMatchObject({ phase: "audit", visibility: "audit", severity: "info" });
  });

  it("ignores blank lines", () => {
    expect(parseCliStreamLine("   ", AGENT)).toBeUndefined();
    expect(parseCliStreamLine("", AGENT)).toBeUndefined();
  });

  it("falls back to agent.output for malformed JSON instead of throwing", () => {
    const event = parseCliStreamLine("{not valid json", AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.output");
  });

  it("ignores system/init noise lines", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "abc" });
    expect(parseCliStreamLine(line, AGENT)).toBeUndefined();
  });

  it("preserves an unrecognized JSON object as agent.output (e.g. a plan/result payload)", () => {
    // Print-mode CLIs often emit their whole answer as a single JSON line that is
    // not a streaming envelope. It must reach `content`, not be dropped as noise.
    const line = JSON.stringify({ summary: "plan", steps: [{ id: "s1" }] });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.output");
    expect(event!.detail).toContain("\"summary\":\"plan\"");
  });
});

describe("parseCliStreamLine (Codex exec --json)", () => {
  it("maps a Codex agent_message item to an agent.message event", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: "Creating the router config." }
    });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.message");
    expect(event!.detail).toContain("Creating the router config.");
  });

  it("maps a Codex file_change item to an agent.file_change event listing path and kind", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_1",
        type: "file_change",
        status: "completed",
        changes: [
          { path: "/work/src/hello.txt", kind: "add" },
          { path: "/work/src/router.ts", kind: "update" }
        ]
      }
    });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.file_change");
    expect(event!.detail).toContain("hello.txt");
    expect(event!.detail).toContain("add");
    expect(event!.detail).toContain("router.ts");
    expect(event!.detail).toContain("update");
    expect(event).toMatchObject({ phase: "execute", visibility: "process", severity: "success" });
  });

  it("maps a Codex command_execution item to an agent.command event with command, exit code and output", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_2",
        type: "command_execution",
        command: "/bin/zsh -lc 'pnpm test'",
        aggregated_output: "2 passed\n",
        exit_code: 0,
        status: "completed"
      }
    });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.command");
    expect(event!.detail).toContain("pnpm test");
    expect(event!.detail).toContain("2 passed");
    expect(event!.title).toContain("0"); // exit code surfaced
    expect(event).toMatchObject({ phase: "validate", visibility: "audit", severity: "info" });
  });

  it("keeps the TAIL of a long command output so trailing failure messages survive truncation", () => {
    // Test/build failures put the decisive error at the END of the output, and the
    // orchestrator feeds recent event `detail` to the lead's recovery decision —
    // so a head-only truncation would hide the real failure cause.
    const noise = "x".repeat(4000);
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_9",
        type: "command_execution",
        command: "pnpm test",
        aggregated_output: `${noise}\nFAIL src/foo.test.ts\nAssertionError: expected 1 to be 2`,
        exit_code: 1,
        status: "completed"
      }
    });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.command");
    // The trailing failure must be present.
    expect(event!.detail).toContain("AssertionError: expected 1 to be 2");
    expect(event!.detail).toContain("FAIL src/foo.test.ts");
    // The command itself stays visible.
    expect(event!.detail).toContain("pnpm test");
    // Truncation actually happened (an elision marker), so we did not dump 4KB.
    expect(event!.detail).toContain("省略");
    expect(event!.detail.length).toBeLessThan(1500);
    expect(event).toMatchObject({ phase: "validate", visibility: "process", severity: "error" });
  });

  it("maps a Codex mcp_tool_call item to an agent.tool_call event", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "item_3", type: "mcp_tool_call", name: "search_docs", arguments: { query: "router" } }
    });
    const event = parseCliStreamLine(line, AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.tool_call");
    expect(event!.title).toContain("search_docs");
    expect(event!.detail).toContain("router");
  });

  it("ignores Codex item.started (only completed items surface, to avoid duplicates)", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { id: "item_2", type: "command_execution", command: "cat x", aggregated_output: "", exit_code: null }
    });
    expect(parseCliStreamLine(line, AGENT)).toBeUndefined();
  });

  it("ignores Codex thread/turn lifecycle noise without usage", () => {
    expect(parseCliStreamLine(JSON.stringify({ type: "thread.started", thread_id: "x" }), AGENT)).toBeUndefined();
    expect(parseCliStreamLine(JSON.stringify({ type: "turn.started" }), AGENT)).toBeUndefined();
    expect(parseCliStreamLine(JSON.stringify({ type: "turn.completed" }), AGENT)).toBeUndefined();
  });

  it("maps Codex turn.completed usage to an agent.usage event", () => {
    const event = parseCliStreamLine(
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 5 } }),
      AGENT
    );
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.usage");
    expect(event!.detail).toContain("promptTokens");
    expect(event!.detail).toContain("completionTokens");
    expect(event).toMatchObject({ phase: "audit", visibility: "audit", severity: "info" });
  });

  it("surfaces a Codex error/turn.failed as agent.output so the failure stays visible", () => {
    const event = parseCliStreamLine(JSON.stringify({ type: "error", message: "model overloaded" }), AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.output");
    expect(event!.detail).toContain("model overloaded");
    expect(event).toMatchObject({ phase: "execute", visibility: "process", severity: "error" });
  });
});

/** Write a tiny node script that emits the given stdout lines, then exits with `code`. */
async function writeFakeCli(lines: string[], code = 0): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rh-cli-stream-"));
  const file = join(dir, "fake-cli.mjs");
  const body =
    `const lines = ${JSON.stringify(lines)};\n` +
    `let i = 0;\n` +
    `const tick = () => {\n` +
    `  if (i < lines.length) { process.stdout.write(lines[i++] + "\\n"); setTimeout(tick, 5); }\n` +
    `  else { process.exit(${code}); }\n` +
    `};\n` +
    `tick();\n`;
  await writeFile(file, body, "utf8");
  return file;
}

describe("runStreamingCli", () => {
  it("streams NDJSON lines into ordered events and a final content", async () => {
    const cli = await writeFakeCli([
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Working on it" }] } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] }
      }),
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Finished" })
    ]);

    const result = await runStreamingCli({ command: process.execPath, args: [cli], agent: AGENT });

    expect(result.exitCode).toBe(0);
    expect(result.events.map((e) => e.type)).toEqual([
      "agent.message",
      "agent.tool_call",
      "agent.completed"
    ]);
    expect(result.content).toContain("Finished");
  });

  it("invokes onEvent incrementally as lines arrive", async () => {
    const cli = await writeFakeCli([
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "one" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "two" }] } })
    ]);

    const seen: string[] = [];
    const result = await runStreamingCli({
      command: process.execPath,
      args: [cli],
      agent: AGENT,
      onEvent: (event) => seen.push(event.detail)
    });

    expect(seen.length).toBe(2);
    expect(seen.length).toBe(result.events.length);
  });

  it("resolves with a non-zero exitCode instead of rejecting", async () => {
    const cli = await writeFakeCli(
      [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "partial" }] } })],
      3
    );

    const result = await runStreamingCli({ command: process.execPath, args: [cli], agent: AGENT });

    expect(result.exitCode).toBe(3);
    expect(result.events.length).toBe(1);
  });

  it("treats a plain-text CLI's stdout lines as agent.output events", async () => {
    const cli = await writeFakeCli(["Building project", "Tests passed"]);

    const result = await runStreamingCli({ command: process.execPath, args: [cli], agent: AGENT });

    expect(result.events.map((e) => e.type)).toEqual(["agent.output", "agent.output"]);
    expect(result.content).toContain("Tests passed");
  });

  it("captures stderr and uses it as fallback content on a stderr-only non-zero exit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rh-cli-stderr-"));
    const file = join(dir, "stderr-cli.mjs");
    await writeFile(
      file,
      "process.stderr.write('auth failed: invalid api key\\n');\nprocess.exit(2);\n",
      "utf8"
    );

    const result = await runStreamingCli({ command: process.execPath, args: [file], agent: AGENT });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("auth failed: invalid api key");
    // stdout produced nothing parseable; stderr must not be silently dropped.
    expect(result.content).toContain("auth failed: invalid api key");
  });
});
