/** Cosine similarity of two equal-length numeric vectors. Returns 0 if either is zero-length or all zeros. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Split Markdown into chunks no longer than `maxChars`, preferring blank-line
 * (paragraph) boundaries and hard-splitting any paragraph that is itself too long.
 */
export function chunkMarkdown(text: string, maxChars = 1200): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length === 0) {
      current = para;
    } else if (current.length + 2 + para.length <= maxChars) {
      current = `${current}\n\n${para}`;
    } else {
      flush();
      current = para;
    }
  }
  flush();
  return chunks;
}

/** Rank `items` (each carrying a `vector`) by cosine similarity to `query`, returning the top `k`. */
export function topKBySimilarity<T extends { vector: number[] }>(
  query: number[],
  items: T[],
  k: number
): Array<{ item: T; score: number }> {
  return items
    .map((item) => ({ item, score: cosineSimilarity(query, item.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
