/**
 * Lead-agent recovery decision.
 *
 * When a plan step does not cleanly succeed (worker error OR material-output
 * validation failure), the deterministic orchestrator consults the lead agent
 * for a BOUNDED structured decision among a fixed action enum. The orchestrator
 * — not the agent — enforces attempt caps and executes the chosen action, so
 * the lead's freedom is confined to "what should we do about this failure",
 * never "drive the whole loop".
 *
 * Safe default: anything the lead returns that we cannot parse into a known
 * action collapses to `skip`, which reproduces the legacy "mark failed + skip
 * downstream" behavior. That keeps the feature strictly additive.
 */

export type LeadDecisionAction = "retry" | "reassign" | "revise" | "skip" | "abort";

export interface LeadDecision {
  action: LeadDecisionAction;
  /** Target agent id for `reassign` (validated against the pool). */
  reassignTo?: string;
  /** Replacement step description for `revise`. */
  revisedDescription?: string;
  /** Extra guidance appended to the worker prompt on `retry` / `revise` / `reassign`. */
  feedback?: string;
  /** Free-text rationale, surfaced on the timeline. */
  reason?: string;
}

export interface LeadDecisionContext {
  quest: { title: string; requirement: string };
  step: { id: string; description: string; agentName: string };
  /** Why the step did not cleanly succeed (worker error or material validation). */
  error: string;
  workerOutput: string;
  writtenFiles: string[];
  /** How many attempts this step has already consumed (1-based). */
  attempt: number;
  /** Hard cap the orchestrator enforces regardless of the lead's choice. */
  maxAttempts: number;
  agentPool: Array<{ id: string; name: string; capabilities?: string[] }>;
}

const KNOWN_ACTIONS: ReadonlySet<string> = new Set<LeadDecisionAction>([
  "retry",
  "reassign",
  "revise",
  "skip",
  "abort"
]);

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Pull the first JSON object out of a possibly-fenced / prose-wrapped response. */
function extractJsonObject(content: string): any | undefined {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates: string[] = [];
  if (fenced?.[1]) candidates.push(fenced[1]);
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(content.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/**
 * Parse the lead's raw response into a validated decision. `agentPoolIds` is the
 * set of agent ids a `reassign` may target — an out-of-pool target collapses to
 * `skip` so the loop never dispatches to a non-existent agent.
 */
export function parseLeadDecision(content: string, agentPoolIds: ReadonlySet<string>): LeadDecision {
  const raw = extractJsonObject(content);
  const action = cleanString(raw?.action)?.toLowerCase();
  if (!action || !KNOWN_ACTIONS.has(action)) {
    return { action: "skip" };
  }

  const decision: LeadDecision = { action: action as LeadDecisionAction };
  const reason = cleanString(raw.reason);
  const feedback = cleanString(raw.feedback);
  const revisedDescription = cleanString(raw.revisedDescription);
  if (reason) decision.reason = reason;
  if (feedback) decision.feedback = feedback;

  if (decision.action === "reassign") {
    const target = cleanString(raw.reassignTo);
    if (!target || !agentPoolIds.has(target)) {
      // No valid target to hand off to — fall back to the safe default.
      return { action: "skip", ...(reason ? { reason } : {}) };
    }
    decision.reassignTo = target;
  }

  if (decision.action === "revise" && revisedDescription) {
    decision.revisedDescription = revisedDescription;
  }

  return decision;
}

const DECISION_SYSTEM_PROMPT = `You are the RepoHelm lead orchestrator acting like a tech lead. A worker step did not cleanly succeed. Decide ONE recovery action.

Output ONLY a JSON object (no prose, no code fences), e.g. {"action":"retry","reason":"..."}.

Allowed actions:
- "retry": re-run the SAME step with the SAME agent (use when the failure looks transient or the worker just needs another pass). Add "feedback" with concrete guidance.
- "reassign": hand the step to a DIFFERENT agent. Provide "reassignTo" set to an agent id from the candidate pool. Add "feedback".
- "revise": re-run after rewriting the task. Provide "revisedDescription" (a clearer, more actionable instruction) and optional "feedback".
- "skip": give up on this step and skip everything that depends on it (the safe default when recovery is unlikely).
- "abort": stop the entire plan (only for unrecoverable, plan-wide failures).

Pick the cheapest action that has a real chance of fixing the failure. Do NOT invent agent ids.`;

/** Build the system+user prompt that asks the lead for a recovery decision. */
export function buildLeadDecisionPrompt(ctx: LeadDecisionContext): { system: string; user: string } {
  const candidates = ctx.agentPool
    .map((a) => `- ${a.id}: ${a.name} (${a.capabilities?.join(", ") || "general"})`)
    .join("\n");
  const filesNote =
    ctx.writtenFiles.length > 0 ? ctx.writtenFiles.join(", ") : "(none — nothing was written to the worktree)";
  const user = [
    `## Quest`,
    `**Title**: ${ctx.quest.title}`,
    `**Requirement**: ${ctx.quest.requirement}`,
    ``,
    `## Failed step (attempt ${ctx.attempt} of ${ctx.maxAttempts})`,
    `- id: ${ctx.step.id}`,
    `- description: ${ctx.step.description}`,
    `- assigned agent: ${ctx.step.agentName}`,
    `- failure: ${ctx.error}`,
    `- files written: ${filesNote}`,
    `- worker output: ${ctx.workerOutput || "(empty)"}`,
    ``,
    `## Reassign candidates`,
    candidates || "(no other agents available)",
    ``,
    `Decide the recovery action as JSON.`
  ].join("\n");
  return { system: DECISION_SYSTEM_PROMPT, user };
}
