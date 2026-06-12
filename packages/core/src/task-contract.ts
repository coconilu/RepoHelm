import type { OrchestrationPlanStep, TaskContract } from "./types.js";

export interface ResolvedContract {
  objective: string;
  outputFormat: string;
  boundaries?: string;
  sourcesGuidance?: string;
  doneCriteria?: string;
}

export interface DependencyResult {
  stepId: string;
  result: string;
}

export interface MaterialOutputValidation {
  required: boolean;
  ok: boolean;
  reason?: string;
}

/** Collapse newlines so a value stays on one plan.md metadata line. */
function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").trim();
}

function clean(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Merge step fields + contract into a unified 5-element view. Never throws. */
export function resolveContract(step: OrchestrationPlanStep): ResolvedContract {
  const c = step.contract;
  return {
    objective: step.description,
    outputFormat: clean(c?.outputFormat) ?? step.expectedOutput,
    boundaries: clean(c?.boundaries),
    sourcesGuidance: clean(c?.sourcesGuidance),
    doneCriteria: clean(c?.doneCriteria)
  };
}

/** Build the structured contract section injected into a worker's prompt. */
export function renderContractSection(resolved: ResolvedContract, deps: DependencyResult[]): string {
  const lines: string[] = ["## Task Contract", `- Objective: ${resolved.objective}`];
  if (resolved.outputFormat) lines.push(`- Expected output: ${resolved.outputFormat}`);
  if (resolved.boundaries) lines.push(`- Boundaries: ${resolved.boundaries}`);
  if (resolved.sourcesGuidance) lines.push(`- Sources & notes: ${resolved.sourcesGuidance}`);
  if (resolved.doneCriteria) lines.push(`- Done when: ${resolved.doneCriteria}`);
  const realDeps = deps.filter((d) => d.result);
  if (realDeps.length > 0) {
    lines.push("## Upstream results");
    for (const d of realDeps) lines.push(`- ${d.stepId}: ${d.result}`);
  }
  return lines.join("\n");
}

/** Minimal contract for code-generated (simple/fallback) plans. */
export function minimalContract(expectedOutput: string): TaskContract {
  return { doneCriteria: expectedOutput };
}

/**
 * Some worker tasks are allowed to produce a text-only artifact (analysis,
 * review, planning). Implementation and knowledge-update tasks must create a
 * material output so the orchestrator does not accept "I will inspect..." as
 * completed work.
 */
export function requiresMaterialOutput(step: OrchestrationPlanStep): boolean {
  const resolved = resolveContract(step);
  const objective = resolved.objective.toLowerCase();
  const output = [resolved.outputFormat, resolved.doneCriteria].filter(Boolean).join(" ").toLowerCase();
  const text = [objective, output].filter(Boolean).join(" ");

  const textOnlyIntent =
    /\b(review|analy[sz]e|inspect|investigate|assess|audit|summari[sz]e)\b/.test(objective) &&
    /\b(notes?|report|analysis|findings|summary|recommendations?)\b/.test(output);
  const materialAction =
    /\b(implement|write|create|modify|update|add|change|persist|save)\b/.test(text);
  if (textOnlyIntent && !materialAction) {
    return false;
  }

  const materialSignals = [
    /\bcode changes?\b/,
    /\bsource code\b/,
    /\bimplementation code\b/,
    /\bfile changes?\b/,
    /\b(diff|patch)\b/,
    /\b(api endpoint|api endpoints|rest endpoint|rest endpoints)\b/,
    /\b(persistence layer|schema migration|repository update|serialization test|serialization tests)\b/,
    /\b(web ui component|ui component|domain model changes?|test files?|tests pass)\b/,
    /\b(create|modify|update|write|add|implement)\b.{0,60}\b(file|code|test|ui|api|model|schema|doc|documentation|knowledge|memory|page|component)\b/,
    /\b(file|code|test|ui|api|model|schema|doc|documentation|knowledge|memory|page|component)\b.{0,60}\b(created|modified|updated|written|implemented)\b/,
    /\bknowledge (memory|documentation|file|files|page|pages)\b/,
    /\bupdated knowledge\b/
  ];

  return materialSignals.some((pattern) => pattern.test(text));
}

export function validateMaterialOutput(
  step: OrchestrationPlanStep,
  writtenFiles: readonly string[]
): MaterialOutputValidation {
  if (!requiresMaterialOutput(step)) {
    return { required: false, ok: true };
  }
  if (writtenFiles.length > 0) {
    return { required: true, ok: true };
  }
  const resolved = resolveContract(step);
  const criteria = resolved.doneCriteria || resolved.outputFormat;
  return {
    required: true,
    ok: false,
    reason: [
      "Worker completed without required material output.",
      criteria ? `Done criteria expected: ${criteria}` : undefined,
      "No files were created or modified in the quest worktree."
    ].filter(Boolean).join(" ")
  };
}

/** plan.md metadata lines for a step's contract (only present fields). */
export function renderContractMarkdownLines(step: OrchestrationPlanStep): string[] {
  const c = step.contract;
  if (!c) return [];
  const lines: string[] = [];
  if (clean(c.outputFormat)) lines.push(`- **Output Format**: ${oneLine(c.outputFormat!)}`);
  if (clean(c.boundaries)) lines.push(`- **Boundaries**: ${oneLine(c.boundaries!)}`);
  if (clean(c.sourcesGuidance)) lines.push(`- **Sources Guidance**: ${oneLine(c.sourcesGuidance!)}`);
  if (clean(c.doneCriteria)) lines.push(`- **Done Criteria**: ${oneLine(c.doneCriteria!)}`);
  return lines;
}

/** Parse a step's metadata block back into a TaskContract (undefined if none). */
export function parseContractFromBlock(block: string): TaskContract | undefined {
  const outputFormat = block.match(/- \*\*Output Format\*\*: (.+)/)?.[1]?.trim();
  const boundaries = block.match(/- \*\*Boundaries\*\*: (.+)/)?.[1]?.trim();
  const sourcesGuidance = block.match(/- \*\*Sources Guidance\*\*: (.+)/)?.[1]?.trim();
  const doneCriteria = block.match(/- \*\*Done Criteria\*\*: (.+)/)?.[1]?.trim();
  if (!outputFormat && !boundaries && !sourcesGuidance && !doneCriteria) {
    return undefined;
  }
  const contract: TaskContract = {};
  if (outputFormat) contract.outputFormat = outputFormat;
  if (boundaries) contract.boundaries = boundaries;
  if (sourcesGuidance) contract.sourcesGuidance = sourcesGuidance;
  if (doneCriteria) contract.doneCriteria = doneCriteria;
  return contract;
}
