import type { SubAgentBackend } from "./orchestrator.js";
import type { OrchestrationPlan, Quest, SubAgent } from "./types.js";

/**
 * Assess the complexity of a quest to determine if it can use a simplified plan.
 */
export interface QuestComplexity {
  isSimple: boolean;
  affectedProjectCount: number;
  requirementLength: number;
  hasExplicitSteps: boolean;
}

export function assessComplexity(quest: Quest): QuestComplexity {
  const requirementLength = quest.requirement.length;
  const affectedProjectCount = quest.affectedProjectIds.length;

  // Check if requirement implies multi-step work
  const stepKeywords = [
    "首先", "然后", "接着", "最后", "step", "phase", "stage",
    "第一步", "第二步", "先", "再", "之后"
  ];
  const hasExplicitSteps = stepKeywords.some((kw) =>
    quest.requirement.toLowerCase().includes(kw)
  );

  // Simple if: single project, short requirement, no explicit steps
  const isSimple = affectedProjectCount === 1 && requirementLength < 200 && !hasExplicitSteps;

  return {
    isSimple,
    affectedProjectCount,
    requirementLength,
    hasExplicitSteps
  };
}

const PLAN_SYSTEM_PROMPT = `You are the RepoHelm orchestration planner. Given a quest requirement and a pool of available agents, produce a structured execution plan.

IMPORTANT: Output ONLY a JSON object (no markdown, no code fences, no explanation before or after). The entire response must be valid JSON:
{
  "summary": "Brief description of the overall approach",
  "steps": [
    {
      "id": "step_1",
      "description": "What this step does — be specific about the actual work",
      "agentId": "agent-id-from-pool",
      "agentName": "Agent Display Name",
      "dependencies": [],
      "expectedOutput": "What the step produces",
      "targetProjectId": "project-id-from-affected-projects"
    }
  ],
  "notes": "Any risks or assumptions"
}

Rules:
- Each step must reference an agent ID from the available pool.
- Each step MUST include "targetProjectId" specifying which affected project's worktree to operate on.
- Dependencies are step IDs that must complete before this step runs.
- Keep plans concise: 1-3 steps for simple tasks, 2-5 steps for complex ones.
- If the quest can be completed by a single agent in one pass, produce exactly one step.
- Step descriptions must be specific and actionable, not generic.
- Avoid creating artificial steps like "clarify requirements" unless the requirement is genuinely ambiguous.
- If no agents are suitable, produce a plan with a single step assigned to the most capable agent.`;

export interface PlanGeneratorInput {
  entryAgent: SubAgent;
  quest: Quest;
  agentPool: SubAgent[];
  backend: SubAgentBackend;
}

export async function generateOrchestrationPlan(input: PlanGeneratorInput): Promise<OrchestrationPlan> {
  const { entryAgent, quest, agentPool, backend } = input;

  const agentList = agentPool
    .map((a) => `- ${a.id}: ${a.name} — ${a.role} (${a.capabilities?.join(", ") || "general"})`)
    .join("\n");

  const systemPrompt = entryAgent.promptTemplate
    ? `${entryAgent.promptTemplate}\n\n${PLAN_SYSTEM_PROMPT}`
    : PLAN_SYSTEM_PROMPT;

  const userContent = [
    `## Available Agent Pool`,
    agentList || "(no agents available)",
    ``,
    `## Quest Requirement`,
    `**Title**: ${quest.title}`,
    `**Requirement**: ${quest.requirement}`,
    ``,
    `Produce an execution plan.`
  ].join("\n");

  const result = await backend.run({
    systemPrompt,
    messages: [{ role: "user", content: userContent }],
    tools: [],
    worktrees: quest.worktrees,
    quest
  });

  return parsePlanFromResponse(result.content, quest, agentPool);
}

function parsePlanFromResponse(content: string, quest: Quest, agentPool: SubAgent[]): OrchestrationPlan {
  const questId = quest.id;
  // Try code-fenced JSON first
  const jsonFenceMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonFenceMatch) {
    try {
      const parsed = JSON.parse(jsonFenceMatch[1]!);
      return validatePlan(parsed, questId, agentPool, quest);
    } catch {
      // fall through
    }
  }

  // Try any code-fenced block
  const anyFenceMatch = content.match(/```\s*([\s\S]*?)```/);
  if (anyFenceMatch) {
    try {
      const parsed = JSON.parse(anyFenceMatch[1]!);
      return validatePlan(parsed, questId, agentPool, quest);
    } catch {
      // fall through
    }
  }

  // Try raw JSON (CLI backends often return bare JSON)
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
      if (parsed.steps) {
        return validatePlan(parsed, questId, agentPool, quest);
      }
    } catch {
      // fall through
    }
  }

  // Fallback: use LLM response as summary, create actionable steps
  const defaultAgent = agentPool.find((a) => a.capabilities?.includes("coding")) || agentPool[0];
  const defaultProjectId = quest.affectedProjectIds[0];
  const fallbackSteps = defaultAgent
    ? [
        {
          id: "step_1",
          description: quest.requirement,
          agentId: defaultAgent.id,
          agentName: defaultAgent.name,
          dependencies: [] as string[],
          expectedOutput: "Implementation code and artifacts",
          targetProjectId: defaultProjectId
        }
      ]
    : [];

  return {
    questId,
    summary: content.slice(0, 500) || "No structured plan could be generated.",
    steps: fallbackSteps,
    notes: "Auto-generated plan from LLM response.",
    generatedAt: new Date().toISOString()
  };
}

function validatePlan(raw: any, questId: string, agentPool: SubAgent[], quest: Quest): OrchestrationPlan {
  const agentIds = new Set(agentPool.map((a) => a.id));
  const defaultProjectId = quest.affectedProjectIds[0];
  const steps = Array.isArray(raw.steps)
    ? raw.steps
        .filter((s: any) => s && typeof s.id === "string" && typeof s.agentId === "string")
        .map((s: any) => ({
          id: s.id,
          description: s.description || "",
          agentId: s.agentId,
          agentName: s.agentName || agentPool.find((a) => a.id === s.agentId)?.name || s.agentId,
          dependencies: Array.isArray(s.dependencies) ? s.dependencies.filter((d: any) => typeof d === "string") : [],
          expectedOutput: s.expectedOutput || "",
          targetProjectId: s.targetProjectId || defaultProjectId
        }))
    : [];

  return {
    questId,
    summary: raw.summary || "Orchestration plan",
    steps,
    notes: raw.notes,
    generatedAt: new Date().toISOString()
  };
}
