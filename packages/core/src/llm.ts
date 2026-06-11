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

/**
 * Streaming variant of callLlmWithModelKit. Async-generates assistant content
 * deltas (OpenAI-compatible `choices[0].delta.content`). Honors REPOHELM_FAKE_MODELS.
 */
export async function* streamLlmWithModelKit(
  options: LlmCallOptions
): AsyncGenerator<string, void, unknown> {
  if (process.env.REPOHELM_FAKE_MODELS === "1") {
    const text = process.env.REPOHELM_FAKE_STREAM_TEXT ?? "";
    const size = Math.max(1, Math.ceil(text.length / 4));
    for (let i = 0; i < text.length; i += size) {
      yield text.slice(i, i + size);
    }
    return;
  }

  const { modelKit, messages, tools, maxTokens, temperature, signal } = options;
  const { apiKey, baseUrl, model } = resolveByok(modelKit);
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    stream: true,
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
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM stream to ${endpoint} failed (${response.status}): ${response.statusText} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Parse a single SSE line; returns the content delta to yield, or undefined.
  // Throws the sentinel DONE to terminate the stream.
  const DONE = Symbol("done");
  const parseLine = (line: string): string | undefined => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return undefined;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") throw DONE;
    try {
      const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      return json.choices?.[0]?.delta?.content ?? undefined;
    } catch {
      return undefined; // ignore keep-alive / partial lines
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const delta = parseLine(line);
        if (delta) yield delta;
      }
    }
    // Flush any residual line not terminated by a trailing newline before EOF.
    if (buffer.trim()) {
      const delta = parseLine(buffer);
      if (delta) yield delta;
    }
  } catch (err) {
    if (err !== DONE) throw err;
  } finally {
    reader.releaseLock();
  }
}

/**
 * OpenAI-compatible embeddings call. Returns one vector per input, ordered to match `texts`.
 */
export async function embedWithModelKit(
  modelKit: ModelKit,
  texts: string[],
  signal?: AbortSignal
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const { apiKey, baseUrl, model } = resolveByok(modelKit);
  const endpoint = `${baseUrl.replace(/\/$/, "")}/embeddings`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
    signal
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Embeddings call to ${endpoint} failed (${response.status}): ${response.statusText} ${text}`);
  }

  const payload = (await response.json()) as { data?: Array<{ index?: number; embedding: number[] }> };
  const data = payload.data ?? [];
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((d) => d.embedding);
}
