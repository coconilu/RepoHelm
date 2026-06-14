import { describe, expect, it } from "vitest";
import {
  buildLeadDecisionPrompt,
  parseLeadDecision,
  type LeadDecisionContext
} from "./lead-decision.js";

const pool = new Set(["coder", "reviewer"]);

function ctx(overrides: Partial<LeadDecisionContext> = {}): LeadDecisionContext {
  return {
    quest: { title: "Build feature", requirement: "Implement X then verify" },
    step: { id: "step_1", description: "Implement X", agentName: "Coder" },
    error: "Worker completed without required material output.",
    workerOutput: "I will inspect the project.",
    writtenFiles: [],
    attempt: 1,
    maxAttempts: 3,
    agentPool: [
      { id: "coder", name: "Coder", capabilities: ["coding"] },
      { id: "reviewer", name: "Reviewer", capabilities: ["review"] }
    ],
    ...overrides
  };
}

describe("parseLeadDecision", () => {
  it("parses a retry decision with reason", () => {
    const decision = parseLeadDecision('{"action":"retry","reason":"transient failure"}', pool);
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("transient failure");
  });

  it("parses a reassign decision when the target exists in the pool", () => {
    const decision = parseLeadDecision('{"action":"reassign","reassignTo":"reviewer"}', pool);
    expect(decision.action).toBe("reassign");
    expect(decision.reassignTo).toBe("reviewer");
  });

  it("downgrades reassign to skip when the target is not in the pool", () => {
    const decision = parseLeadDecision('{"action":"reassign","reassignTo":"ghost"}', pool);
    expect(decision.action).toBe("skip");
    expect(decision.reassignTo).toBeUndefined();
  });

  it("parses a revise decision carrying a revised description and feedback", () => {
    const decision = parseLeadDecision(
      '{"action":"revise","revisedDescription":"Implement X via the write_file tool","feedback":"You must create a file"}',
      pool
    );
    expect(decision.action).toBe("revise");
    expect(decision.revisedDescription).toBe("Implement X via the write_file tool");
    expect(decision.feedback).toBe("You must create a file");
  });

  it("parses an abort decision", () => {
    const decision = parseLeadDecision('{"action":"abort","reason":"unrecoverable"}', pool);
    expect(decision.action).toBe("abort");
  });

  it("extracts JSON embedded in surrounding prose", () => {
    const decision = parseLeadDecision(
      'Here is my call:\n```json\n{"action":"retry"}\n```\nGood luck.',
      pool
    );
    expect(decision.action).toBe("retry");
  });

  it("defaults to skip on unparseable content (safe default = current behavior)", () => {
    const decision = parseLeadDecision("I think we should probably just move on, sorry.", pool);
    expect(decision.action).toBe("skip");
  });

  it("defaults to skip on an unknown action verb", () => {
    const decision = parseLeadDecision('{"action":"teleport"}', pool);
    expect(decision.action).toBe("skip");
  });
});

describe("buildLeadDecisionPrompt", () => {
  it("includes the failure, attempt budget, and the reassignable agent pool", () => {
    const prompt = buildLeadDecisionPrompt(ctx());
    expect(prompt.system).toContain("retry");
    expect(prompt.system).toContain("reassign");
    expect(prompt.system).toContain("revise");
    expect(prompt.user).toContain("Worker completed without required material output.");
    expect(prompt.user).toContain("attempt 1 of 3");
    // Reassign candidates must be listed so the lead can pick a valid target id.
    expect(prompt.user).toContain("reviewer");
  });
});
