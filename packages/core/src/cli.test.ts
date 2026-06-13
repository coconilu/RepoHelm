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
});
