import type { LlmToolSpec } from "../llm.js";
import type { SubAgent } from "../types.js";

export interface DelegateInput {
  agentId: string;
  task: string;
  context?: Record<string, unknown>;
}

export const DELEGATE_TOOL_NAME = "delegate";

export const delegateToolSpec: LlmToolSpec = {
  type: "function",
  function: {
    name: DELEGATE_TOOL_NAME,
    description:
      "Delegate a focused subtask to a specialized worker sub-agent. Use this when you (the supervisor) decide another agent should do the actual work. Return value is the worker's structured result.",
    parameters: {
      type: "object",
      required: ["agentId", "task"],
      additionalProperties: false,
      properties: {
        agentId: {
          type: "string",
          description: "The id of a worker sub-agent (mode=worker) registered in the system."
        },
        task: {
          type: "string",
          description: "A clear, self-contained instruction describing what the worker should do."
        },
        context: {
          type: "object",
          description: "Optional additional context (files, prior results, constraints).",
          additionalProperties: true
        }
      }
    }
  }
};

export interface WorkerInvoker {
  (worker: SubAgent, task: string, context: Record<string, unknown>): Promise<unknown>;
}

export interface ResolveWorker {
  (agentId: string): Promise<SubAgent | undefined>;
}

/**
 * Build a handler that, given a DelegateInput, resolves the worker,
 * validates it is a worker (not entry), and invokes it.
 * Returns a JSON string to feed back to the entry LLM.
 */
export function buildDelegateHandler(
  resolveWorker: ResolveWorker,
  invokeWorker: WorkerInvoker
) {
  return async function handleDelegate(input: DelegateInput): Promise<string> {
    if (!input.agentId || typeof input.agentId !== "string") {
      return JSON.stringify({ ok: false, error: "agentId is required" });
    }
    if (!input.task || typeof input.task !== "string") {
      return JSON.stringify({ ok: false, error: "task is required" });
    }
    const worker = await resolveWorker(input.agentId);
    if (!worker) {
      return JSON.stringify({ ok: false, error: `worker ${input.agentId} not found` });
    }
    if (worker.mode !== "worker") {
      return JSON.stringify({
        ok: false,
        error: `agent ${input.agentId} is mode=${worker.mode}, only worker agents can be delegated to`
      });
    }
    try {
      const result = await invokeWorker(worker, input.task, input.context ?? {});
      return JSON.stringify({
        ok: true,
        agentId: worker.id,
        agentName: worker.name,
        result
      });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        agentId: worker.id,
        agentName: worker.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}
