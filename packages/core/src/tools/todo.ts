import type { LlmToolSpec } from "../llm.js";

export const WRITE_TODOS_TOOL = "write_todos";

export type TodoStatus = "pending" | "in_progress" | "completed";
const STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

/**
 * Process-tracking tool handed to worker sub-agents so they can maintain a
 * visible task list across iterations of the tool-calling loop — surfacing
 * intent and progress on longer tasks rather than working opaquely. The list is
 * replaced wholesale on each call (the agent owns the canonical state).
 */
export const todoToolSpec: LlmToolSpec = {
  type: "function",
  function: {
    name: WRITE_TODOS_TOOL,
    description:
      "Record or update your task list for the current work. Pass the complete list each time (it replaces the previous one). Use it to plan multi-step work and mark steps in_progress/completed as you go.",
    parameters: {
      type: "object",
      required: ["todos"],
      additionalProperties: false,
      properties: {
        todos: {
          type: "array",
          description: "The full ordered task list.",
          items: {
            type: "object",
            required: ["content"],
            additionalProperties: false,
            properties: {
              content: { type: "string", description: "Short description of the task." },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Task status (default \"pending\")."
              }
            }
          }
        }
      }
    }
  }
};

export interface TodoToolHandler {
  /** Current task list (canonical state, replaced on each successful call). */
  readonly list: TodoItem[];
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

/** Build an in-memory todo handler scoped to a single worker run. */
export function buildTodoToolHandler(): TodoToolHandler {
  const list: TodoItem[] = [];

  return {
    list,
    async handle(name, args) {
      if (name !== WRITE_TODOS_TOOL) {
        return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
      }
      const raw = args.todos;
      if (!Array.isArray(raw)) {
        return JSON.stringify({ ok: false, error: "todos must be an array" });
      }
      const next: TodoItem[] = [];
      for (const entry of raw) {
        const item = entry as { content?: unknown; status?: unknown };
        const content = typeof item.content === "string" ? item.content.trim() : "";
        if (!content) {
          return JSON.stringify({ ok: false, error: "every todo requires a content string" });
        }
        const status = item.status === undefined ? "pending" : item.status;
        if (!STATUSES.includes(status as TodoStatus)) {
          return JSON.stringify({ ok: false, error: `invalid status "${String(status)}"; use one of ${STATUSES.join(", ")}` });
        }
        next.push({ content, status: status as TodoStatus });
      }
      list.splice(0, list.length, ...next);
      return JSON.stringify({ ok: true, todos: list });
    }
  };
}
