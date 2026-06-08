import type { RepoHelmService } from "./service.js";
import type { CreateSubAgentInput, ModelKit, SubAgent } from "./types.js";

/**
 * Built-in seed sub-agents. Supervisor is the entry; the rest are workers.
 * Each binds to the same default ModelKit (prefer BYOK, fall back to first available).
 */
const SEED_AGENTS: Array<Omit<CreateSubAgentInput, "modelKitId"> & { id: string }> = [
  {
    id: "supervisor",
    name: "Supervisor",
    role: "Entry supervisor that decomposes requests and aggregates worker results.",
    capabilities: ["planning"],
    mode: "entry",
    permissions: { allowedTools: ["delegate"], deniedTools: [] },
    promptTemplate:
      "You are the RepoHelm Supervisor. Your only job is to plan, delegate, and summarize.\n" +
      "- Do NOT write code, specifications, or reviews yourself.\n" +
      "- Use the `delegate` tool to assign focused subtasks to worker sub-agents.\n" +
      "- After delegating, synthesize worker results into a concise final summary for the user.\n" +
      "- If a worker reports an error, decide whether to retry with a clearer task or escalate in the summary.\n" +
      "- Stop and produce the final summary once you have enough information; do not loop unnecessarily."
  },
  {
    id: "spec-writer",
    name: "Spec Writer",
    role: "Produces lightweight specifications and requirements breakdowns.",
    capabilities: ["requirements", "specification"],
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] },
    promptTemplate:
      "You are a Spec Writer worker. Given a task, produce a clear, concise specification: goals, scope, constraints, acceptance criteria. Do not implement code."
  },
  {
    id: "coder",
    name: "Coder",
    role: "Implements code and plans concrete file-level changes.",
    capabilities: ["coding", "planning"],
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] },
    promptTemplate:
      "You are a Coder worker. Given a task, output concrete implementation steps and file changes. Include short code snippets when they clarify intent. Stay focused on the requested scope."
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "Reviews plans and code for quality, correctness, and security.",
    capabilities: ["review"],
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] },
    promptTemplate:
      "You are a Reviewer worker. Given a task and its output, review for correctness, clarity, security, and testability. Return a concise list of findings and suggested improvements."
  }
];

export interface SeedResult {
  seeded: boolean;
  reason?: string;
  agents: Array<{ id: string; name: string }>;
  defaultModelKitId?: string;
}

/**
 * Pick a default ModelKit for seed agents: prefer the first BYOK kit, else the first kit.
 * Returns undefined when no ModelKit is available (seed will be skipped).
 */
export function pickDefaultModelKit(modelKits: ModelKit[]): ModelKit | undefined {
  if (modelKits.length === 0) return undefined;
  const byok = modelKits.find((k) => k.type === "byok");
  return byok ?? modelKits[0];
}

/**
 * Seed the built-in sub-agents on first run. Idempotent:
 * - If the supervisor already exists, no agents are created.
 * - If no ModelKit is available, seeding is skipped and reason is populated.
 * After seeding, sets supervisor as the entry SubAgent.
 *
 * The optional `rawStateReader` is used during bootstrap to avoid recursive
 * getState() calls (which would re-enter bootstrap).
 */
export async function seedBuiltInSubAgents(
  service: RepoHelmService,
  rawStateReader?: () => Promise<{
    subAgents: Record<string, SubAgent>;
    engine: { modelKits: Record<string, ModelKit> };
    entrySubAgentId?: string;
  }>
): Promise<SeedResult> {
  const existing: SubAgent[] = rawStateReader
    ? Object.values((await rawStateReader()).subAgents)
    : await service.listSubAgents();

  const supervisorExists = existing.some((agent) => agent.id === "supervisor");
  if (supervisorExists) {
    return {
      seeded: false,
      reason: "supervisor already exists",
      agents: existing.map((a) => ({ id: a.id, name: a.name }))
    };
  }

  const modelKits: ModelKit[] = rawStateReader
    ? Object.values((await rawStateReader()).engine.modelKits)
    : await service.listModelKits();
  const defaultKit = pickDefaultModelKit(modelKits);
  if (!defaultKit) {
    return {
      seeded: false,
      reason: "no ModelKit configured; create a BYOK or CLI ModelKit in Settings to enable seed agents",
      agents: []
    };
  }

  const created: Array<{ id: string; name: string }> = [];
  for (const seed of SEED_AGENTS) {
    if (existing.some((agent) => agent.id === seed.id)) {
      created.push({ id: seed.id, name: seed.name });
      continue;
    }
    const agent = await service.createSubAgent({ ...seed, modelKitId: defaultKit.id });
    created.push({ id: agent.id, name: agent.name });
  }

  await service.setEntrySubAgent("supervisor");

  return {
    seeded: true,
    agents: created,
    defaultModelKitId: defaultKit.id
  };
}
