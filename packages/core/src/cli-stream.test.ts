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
  });

  it("treats a plain (non-JSON) text line as agent.output", () => {
    const event = parseCliStreamLine("Refactoring complete.", AGENT);
    expect(event).toBeDefined();
    expect(event!.type).toBe("agent.output");
    expect(event!.detail).toContain("Refactoring complete.");
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
});
