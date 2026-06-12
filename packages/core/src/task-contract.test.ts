import { describe, expect, it } from "vitest";
import {
  resolveContract,
  renderContractSection,
  minimalContract,
  renderContractMarkdownLines,
  parseContractFromBlock
} from "./task-contract.js";
import type { OrchestrationPlanStep } from "./types.js";

function step(overrides: Partial<OrchestrationPlanStep> = {}): OrchestrationPlanStep {
  return {
    id: "step_1",
    description: "Implement feature A",
    agentId: "coder",
    agentName: "Coder",
    dependencies: [],
    expectedOutput: "Source code for A",
    ...overrides
  };
}

describe("resolveContract", () => {
  it("falls back to expectedOutput when no contract", () => {
    const r = resolveContract(step());
    expect(r.objective).toBe("Implement feature A");
    expect(r.outputFormat).toBe("Source code for A");
    expect(r.boundaries).toBeUndefined();
    expect(r.doneCriteria).toBeUndefined();
  });

  it("uses contract fields when present", () => {
    const r = resolveContract(
      step({
        contract: {
          outputFormat: "A diff",
          boundaries: "Do not touch auth",
          sourcesGuidance: "See README",
          doneCriteria: "Tests pass"
        }
      })
    );
    expect(r.outputFormat).toBe("A diff");
    expect(r.boundaries).toBe("Do not touch auth");
    expect(r.sourcesGuidance).toBe("See README");
    expect(r.doneCriteria).toBe("Tests pass");
  });

  it("treats blank contract strings as absent", () => {
    const r = resolveContract(step({ contract: { boundaries: "   ", doneCriteria: "" } }));
    expect(r.boundaries).toBeUndefined();
    expect(r.doneCriteria).toBeUndefined();
    expect(r.outputFormat).toBe("Source code for A");
  });
});

describe("renderContractSection", () => {
  it("omits absent fields and the upstream section when no deps", () => {
    const out = renderContractSection(resolveContract(step()), []);
    expect(out).toContain("## Task Contract");
    expect(out).toContain("- Objective: Implement feature A");
    expect(out).toContain("- Expected output: Source code for A");
    expect(out).not.toContain("- Boundaries:");
    expect(out).not.toContain("## Upstream results");
  });

  it("renders present fields and upstream results", () => {
    const out = renderContractSection(
      resolveContract(step({ contract: { boundaries: "No auth", doneCriteria: "Green tests" } })),
      [
        { stepId: "step_0", result: "did setup" },
        { stepId: "step_x", result: "" }
      ]
    );
    expect(out).toContain("- Boundaries: No auth");
    expect(out).toContain("- Done when: Green tests");
    expect(out).toContain("## Upstream results");
    expect(out).toContain("- step_0: did setup");
    expect(out).not.toContain("- step_x:");
  });
});

describe("minimalContract", () => {
  it("uses expectedOutput as done criteria", () => {
    expect(minimalContract("Implementation artifacts")).toEqual({
      doneCriteria: "Implementation artifacts"
    });
  });
});

describe("plan.md contract block round-trip", () => {
  it("renders only present fields and parses them back", () => {
    const lines = renderContractMarkdownLines(
      step({
        contract: {
          outputFormat: "A diff",
          boundaries: "No auth\nchanges",
          doneCriteria: "Tests pass"
        }
      })
    );
    const block = lines.join("\n");
    expect(block).toContain("- **Output Format**: A diff");
    expect(block).toContain("- **Boundaries**: No auth changes"); // newline collapsed
    expect(block).toContain("- **Done Criteria**: Tests pass");
    expect(block).not.toContain("Sources Guidance");

    const parsed = parseContractFromBlock(block);
    expect(parsed).toEqual({
      outputFormat: "A diff",
      boundaries: "No auth changes",
      doneCriteria: "Tests pass"
    });
  });

  it("returns no lines and undefined when contract is absent", () => {
    expect(renderContractMarkdownLines(step())).toEqual([]);
    expect(parseContractFromBlock("- **Agent**: Coder (`coder`)")).toBeUndefined();
  });
});
