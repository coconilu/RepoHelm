import { describe, expect, it, vi } from "vitest";
import { buildDelegationPrompt, runDelegationLoop, type DelegationCallResult } from "./delegation.js";
import type { LlmToolCall } from "./llm.js";
import { DELEGATE_TOOL_NAME } from "./tools/delegate.js";

function delegateCall(id: string, agentId: string, task: string): LlmToolCall {
  return {
    id,
    type: "function",
    function: { name: DELEGATE_TOOL_NAME, arguments: JSON.stringify({ agentId, task }) }
  } as unknown as LlmToolCall;
}

describe("runDelegationLoop", () => {
  it("routes a delegate tool call to onDelegate and captures the final message", async () => {
    const onDelegate = vi.fn(async () => JSON.stringify({ ok: true, agentName: "Worker A", result: { content: "done" } }));
    let turn = 0;
    const callModel = vi.fn(async (): Promise<DelegationCallResult> => {
      turn += 1;
      if (turn === 1) {
        return { content: "", toolCalls: [delegateCall("c1", "worker_a", "do A")] };
      }
      return { content: "All delegated and summarized.", toolCalls: [] };
    });

    const result = await runDelegationLoop("sys", "user", {
      callModel,
      onDelegate,
      maxIterations: 8,
      agentName: "Supervisor"
    });

    expect(onDelegate).toHaveBeenCalledTimes(1);
    expect(onDelegate).toHaveBeenCalledWith({ agentId: "worker_a", task: "do A" });
    expect(result.finalContent).toBe("All delegated and summarized.");
    expect(result.iterations).toBe(1);
    // The tool result must be threaded back to the model on the next turn.
    const secondCallMessages = callModel.mock.calls[1]![0];
    expect(secondCallMessages.some((m) => m.role === "tool")).toBe(true);
    const toolCallEvent = result.events.find((e) => e.type === "agent.tool_call");
    expect(toolCallEvent).toMatchObject({
      collaboration: {
        kind: "delegate",
        evidence: "actual",
        sourceAgentName: "Supervisor",
        targetAgentId: "worker_a",
        targetAgentName: "Worker A"
      }
    });
  });

  it("delegates to two distinct workers across turns", async () => {
    const seen: string[] = [];
    const onDelegate = vi.fn(async (input: { agentId: string }) => {
      seen.push(input.agentId);
      return JSON.stringify({ ok: true, result: { content: "ok" } });
    });
    let turn = 0;
    const callModel = async (): Promise<DelegationCallResult> => {
      turn += 1;
      if (turn === 1) return { content: "", toolCalls: [delegateCall("c1", "worker_a", "A")] };
      if (turn === 2) return { content: "", toolCalls: [delegateCall("c2", "worker_b", "B")] };
      return { content: "summary", toolCalls: [] };
    };

    const result = await runDelegationLoop("sys", "user", {
      callModel,
      onDelegate,
      maxIterations: 8,
      agentName: "Supervisor"
    });

    expect(seen).toEqual(["worker_a", "worker_b"]);
    expect(result.iterations).toBe(2);
  });

  it("terminates at maxIterations even if the model keeps requesting delegates", async () => {
    const onDelegate = vi.fn(async () => JSON.stringify({ ok: true, result: {} }));
    const callModel = vi.fn(async (): Promise<DelegationCallResult> => ({
      content: "",
      toolCalls: [delegateCall(`c${Math.random()}`, "worker_a", "again")]
    }));

    const result = await runDelegationLoop("sys", "user", {
      callModel,
      onDelegate,
      maxIterations: 3,
      agentName: "Supervisor"
    });

    expect(callModel).toHaveBeenCalledTimes(3);
    expect(onDelegate).toHaveBeenCalledTimes(3);
    expect(result.iterations).toBe(3);
  });

  it("returns an error tool result for an unknown tool without calling onDelegate", async () => {
    const onDelegate = vi.fn(async () => "{}");
    let turn = 0;
    const callModel = async (): Promise<DelegationCallResult> => {
      turn += 1;
      if (turn === 1) {
        return {
          content: "",
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: { name: "not_a_tool", arguments: "{}" }
            } as unknown as LlmToolCall
          ]
        };
      }
      return { content: "stop", toolCalls: [] };
    };

    const result = await runDelegationLoop("sys", "user", {
      callModel,
      onDelegate,
      maxIterations: 8,
      agentName: "Supervisor"
    });

    expect(onDelegate).not.toHaveBeenCalled();
    expect(result.finalContent).toBe("stop");
    expect(result.iterations).toBe(0);
  });
});

describe("buildDelegationPrompt", () => {
  it("surfaces the delegate tool, the valid agent ids and the valid project ids", () => {
    const { system, user } = buildDelegationPrompt({
      entryAgent: { name: "Supervisor", promptTemplate: "You are the boss." },
      quest: { title: "Cross-repo work", requirement: "Make the offer flow consistent." },
      agentPool: [
        { id: "worker_a", name: "Researcher", role: "worker", capabilities: ["research"] },
        { id: "worker_b", name: "Implementer", role: "worker", capabilities: ["coding"] }
      ],
      projects: [
        { id: "api", name: "api-repo" },
        { id: "web", name: "web-repo" }
      ]
    });

    expect(system).toContain("You are the boss.");
    expect(system).toContain(DELEGATE_TOOL_NAME);
    expect(user).toContain("worker_a");
    expect(user).toContain("worker_b");
    expect(user).toContain("api");
    expect(user).toContain("web");
    expect(user).toContain("Make the offer flow consistent.");
  });
});
