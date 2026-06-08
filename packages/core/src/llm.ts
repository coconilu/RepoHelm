import type { ByokConfig, ModelKit } from "./types.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
}

export interface LlmToolSpec {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmCallOptions {
  modelKit: ModelKit;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmCallResult {
  content: string;
  toolCalls: LlmToolCall[];
  finishReason: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Resolve the effective base URL, model, and API key from a ModelKit.
 * BYOK ModelKits carry provider/model/apiKey/baseUrl inside `config`;
 * CLI ModelKits are not LLM-callable and this function rejects them.
 */
function resolveByok(modelKit: ModelKit): ByokConfig {
  if (modelKit.type !== "byok") {
    throw new Error(`ModelKit ${modelKit.id} is type=cli and cannot be used for direct LLM calls.`);
  }
  const cfg = (modelKit.config ?? {}) as Partial<ByokConfig>;
  const apiKey = cfg.apiKey;
  const baseUrl = cfg.baseUrl;
  const model = cfg.model ?? modelKit.model;
  const provider = cfg.provider ?? modelKit.providerId;
  if (!apiKey || !baseUrl || !model) {
    throw new Error(
      `ModelKit ${modelKit.id} is missing required BYOK fields (apiKey/baseUrl/model).`
    );
  }
  return { apiKey, baseUrl, model, provider: provider ?? "" };
}

/**
 * Perform a single OpenAI-compatible chat completions call using a ModelKit.
 * Returns assistant content and any tool_calls produced by the model.
 */
export async function callLlmWithModelKit(options: LlmCallOptions): Promise<LlmCallResult> {
  const { modelKit, messages, tools, maxTokens, temperature, signal } = options;
  const { apiKey, baseUrl, model } = resolveByok(modelKit);

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => {
      const base: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
      if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
      if (m.tool_calls) base.tool_calls = m.tool_calls;
      return base;
    })
  };
  if (tools && tools.length > 0) body.tools = tools;
  if (typeof maxTokens === "number") body.max_tokens = maxTokens;
  if (typeof temperature === "number") body.temperature = temperature;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM call to ${endpoint} failed (${response.status}): ${response.statusText} ${text}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string; tool_calls?: LlmToolCall[] };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = payload.choices?.[0];
  return {
    content: choice?.message?.content ?? "",
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? "unknown",
    usage: payload.usage
      ? {
          promptTokens: payload.usage.prompt_tokens ?? 0,
          completionTokens: payload.usage.completion_tokens ?? 0
        }
      : undefined
  };
}
