import { afterEach, describe, expect, it, vi } from "vitest";
import { embedWithModelKit, streamLlmWithModelKit } from "./llm.js";
import type { ModelKit } from "./types.js";

const kit: ModelKit = {
  id: "mk_embed",
  name: "embed",
  type: "byok",
  providerId: "openai",
  model: "text-embedding-3-small",
  config: { provider: "openai", baseUrl: "https://api.example.com/v1", model: "text-embedding-3-small", apiKey: "sk-test" },
  metadata: { createdAt: "", testedAt: "", costTier: "low", performanceProfile: "fast" }
};

afterEach(() => vi.restoreAllMocks());

describe("embedWithModelKit", () => {
  it("posts to /embeddings and returns vectors ordered by index", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] }
        ] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const vectors = await embedWithModelKit(kit, ["a", "b"]);

    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/embeddings");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: "text-embedding-3-small",
      input: ["a", "b"]
    });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500, statusText: "err" })));
    await expect(embedWithModelKit(kit, ["a"])).rejects.toThrow(/embeddings/);
  });
});

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) {
        const payload = c === "[DONE]" ? "[DONE]" : JSON.stringify({ choices: [{ delta: { content: c } }] });
        controller.enqueue(enc.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("streamLlmWithModelKit", () => {
  const chatKit: ModelKit = {
    id: "mk_chat", name: "chat", type: "byok", providerId: "deepseek",
    model: "deepseek-chat",
    config: { provider: "deepseek", baseUrl: "https://api.example.com/v1", model: "deepseek-chat", apiKey: "sk-test" },
    metadata: { createdAt: "", testedAt: "", costTier: "low", performanceProfile: "fast" }
  };

  it("yields content deltas and posts stream:true", async () => {
    const fetchMock = vi.fn(async () => sseResponse(["Hel", "lo", " world", "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);

    const out: string[] = [];
    for await (const delta of streamLlmWithModelKit({ modelKit: chatKit, messages: [{ role: "user", content: "hi" }] })) {
      out.push(delta);
    }

    expect(out.join("")).toBe("Hello world");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ model: "deepseek-chat", stream: true });
  });

  it("fake mode yields canned text without fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("REPOHELM_FAKE_MODELS", "1");
    vi.stubEnv("REPOHELM_FAKE_STREAM_TEXT", "abc");

    const out: string[] = [];
    for await (const d of streamLlmWithModelKit({ modelKit: chatKit, messages: [] })) out.push(d);

    expect(out.join("")).toBe("abc");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
