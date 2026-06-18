import type { ModelKit } from "./types.js";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
}

export interface RuntimeUsageEstimate extends TokenUsage {
  totalTokens: number;
  estimatedCostUsd: number;
  costTier: ModelKit["metadata"]["costTier"];
  modelKitId: string;
  model: string;
  source: string;
}

const COST_PER_1K: Record<ModelKit["metadata"]["costTier"], { prompt: number; completion: number }> = {
  free: { prompt: 0, completion: 0 },
  low: { prompt: 0.00015, completion: 0.0006 },
  medium: { prompt: 0.00125, completion: 0.005 },
  high: { prompt: 0.015, completion: 0.06 }
};

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function extractTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const usage = value as Record<string, unknown>;
  const promptTokens =
    numberFrom(usage.promptTokens) ??
    numberFrom(usage.prompt_tokens) ??
    numberFrom(usage.input_tokens) ??
    numberFrom(usage.inputTokens) ??
    0;
  const completionTokens =
    numberFrom(usage.completionTokens) ??
    numberFrom(usage.completion_tokens) ??
    numberFrom(usage.output_tokens) ??
    numberFrom(usage.outputTokens) ??
    0;
  const cachedPromptTokens =
    numberFrom(usage.cachedPromptTokens) ??
    numberFrom(usage.cached_prompt_tokens) ??
    numberFrom(usage.cached_input_tokens);
  if (promptTokens <= 0 && completionTokens <= 0 && (cachedPromptTokens ?? 0) <= 0) {
    return undefined;
  }
  return { promptTokens, completionTokens, cachedPromptTokens };
}

export function estimateRuntimeUsage(
  modelKit: ModelKit,
  usage: TokenUsage,
  source: string
): RuntimeUsageEstimate {
  const costTier = modelKit.metadata.costTier;
  const rate = COST_PER_1K[costTier] ?? COST_PER_1K.medium;
  const billablePromptTokens = Math.max(0, usage.promptTokens - (usage.cachedPromptTokens ?? 0));
  const estimatedCostUsd =
    (billablePromptTokens / 1000) * rate.prompt +
    (usage.completionTokens / 1000) * rate.completion;
  return {
    ...usage,
    totalTokens: usage.promptTokens + usage.completionTokens,
    estimatedCostUsd,
    costTier,
    modelKitId: modelKit.id,
    model: modelKit.model,
    source
  };
}

export function formatRuntimeUsageDetail(
  modelKit: ModelKit,
  usage: TokenUsage,
  source: string
): string {
  const estimate = estimateRuntimeUsage(modelKit, usage, source);
  return [
    `source=${estimate.source}`,
    `modelKit=${estimate.modelKitId}`,
    `model=${estimate.model}`,
    `promptTokens=${estimate.promptTokens}`,
    `completionTokens=${estimate.completionTokens}`,
    estimate.cachedPromptTokens ? `cachedPromptTokens=${estimate.cachedPromptTokens}` : "",
    `totalTokens=${estimate.totalTokens}`,
    `costTier=${estimate.costTier}`,
    `estimatedCostUsd=${estimate.estimatedCostUsd.toFixed(6)}`
  ]
    .filter(Boolean)
    .join(" ");
}

export function runtimeUsageEvent(
  modelKit: ModelKit,
  usage: TokenUsage | undefined,
  agent: string,
  source: string
): { type: string; title: string; detail: string; agent: string } | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    type: "agent.usage",
    title: "Token / 成本记录",
    detail: formatRuntimeUsageDetail(modelKit, usage, source),
    agent
  };
}
