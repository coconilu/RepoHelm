import type { LlmMessage, LlmToolCall, LlmToolSpec } from "./llm.js";
import type { BackendEvent } from "./orchestrator.js";
import { DELEGATE_TOOL_NAME, delegateToolSpec, type DelegateInput } from "./tools/delegate.js";

/** What the entry model returns each turn of the delegation loop. */
export interface DelegationCallResult {
  content: string;
  toolCalls: LlmToolCall[];
}

export interface DelegationLoopDeps {
  /** Call the entry model with the running message list + the delegate tool spec. */
  callModel: (messages: LlmMessage[], tools: LlmToolSpec[]) => Promise<DelegationCallResult>;
  /** Route a `delegate(...)` call to a worker; returns the JSON tool-result string. */
  onDelegate: (input: DelegateInput) => Promise<string>;
  /** Hard cap on model turns, so the loop always terminates. */
  maxIterations: number;
  /** Display name for the events emitted for the entry agent. */
  agentName: string;
}

export interface DelegationLoopResult {
  finalContent: string;
  /** Number of `delegate` tool calls actually routed to a worker. */
  iterations: number;
  events: BackendEvent[];
}

/**
 * Drive the entry/supervisor agent in a bounded tool-calling loop where its only
 * tool is `delegate`. Each turn the model may emit `delegate(agentId, task,
 * context)` calls; we route them through `onDelegate`, thread the worker's
 * result back as a tool message, and let the model decide — at runtime, based on
 * what came back — whether to delegate again, to whom, and with what task. The
 * loop ends when the model stops requesting tools or the iteration cap is hit.
 *
 * Pure orchestration: the real LLM and worker execution are injected via `deps`,
 * so this can be unit-tested without any network.
 */
export async function runDelegationLoop(
  system: string,
  user: string,
  deps: DelegationLoopDeps
): Promise<DelegationLoopResult> {
  const messages: LlmMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  const events: BackendEvent[] = [];
  let finalContent = "";
  let delegateCount = 0;

  for (let i = 0; i < deps.maxIterations; i++) {
    const result = await deps.callModel(messages, [delegateToolSpec]);
    if (result.content) {
      finalContent = result.content;
      events.push({
        type: "agent.message",
        title: "助手消息",
        detail: truncate(result.content, 500),
        agent: deps.agentName
      });
    }
    if (!result.toolCalls || result.toolCalls.length === 0) {
      break;
    }
    messages.push({ role: "assistant", content: result.content ?? "", tool_calls: result.toolCalls });

    for (const call of result.toolCalls) {
      let output: string;
      if (call.function.name === DELEGATE_TOOL_NAME) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        events.push({
          type: "agent.tool_call",
          title: `委派任务: ${typeof args.agentId === "string" ? args.agentId : "?"}`,
          detail: truncate(call.function.arguments || "", 300),
          agent: deps.agentName
        });
        output = await deps.onDelegate(args as unknown as DelegateInput);
        delegateCount += 1;
      } else {
        output = JSON.stringify({ ok: false, error: `unknown tool ${call.function.name}` });
      }
      // Every tool_call_id MUST get a tool message back, or the next model turn errors.
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }

  return { finalContent, iterations: delegateCount, events };
}

/** Minimal agent/quest/project shapes the delegation prompt needs. */
export interface DelegationPromptInput {
  entryAgent: { name: string; promptTemplate?: string };
  quest: { title: string; requirement: string };
  agentPool: Array<{ id: string; name: string; role?: string; capabilities?: string[] }>;
  projects: Array<{ id: string; name: string }>;
}

const DELEGATION_SYSTEM_PROMPT = `You are the RepoHelm Supervisor running in DELEGATE mode.

You do not write code yourself. Instead you decide, at runtime, how to break the quest into focused subtasks and which specialized worker sub-agent should do each one. Use the \`${DELEGATE_TOOL_NAME}\` tool to assign a subtask to a worker by its agent id. You may delegate multiple times — read each worker's returned result and decide whether to delegate further, to whom, and with what task.

Rules:
- Only delegate to agent ids from the provided pool. Never delegate to yourself.
- Each \`task\` must be a clear, self-contained instruction.
- When a subtask belongs to a specific repository, pass that project id as \`context.targetProjectId\` (one of the listed project ids) so the worker runs in the right worktree.
- When all necessary work is delegated and you have synthesized the workers' results, reply with a final plain-text summary and STOP calling tools.`;

/**
 * Build the system + user prompts that drive the entry agent's delegation loop.
 * The valid agent ids and project ids are surfaced explicitly so the model emits
 * `delegate` calls the orchestrator can route without guessing.
 */
export function buildDelegationPrompt(input: DelegationPromptInput): { system: string; user: string } {
  const system = input.entryAgent.promptTemplate
    ? `${input.entryAgent.promptTemplate}\n\n${DELEGATION_SYSTEM_PROMPT}`
    : DELEGATION_SYSTEM_PROMPT;

  const agentList = input.agentPool
    .map((a) => `- ${a.id}: ${a.name} — ${a.role ?? "worker"} (${a.capabilities?.join(", ") || "general"})`)
    .join("\n");
  const projectList = input.projects.map((p) => `- ${p.id}: ${p.name}`).join("\n");

  const user = [
    `## Available Worker Agents (valid agentId values)`,
    agentList || "(no workers available)",
    ``,
    `## Affected Projects (valid context.targetProjectId values)`,
    projectList || "(none)",
    ``,
    `## Quest`,
    `**Title**: ${input.quest.title}`,
    `**Requirement**: ${input.quest.requirement}`,
    ``,
    `Delegate the work to the appropriate workers, then summarize the outcome.`
  ].join("\n");

  return { system, user };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}
