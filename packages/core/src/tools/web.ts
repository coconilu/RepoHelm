import type { LlmToolSpec } from "../llm.js";

export const WEB_FETCH_TOOL = "web_fetch";
export const WEB_SEARCH_TOOL = "web_search";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebToolOptions {
  /** Master switch. Defaults to disabled — both tools refuse until turned on. */
  enabled?: boolean;
  /** Injected fetch (tests / proxies). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Pluggable search backend; absent means web_search is "not configured". */
  searchImpl?: (query: string) => Promise<WebSearchResult[]>;
  /** Max bytes of body text kept in the tool result. */
  maxBytes?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/**
 * Network tools for worker sub-agents: fetch a URL's text, or run a web search
 * via a pluggable backend. Disabled by default (network egress is opt-in via the
 * security posture); `web_fetch` only allows http/https URLs.
 */
export const webToolSpecs: LlmToolSpec[] = [
  {
    type: "function",
    function: {
      name: WEB_FETCH_TOOL,
      description:
        "Fetch the text content of an http(s) URL (e.g. documentation or an API reference). Returns the response status and body text (truncated).",
      parameters: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: {
          url: { type: "string", description: "Absolute http(s) URL to fetch." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: WEB_SEARCH_TOOL,
      description: "Search the web for a query and return a list of result titles and URLs.",
      parameters: {
        type: "object",
        required: ["query"],
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Search query." }
        }
      }
    }
  }
];

export interface WebToolHandler {
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

const DEFAULT_MAX_BYTES = 100_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export function buildWebToolHandlers(options: WebToolOptions = {}): WebToolHandler {
  const enabled = options.enabled ?? false;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchUrl(rawUrl: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return JSON.stringify({ ok: false, error: `invalid URL: ${rawUrl}` });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return JSON.stringify({ ok: false, error: `only http(s) URLs are allowed, got ${url.protocol}` });
    }
    if (!fetchImpl) {
      return JSON.stringify({ ok: false, error: "no fetch implementation available" });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: "follow" });
      const body = await response.text();
      const truncated = body.length > maxBytes;
      return JSON.stringify({
        ok: response.ok,
        url: url.toString(),
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        truncated,
        content: truncated ? body.slice(0, maxBytes) : body
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ ok: false, url: url.toString(), error: message });
    } finally {
      clearTimeout(timer);
    }
  }

  async function search(query: string): Promise<string> {
    if (!options.searchImpl) {
      return JSON.stringify({ ok: false, error: "web_search has no configured search backend/provider" });
    }
    try {
      const results = await options.searchImpl(query);
      return JSON.stringify({ ok: true, query, results });
    } catch (error) {
      return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    async handle(name, args) {
      if (!enabled) {
        return JSON.stringify({ ok: false, error: "web access is disabled" });
      }
      if (name === WEB_FETCH_TOOL) {
        const url = String(args.url ?? "").trim();
        if (!url) return JSON.stringify({ ok: false, error: "url is required" });
        return fetchUrl(url);
      }
      if (name === WEB_SEARCH_TOOL) {
        const query = String(args.query ?? "").trim();
        if (!query) return JSON.stringify({ ok: false, error: "query is required" });
        return search(query);
      }
      return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
    }
  };
}
