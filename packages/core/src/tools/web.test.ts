import { describe, expect, it } from "vitest";
import { buildWebToolHandlers, WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from "./web.js";

function okResponse(body: string, contentType = "text/plain"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

describe("buildWebToolHandlers", () => {
  it("denies web_fetch when disabled (the default)", async () => {
    const web = buildWebToolHandlers();

    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "https://example.com" }));

    expect(result.ok).toBe(false);
    expect(String(result.error ?? "")).toMatch(/disabled|not enabled|关闭|未启用/i);
  });

  it("fetches a URL and returns its text content when enabled", async () => {
    const web = buildWebToolHandlers({
      enabled: true,
      fetchImpl: async () => okResponse("hello from the web")
    });

    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "https://example.com" }));

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toContain("hello from the web");
  });

  it("truncates fetched content to maxBytes", async () => {
    const web = buildWebToolHandlers({
      enabled: true,
      maxBytes: 5,
      fetchImpl: async () => okResponse("0123456789")
    });

    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "https://example.com" }));

    expect(result.ok).toBe(true);
    expect(result.content.length).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("rejects non-http(s) URLs even when enabled", async () => {
    const web = buildWebToolHandlers({ enabled: true, fetchImpl: async () => okResponse("x") });

    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "file:///etc/passwd" }));

    expect(result.ok).toBe(false);
    expect(String(result.error ?? "")).toMatch(/http/i);
  });

  it("reports a non-configured web_search instead of pretending", async () => {
    const web = buildWebToolHandlers({ enabled: true });

    const result = JSON.parse(await web.handle(WEB_SEARCH_TOOL, { query: "repohelm" }));

    expect(result.ok).toBe(false);
    expect(String(result.error ?? "")).toMatch(/configured|backend|provider/i);
  });

  it("delegates web_search to the injected searchImpl", async () => {
    const web = buildWebToolHandlers({
      enabled: true,
      searchImpl: async (query) => [{ title: `result for ${query}`, url: "https://example.com" }]
    });

    const result = JSON.parse(await web.handle(WEB_SEARCH_TOOL, { query: "repohelm" }));

    expect(result.ok).toBe(true);
    expect(result.results[0].title).toBe("result for repohelm");
  });
});
