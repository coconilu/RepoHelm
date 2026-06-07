import type { CliModelOption, ProviderId, ProviderModelsResult } from "./types.js";

/**
 * Provider catalog: fetch *real* model lists from each provider's `/models`
 * REST endpoint. See MODEL_FETCHING.md for the per-provider contract.
 *
 * The same fetcher backs two callers:
 *  - BYOK mode: explicit { apiKey, baseUrl } entered by the user.
 *  - CLI mode: the CLI's underlying provider, keyed off an env var (the same
 *    credential the CLI itself authenticates with).
 */

type AuthKind = "bearer" | "x-api-key" | "query-key" | "none";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  defaultBaseUrl: string;
  auth: AuthKind;
  /** Env vars to probe for an API key, first match wins (CLI mode). */
  envKeys: string[];
  /** Path appended to the base URL to list models. */
  listPath: string;
  extraHeaders?: Record<string, string>;
  /** Whether the list endpoint works without a key (OpenRouter). */
  keyOptional?: boolean;
  parse: (body: unknown) => CliModelOption[];
  fallbackModels: CliModelOption[];
}

const DEFAULT_TIMEOUT_MS = 10_000;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** OpenAI-shaped: `{ data: [{ id }] }`. */
const parseOpenAiShape = (body: unknown): CliModelOption[] =>
  asArray(asRecord(body).data)
    .map((item) => {
      const id = String(asRecord(item).id ?? "").trim();
      return id ? { id, label: id } : undefined;
    })
    .filter((option): option is CliModelOption => Boolean(option));

/** Anthropic: `{ data: [{ id, display_name }] }`. */
const parseAnthropicShape = (body: unknown): CliModelOption[] =>
  asArray(asRecord(body).data)
    .map((item) => {
      const record = asRecord(item);
      const id = String(record.id ?? "").trim();
      if (!id) {
        return undefined;
      }
      const label = String(record.display_name ?? id);
      return { id, label };
    })
    .filter((option): option is CliModelOption => Boolean(option));

/** Gemini: `{ models: [{ name: "models/x", supportedGenerationMethods }] }`. */
const parseGeminiShape = (body: unknown): CliModelOption[] =>
  asArray(asRecord(body).models)
    .map((item) => {
      const record = asRecord(item);
      const rawName = String(record.name ?? "").trim();
      if (!rawName) {
        return undefined;
      }
      const methods = asArray(record.supportedGenerationMethods).map(String);
      if (methods.length > 0 && !methods.includes("generateContent")) {
        return undefined; // skip embedding / aqa / non-chat models
      }
      const id = rawName.replace(/^models\//, "");
      const label = String(record.displayName ?? id);
      return { id, label };
    })
    .filter((option): option is CliModelOption => Boolean(option));

export const PROVIDER_DEFINITIONS: ProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    auth: "bearer",
    envKeys: ["OPENAI_API_KEY"],
    listPath: "/models",
    parse: parseOpenAiShape,
    fallbackModels: [
      { id: "gpt-4o", label: "gpt-4o" },
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "o4-mini", label: "o4-mini" }
    ]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    auth: "x-api-key",
    envKeys: ["ANTHROPIC_API_KEY"],
    listPath: "/v1/models",
    extraHeaders: { "anthropic-version": "2023-06-01" },
    parse: parseAnthropicShape,
    fallbackModels: [
      { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5" },
      { id: "claude-opus-4-1", label: "claude-opus-4-1" },
      { id: "claude-3-5-haiku-latest", label: "claude-3-5-haiku-latest" }
    ]
  },
  {
    id: "gemini",
    name: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    auth: "query-key",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    listPath: "/models",
    parse: parseGeminiShape,
    fallbackModels: [
      { id: "gemini-2.5-pro", label: "gemini-2.5-pro" },
      { id: "gemini-2.5-flash", label: "gemini-2.5-flash" }
    ]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    auth: "bearer",
    envKeys: ["DEEPSEEK_API_KEY"],
    listPath: "/models",
    parse: parseOpenAiShape,
    fallbackModels: [
      { id: "deepseek-chat", label: "deepseek-chat" },
      { id: "deepseek-reasoner", label: "deepseek-reasoner" }
    ]
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    auth: "bearer",
    keyOptional: true,
    envKeys: ["OPENROUTER_API_KEY"],
    listPath: "/models",
    parse: parseOpenAiShape,
    fallbackModels: [
      { id: "anthropic/claude-3.7-sonnet", label: "anthropic/claude-3.7-sonnet" },
      { id: "openai/gpt-4o", label: "openai/gpt-4o" },
      { id: "google/gemini-2.5-pro", label: "google/gemini-2.5-pro" }
    ]
  },
  {
    id: "openai-compatible",
    name: "OpenAI 兼容",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    auth: "bearer",
    keyOptional: true,
    envKeys: ["OPENAI_API_KEY"],
    listPath: "/models",
    parse: parseOpenAiShape,
    fallbackModels: []
  }
];

export class ProviderRegistry {
  constructor(private readonly definitions: ProviderDef[] = PROVIDER_DEFINITIONS) {}

  list(): ProviderDef[] {
    return this.definitions;
  }

  get(id: string | undefined): ProviderDef | undefined {
    return this.definitions.find((def) => def.id === id);
  }

  /** Resolve by explicit id, else infer from a base URL, else openai-compatible. */
  resolve(id: string | undefined, baseUrl?: string): ProviderDef {
    const byId = this.get(id);
    if (byId) {
      return byId;
    }
    if (baseUrl) {
      const host = baseUrl.toLowerCase();
      const byHost = this.definitions.find(
        (def) => def.id !== "openai-compatible" && host.includes(new URL(def.defaultBaseUrl).host)
      );
      if (byHost) {
        return byHost;
      }
    }
    return this.get("openai-compatible")!;
  }

  envKey(def: ProviderDef): string | undefined {
    for (const name of def.envKeys) {
      const value = process.env[name];
      if (value && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  /**
   * Real connectivity + auth probe: performs an actual `/models` request against the
   * provider and reports latency. Zero token cost (metadata endpoint), but proves the
   * key, base URL and network all work.
   */
  async probe(
    def: ProviderDef,
    options: { apiKey?: string; baseUrl?: string; timeoutMs?: number } = {}
  ): Promise<{ ok: boolean; latencyMs: number; modelCount: number; detail: string }> {
    const started = Date.now();
    const result = await this.fetchModels(def, options);
    return {
      ok: result.live,
      latencyMs: Date.now() - started,
      modelCount: result.models.length,
      detail: result.detail
    };
  }

  async fetchModels(
    def: ProviderDef,
    options: { apiKey?: string; baseUrl?: string; timeoutMs?: number } = {}
  ): Promise<ProviderModelsResult> {
    const fetchedAt = new Date().toISOString();
    const apiKey = options.apiKey?.trim() || undefined;
    const baseUrl = (options.baseUrl?.trim() || def.defaultBaseUrl).replace(/\/+$/, "");

    if (!apiKey && !def.keyOptional) {
      return {
        providerId: def.id,
        models: def.fallbackModels,
        live: false,
        detail: `未提供 ${def.name} 的 API Key,显示内置默认值。`,
        fetchedAt
      };
    }

    let url = `${baseUrl}${def.listPath}`;
    const headers: Record<string, string> = { Accept: "application/json", ...def.extraHeaders };
    if (apiKey) {
      if (def.auth === "bearer") {
        headers.Authorization = `Bearer ${apiKey}`;
      } else if (def.auth === "x-api-key") {
        headers["x-api-key"] = apiKey;
      } else if (def.auth === "query-key") {
        url += `${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        return {
          providerId: def.id,
          models: def.fallbackModels,
          live: false,
          detail: `${def.name} /models 返回 ${response.status}，已回退内置默认值。`,
          fetchedAt
        };
      }
      const body = (await response.json()) as unknown;
      const parsed = def.parse(body);
      const seen = new Set<string>();
      const models = parsed.filter((option) => {
        if (seen.has(option.id)) {
          return false;
        }
        seen.add(option.id);
        return true;
      });
      if (models.length === 0) {
        return {
          providerId: def.id,
          models: def.fallbackModels,
          live: false,
          detail: `${def.name} 返回为空,已回退内置默认值。`,
          fetchedAt
        };
      }
      return {
        providerId: def.id,
        models,
        live: true,
        detail: `已从 ${def.name} 拉取 ${models.length} 个实时模型。`,
        fetchedAt
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        providerId: def.id,
        models: def.fallbackModels,
        live: false,
        detail: `${def.name} 拉取失败(${reason}),已回退内置默认值。`,
        fetchedAt
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
