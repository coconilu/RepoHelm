import { describe, expect, it } from "vitest";
import { generateOrchestrationPlan, selectExecutionMode } from "./planning.js";
import type { SubAgentBackend, SubAgentBackendResult } from "./orchestrator.js";
import type { Quest, SubAgent } from "./types.js";

function stubBackend(content: string): SubAgentBackend {
  return {
    async run(): Promise<SubAgentBackendResult> {
      return { content, toolCalls: [], finishReason: "stop", events: [] };
    }
  };
}

function fakeQuest(): Quest {
  return {
    id: "quest_1",
    title: "Add feature",
    requirement: "Add feature A to project",
    affectedProjectIds: ["proj_1"],
    worktrees: []
  } as unknown as Quest;
}

function fakeAgent(id: string): SubAgent {
  return { id, name: id, role: "worker", capabilities: ["coding"] } as unknown as SubAgent;
}

const entry = { id: "entry", name: "Supervisor", role: "supervisor" } as unknown as SubAgent;

describe("selectExecutionMode", () => {
  // A complex, open-ended, multi-project quest: no explicit step keywords, two
  // affected projects, long requirement. This is the shape that SHOULD reach the
  // adaptive delegate path when an eligible BYOK entry + ≥2 workers are present.
  function complexQuest(): Quest {
    return {
      id: "q",
      title: "Cross-repo refactor",
      requirement:
        "Improve the contract handling across the API and web repos so that the offer flow " +
        "is consistent. Investigate the current behavior, decide what needs to change and apply it.",
      affectedProjectIds: ["api", "web"],
      worktrees: []
    } as unknown as Quest;
  }

  it("chooses delegate for a complex open-ended quest with a BYOK entry and ≥2 workers", () => {
    const mode = selectExecutionMode({
      quest: complexQuest(),
      delegatableAgentCount: 2,
      entryModelKitType: "byok"
    });
    expect(mode).toBe("delegate");
  });

  it("falls back to plan when the entry ModelKit is a CLI (can't drive the tool loop)", () => {
    const mode = selectExecutionMode({
      quest: complexQuest(),
      delegatableAgentCount: 2,
      entryModelKitType: "cli"
    });
    expect(mode).toBe("plan");
  });

  it("falls back to plan when there are fewer than 2 delegatable workers", () => {
    const mode = selectExecutionMode({
      quest: complexQuest(),
      delegatableAgentCount: 1,
      entryModelKitType: "byok"
    });
    expect(mode).toBe("plan");
  });

  it("chooses plan for a simple single-project quest", () => {
    const simple = {
      id: "q",
      title: "Tweak",
      requirement: "Fix typo",
      affectedProjectIds: ["api"],
      worktrees: []
    } as unknown as Quest;
    const mode = selectExecutionMode({
      quest: simple,
      delegatableAgentCount: 3,
      entryModelKitType: "byok"
    });
    expect(mode).toBe("plan");
  });

  it("chooses plan when the requirement already spells out ordered steps (auditable static DAG)", () => {
    const stepped = {
      ...complexQuest(),
      requirement:
        "首先在 API 仓库实现契约校验,然后在 web 仓库接入校验结果,最后补充端到端测试覆盖整个流程。"
    } as unknown as Quest;
    const mode = selectExecutionMode({
      quest: stepped,
      delegatableAgentCount: 2,
      entryModelKitType: "byok"
    });
    expect(mode).toBe("plan");
  });

  it("falls back to plan when the entry ModelKit type is unknown", () => {
    const mode = selectExecutionMode({
      quest: complexQuest(),
      delegatableAgentCount: 2,
      entryModelKitType: undefined
    });
    expect(mode).toBe("plan");
  });
});

describe("generateOrchestrationPlan contract", () => {
  it("parses contract fields from planner JSON", async () => {
    const json = JSON.stringify({
      summary: "Plan",
      steps: [
        {
          id: "step_1",
          description: "Build A",
          agentId: "coder",
          agentName: "coder",
          dependencies: [],
          expectedOutput: "Code",
          targetProjectId: "proj_1",
          contract: {
            boundaries: "No auth",
            sourcesGuidance: "See docs",
            doneCriteria: "Tests pass"
          }
        }
      ],
      notes: ""
    });
    const plan = await generateOrchestrationPlan({
      entryAgent: entry,
      quest: fakeQuest(),
      agentPool: [fakeAgent("coder")],
      backend: stubBackend(json)
    });
    expect(plan.steps[0]!.contract).toEqual({
      boundaries: "No auth",
      sourcesGuidance: "See docs",
      doneCriteria: "Tests pass"
    });
  });

  it("drops non-string contract fields", async () => {
    const json = JSON.stringify({
      summary: "Plan",
      steps: [
        {
          id: "step_1",
          description: "Build A",
          agentId: "coder",
          agentName: "coder",
          dependencies: [],
          expectedOutput: "Code",
          contract: { boundaries: 42, doneCriteria: "ok" }
        }
      ]
    });
    const plan = await generateOrchestrationPlan({
      entryAgent: entry,
      quest: fakeQuest(),
      agentPool: [fakeAgent("coder")],
      backend: stubBackend(json)
    });
    expect(plan.steps[0]!.contract).toEqual({ doneCriteria: "ok" });
  });

  it("fills a minimal contract on the non-JSON fallback step", async () => {
    const plan = await generateOrchestrationPlan({
      entryAgent: entry,
      quest: fakeQuest(),
      agentPool: [fakeAgent("coder")],
      backend: stubBackend("sorry, I cannot produce JSON")
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.contract).toEqual({
      doneCriteria: "Implementation code and artifacts"
    });
  });
});
