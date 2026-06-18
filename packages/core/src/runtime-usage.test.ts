import { describe, expect, it } from "vitest";
import {
  estimateRuntimeUsage,
  extractTokenUsage,
  runtimeUsageEvent
} from "./runtime-usage.js";
import type { ModelKit } from "./types.js";

const kit: ModelKit = {
  id: "mk-fast",
  name: "Fast Kit",
  type: "byok",
  providerId: "openai-compatible",
  model: "fast-model",
  config: {},
  metadata: {
    createdAt: "",
    testedAt: "",
    costTier: "medium",
    performanceProfile: "balanced"
  }
};

describe("runtime usage tracking", () => {
  it("extracts token usage from OpenAI and Codex style payloads", () => {
    expect(extractTokenUsage({ prompt_tokens: 10, completion_tokens: 3 })).toEqual({
      promptTokens: 10,
      completionTokens: 3,
      cachedPromptTokens: undefined
    });

    expect(extractTokenUsage({ input_tokens: 12, output_tokens: 5, cached_input_tokens: 4 })).toEqual({
      promptTokens: 12,
      completionTokens: 5,
      cachedPromptTokens: 4
    });
  });

  it("ignores missing and zero-only usage payloads", () => {
    expect(extractTokenUsage(undefined)).toBeUndefined();
    expect(extractTokenUsage({ input_tokens: 0, output_tokens: 0 })).toBeUndefined();
  });

  it("estimates billable cost after cached prompt tokens are removed", () => {
    const estimate = estimateRuntimeUsage(
      kit,
      { promptTokens: 1_000, completionTokens: 200, cachedPromptTokens: 250 },
      "worker-tool-loop"
    );

    expect(estimate.totalTokens).toBe(1_200);
    expect(estimate.estimatedCostUsd).toBeCloseTo(0.0019375, 8);
    expect(estimate.costTier).toBe("medium");
  });

  it("formats usage into an event-log entry", () => {
    const event = runtimeUsageEvent(kit, { promptTokens: 12, completionTokens: 5 }, "Worker", "byok-backend");

    expect(event).toMatchObject({
      type: "agent.usage",
      title: "Token / 成本记录",
      agent: "Worker"
    });
    expect(event!.detail).toContain("source=byok-backend");
    expect(event!.detail).toContain("modelKit=mk-fast");
    expect(runtimeUsageEvent(kit, undefined, "Worker", "byok-backend")).toBeUndefined();
  });
});
