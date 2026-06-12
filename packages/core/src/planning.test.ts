import { describe, expect, it } from "vitest";
import { generateOrchestrationPlan } from "./planning.js";
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
