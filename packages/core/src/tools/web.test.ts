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

  it("aborts the response body once maxBytes is reached instead of draining it", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 50) {
          controller.close();
          return;
        }
        controller.enqueue(new TextEncoder().encode("AAAAA")); // 5 bytes per chunk
      },
      cancel() {
        cancelled = true;
      }
    });
    const web = buildWebToolHandlers({
      enabled: true,
      maxBytes: 7,
      fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": "text/plain" } })
    });

    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "https://example.com" }));

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(10);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(50);
  });

  it("rejects non-http(s) URLs even when enabled", async () => {
    const web = buildWebToolHandlers({ enabled: true, fetchImpl: async () => okResponse("x") });

    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "file:///etc/passwd" }));

    expect(result.ok).toBe(false);
    expect(String(result.error ?? "")).toMatch(/http/i);
  });

  it("blocks loopback, link-local and private IP literals by default (SSRF)", async () => {
    for (const host of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "192.168.1.1", "172.16.0.1", "[::1]"]) {
      let called = false;
      const web = buildWebToolHandlers({
        enabled: true,
        fetchImpl: async () => {
          called = true;
          return okResponse("secret");
        }
      });
      const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: `http://${host}/latest/meta-data` }));
      expect(result.ok, host).toBe(false);
      expect(called, host).toBe(false);
      expect(String(result.error ?? ""), host).toMatch(/blocked|internal|private|loopback|not allowed/i);
    }
  });

  it("blocks IPv4-mapped IPv6 literals (hex and dotted forms)", async () => {
    for (const host of [
      "[::ffff:127.0.0.1]",
      "[::ffff:7f00:1]",
      "[::ffff:169.254.169.254]",
      "[::ffff:a9fe:a9fe]",
      "[::ffff:10.0.0.5]",
      "[::ffff:a00:5]"
    ]) {
      let called = false;
      const web = buildWebToolHandlers({
        enabled: true,
        fetchImpl: async () => {
          called = true;
          return okResponse("LEAKED");
        }
      });
      const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: `http://${host}:8080/` }));
      expect(result.ok, host).toBe(false);
      expect(called, host).toBe(false);
    }
  });

  it("blocks the localhost hostname", async () => {
    const web = buildWebToolHandlers({ enabled: true, fetchImpl: async () => okResponse("x") });
    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "http://localhost:8080/" }));
    expect(result.ok).toBe(false);
  });

  it("permits loopback only when allowLoopback is set, still blocking the metadata IP", async () => {
    const web = buildWebToolHandlers({ enabled: true, allowLoopback: true, fetchImpl: async () => okResponse("local-ok") });

    const loop = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "http://127.0.0.1:4399/docs" }));
    expect(loop.ok).toBe(true);
    expect(loop.content).toContain("local-ok");

    const meta = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "http://169.254.169.254/" }));
    expect(meta.ok).toBe(false);
  });

  it("allows a public IP literal", async () => {
    let called = false;
    const web = buildWebToolHandlers({
      enabled: true,
      fetchImpl: async () => {
        called = true;
        return okResponse("public");
      }
    });
    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "http://93.184.216.34/" }));
    expect(result.ok).toBe(true);
    expect(called).toBe(true);
  });

  it("blocks a hostname that resolves to a private IP (DNS rebinding guard)", async () => {
    let called = false;
    const web = buildWebToolHandlers({
      enabled: true,
      resolveHost: async () => ["10.1.2.3"],
      fetchImpl: async () => {
        called = true;
        return okResponse("x");
      }
    });
    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "https://evil.example.com/" }));
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("allows a hostname that resolves to a public IP", async () => {
    const web = buildWebToolHandlers({
      enabled: true,
      resolveHost: async () => ["93.184.216.34"],
      fetchImpl: async () => okResponse("ok-public")
    });
    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "https://good.example.com/" }));
    expect(result.ok).toBe(true);
    expect(result.content).toContain("ok-public");
  });

  it("re-validates redirect targets and blocks a redirect to an internal address", async () => {
    let calls = 0;
    const web = buildWebToolHandlers({
      enabled: true,
      fetchImpl: async (input) => {
        calls += 1;
        const u = String(input);
        if (u.includes("169.254.169.254")) {
          // Should never be fetched — the redirect target must be blocked first.
          return okResponse("LEAKED");
        }
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
      }
    });

    const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: "http://93.184.216.34/redirect" }));

    expect(result.ok).toBe(false);
    expect(calls).toBe(1); // only the first (public) hop was fetched
    expect(String(result.error ?? "")).toMatch(/blocked|internal|private/i);
  });

  it("pins the connection to the validated IP, closing the rebinding window", async () => {
    const http = await import("node:http");
    let seenHost = "";
    const server = http.createServer((req, res) => {
      seenHost = req.headers.host ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pinned-ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      // "pinned.test" does not resolve via real DNS; only the validated IP from
      // resolveHost lets the request connect — proving the connection is pinned
      // to the address we checked, not a second (rebindable) resolution.
      const web = buildWebToolHandlers({ enabled: true, allowLoopback: true, resolveHost: async () => ["127.0.0.1"] });
      const result = JSON.parse(await web.handle(WEB_FETCH_TOOL, { url: `http://pinned.test:${port}/` }));
      expect(result.ok).toBe(true);
      expect(result.content).toContain("pinned-ok");
      expect(seenHost).toBe(`pinned.test:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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
