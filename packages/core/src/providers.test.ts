import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "./providers.js";

const registry = new ProviderRegistry();

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as Response;
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProviderRegistry.fetchModels", () => {
  it("parses the OpenAI shape and marks the result live", async () => {
    mockFetchOnce({ data: [{ id: "gpt-4o" }, { id: "o4-mini" }] });
    const def = registry.get("openai")!;
    const result = await registry.fetchModels(def, { apiKey: "sk-test" });
    expect(result.live).toBe(true);
    expect(result.models.map((model) => model.id)).toEqual(["gpt-4o", "o4-mini"]);
  });

  it("uses display_name as label for Anthropic", async () => {
    mockFetchOnce({ data: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }] });
    const def = registry.get("anthropic")!;
    const result = await registry.fetchModels(def, { apiKey: "sk-ant" });
    expect(result.models[0]).toEqual({ id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" });
  });

  it("strips the models/ prefix and filters non-chat Gemini models", async () => {
    mockFetchOnce({
      models: [
        { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }
      ]
    });
    const def = registry.get("gemini")!;
    const result = await registry.fetchModels(def, { apiKey: "key" });
    expect(result.models.map((model) => model.id)).toEqual(["gemini-2.5-pro"]);
  });

  it("falls back to builtin models when no key is supplied", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const def = registry.get("openai")!;
    const result = await registry.fetchModels(def, {});
    expect(result.live).toBe(false);
    expect(result.models).toEqual(def.fallbackModels);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists OpenRouter without a key (keyOptional)", async () => {
    mockFetchOnce({ data: [{ id: "anthropic/claude-3.7-sonnet" }] });
    const def = registry.get("openrouter")!;
    const result = await registry.fetchModels(def, {});
    expect(result.live).toBe(true);
    expect(result.models[0].id).toBe("anthropic/claude-3.7-sonnet");
  });

  it("falls back when the endpoint returns a non-2xx status", async () => {
    mockFetchOnce({}, { ok: false, status: 401 });
    const def = registry.get("openai")!;
    const result = await registry.fetchModels(def, { apiKey: "bad" });
    expect(result.live).toBe(false);
    expect(result.detail).toContain("401");
  });

  it("resolves a provider from a base URL host", () => {
    expect(registry.resolve(undefined, "https://api.deepseek.com").id).toBe("deepseek");
    expect(registry.resolve(undefined, "http://127.0.0.1:11434/v1").id).toBe("openai-compatible");
  });
});
