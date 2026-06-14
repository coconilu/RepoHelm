import { describe, expect, it } from "vitest";
import { CLI_DEFINITIONS } from "./cli.js";

describe("CLI definitions", () => {
  it("claude-code exec requests stream-json so timeline events can be parsed", () => {
    const claude = CLI_DEFINITIONS.find((def) => def.id === "claude-code");
    expect(claude?.exec).toBeDefined();

    const args = claude!.exec!.build("do the thing", "sonnet");

    // Claude Code's -p mode requires --verbose alongside stream-json output.
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    // Still auto-accepts edits so the agent can write into the worktree.
    expect(args).toContain("acceptEdits");
  });

  it("codex-cli exec requests JSONL events and write access so its structured items can be streamed", () => {
    const codex = CLI_DEFINITIONS.find((def) => def.id === "codex-cli");
    expect(codex?.exec).toBeDefined();

    const args = codex!.exec!.build("do the thing", "gpt-5.1-codex");

    // `codex exec` is the non-interactive entry; `--json` makes it emit JSONL events.
    expect(args[0]).toBe("exec");
    expect(args).toContain("--json");
    // workspace-write sandbox so the agent can edit files in the worktree.
    expect(args).toContain("--sandbox");
    expect(args).toContain("workspace-write");
    // The prompt and model must both be passed through.
    expect(args).toContain("do the thing");
    expect(args).toContain("gpt-5.1-codex");
  });

  it("codex-cli exec works without an explicit model", () => {
    const codex = CLI_DEFINITIONS.find((def) => def.id === "codex-cli");
    const args = codex!.exec!.build("do the thing");
    expect(args[0]).toBe("exec");
    expect(args).toContain("--json");
    expect(args).toContain("do the thing");
  });
});
