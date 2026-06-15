import { isIP } from "node:net";
import type { LlmToolSpec } from "../llm.js";

export const WEB_FETCH_TOOL = "web_fetch";
export const WEB_SEARCH_TOOL = "web_search";

type HostClass = "public" | "loopback" | "private";

/**
 * Expand an IPv6 literal to its 8 16-bit groups, handling `::` compression and a
 * trailing embedded IPv4 (e.g. `::ffff:127.0.0.1`). Returns null if not parseable.
 */
function expandIpv6(addr: string): number[] | null {
  const ip = addr.toLowerCase().split("%")[0]!; // drop any zone id
  if (ip.split("::").length > 2) return null;
  const [head, tail] = ip.split("::");
  const toGroups = (part: string): number[] => {
    if (!part) return [];
    const tokens = part.split(":");
    const groups: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      if (tok.includes(".")) {
        // Embedded IPv4 → two 16-bit groups.
        const b = tok.split(".").map(Number);
        if (b.length !== 4 || b.some((n) => !(n >= 0 && n <= 255))) return [NaN];
        groups.push(((b[0]! << 8) | b[1]!) & 0xffff, ((b[2]! << 8) | b[3]!) & 0xffff);
      } else {
        const n = parseInt(tok, 16);
        if (Number.isNaN(n) || n < 0 || n > 0xffff) return [NaN];
        groups.push(n);
      }
    }
    return groups;
  };
  const headGroups = toGroups(head ?? "");
  const tailGroups = tail === undefined ? [] : toGroups(tail);
  if (headGroups.some(Number.isNaN) || tailGroups.some(Number.isNaN)) return null;
  const total = headGroups.length + tailGroups.length;
  if (tail === undefined) {
    return total === 8 ? headGroups : null; // no "::" → must be full
  }
  if (total > 7) return null; // "::" must stand for ≥1 zero group
  return [...headGroups, ...Array(8 - total).fill(0), ...tailGroups];
}

/** Classify an IP literal as public, loopback, or otherwise-internal (SSRF). */
function classifyIp(ip: string): HostClass {
  const v = isIP(ip);
  if (v === 4) return classifyV4(ip);
  if (v === 6) {
    const h = expandIpv6(ip);
    if (!h) return "private"; // unpar-seable IPv6 → fail closed
    // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) → classify the
    // embedded IPv4, so e.g. ::ffff:127.0.0.1 / ::ffff:7f00:1 can't slip through.
    const firstFiveZero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
    if (firstFiveZero && (h[5] === 0xffff || h[5] === 0)) {
      if (h[6] === 0 && h[7] === 1) return "loopback"; // ::1
      if (h[6] === 0 && h[7] === 0) return "public"; // :: (unspecified) — treat as non-internal literal
      const v4 = `${h[6]! >> 8}.${h[6]! & 0xff}.${h[7]! >> 8}.${h[7]! & 0xff}`;
      return classifyV4(v4);
    }
    if ((h[0]! & 0xffc0) === 0xfe80) return "private"; // fe80::/10 link-local
    if ((h[0]! & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique-local
    return "public";
  }
  return "public";
}

function classifyV4(ip: string): HostClass {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (a === undefined || b === undefined) return "public";
  if (a === 127 || (a === 0 && b === 0)) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "private"; // link-local incl. cloud metadata 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT
  return "public";
}

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
  /** Allow loopback/localhost targets (e.g. local dev services). Default false. */
  allowLoopback?: boolean;
  /** Resolve a hostname to IPs so DNS names pointing at internal addresses are
   *  blocked (DNS-rebinding guard). Absent skips DNS resolution. */
  resolveHost?: (hostname: string) => Promise<string[]>;
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
const MAX_REDIRECTS = 5;

/**
 * Read a response body up to `maxBytes`, then stop and cancel the stream so a
 * huge response is never fully downloaded into memory. `maxBytes` is a real
 * resource ceiling, not just a slice of an already-buffered body. Falls back to
 * a buffered read (still sliced) when the body isn't a readable stream.
 */
async function readCapped(response: Response, maxBytes: number): Promise<{ content: string; truncated: boolean }> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    return { content: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      content += decoder.decode(value, { stream: true });
      if (content.length >= maxBytes) {
        truncated = true;
        content = content.slice(0, maxBytes);
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  return { content, truncated };
}

export function buildWebToolHandlers(options: WebToolOptions = {}): WebToolHandler {
  const enabled = options.enabled ?? false;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const allowLoopback = options.allowLoopback ?? false;

  // Decide whether a host may be fetched. Returns a block reason or null.
  async function blockReason(hostname: string): Promise<string | null> {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host === "ip6-localhost" || host.endsWith(".localhost")) {
      return allowLoopback ? null : "blocked: loopback host (localhost)";
    }
    if (host.endsWith(".local") || host.endsWith(".internal")) {
      return "blocked: internal host";
    }
    const verdict = (klass: HostClass): string | null => {
      if (klass === "private") return "blocked: internal/private address";
      if (klass === "loopback") return allowLoopback ? null : "blocked: loopback address";
      return null;
    };
    if (isIP(host)) {
      return verdict(classifyIp(host));
    }
    if (options.resolveHost) {
      let addrs: string[] = [];
      try {
        addrs = await options.resolveHost(host);
      } catch {
        return "blocked: host did not resolve";
      }
      for (const addr of addrs) {
        const reason = verdict(classifyIp(addr));
        if (reason) return `${reason} (${host} → ${addr})`;
      }
    }
    return null;
  }

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
      // Follow redirects manually so each hop's host is re-validated — a public
      // URL must not be able to redirect the worker to an internal address.
      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const blocked = await blockReason(current.hostname);
        if (blocked) {
          return JSON.stringify({ ok: false, url: current.toString(), error: blocked });
        }
        const response = await fetchImpl(current, { signal: controller.signal, redirect: "manual" });
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          current = new URL(location, current);
          continue;
        }
        const { content, truncated } = await readCapped(response, maxBytes);
        return JSON.stringify({
          ok: response.ok,
          url: current.toString(),
          status: response.status,
          contentType: response.headers.get("content-type") ?? undefined,
          truncated,
          content
        });
      }
      return JSON.stringify({ ok: false, url: url.toString(), error: "too many redirects" });
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
