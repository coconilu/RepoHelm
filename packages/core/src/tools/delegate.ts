import type { LlmToolSpec } from "../llm.js";

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
          description: "The id of a registered sub-agent (other than the entry agent) to delegate to."
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
