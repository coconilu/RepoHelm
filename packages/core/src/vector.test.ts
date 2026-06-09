import { describe, expect, it } from "vitest";
import { cosineSimilarity, chunkMarkdown, topKBySimilarity } from "./vector.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("returns 0 when either vector is all zeros", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("chunkMarkdown", () => {
  it("keeps short text as a single chunk", () => {
    expect(chunkMarkdown("hello world", 100)).toEqual(["hello world"]);
  });

  it("splits on paragraph boundaries and respects maxChars", () => {
    const text = ["a".repeat(60), "b".repeat(60)].join("\n\n");
    const chunks = chunkMarkdown(text, 80);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("a".repeat(60));
    expect(chunks[1]).toBe("b".repeat(60));
  });

  it("hard-splits a single oversized paragraph", () => {
    const chunks = chunkMarkdown("x".repeat(250), 100);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });
});

describe("topKBySimilarity", () => {
  it("ranks by descending similarity and limits to k", () => {
    const items = [
      { id: "a", vector: [1, 0] },
      { id: "b", vector: [0, 1] },
      { id: "c", vector: [0.9, 0.1] }
    ];
    const ranked = topKBySimilarity([1, 0], items, 2);
    expect(ranked.map((r) => r.item.id)).toEqual(["a", "c"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
