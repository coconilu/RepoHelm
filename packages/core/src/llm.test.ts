import { afterEach, describe, expect, it, vi } from "vitest";
import { embedWithModelKit } from "./llm.js";
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
