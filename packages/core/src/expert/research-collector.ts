import type { CodeResearchResult } from "./types.js";

export interface CreateResearchInput {
  type: CodeResearchResult["type"];
  title: string;
  summary: string;
  taskId?: string;
  filePath?: string;
  codeSnippet?: string;
  lineRange?: { start: number; end: number };
  proposedLogic?: string;
  reasoning?: string;
}

export class ResearchCollector {
  private results: Map<string, CodeResearchResult> = new Map();
  constructor(private service: any) {}

  createResult(input: CreateResearchInput): CodeResearchResult {
    const result: CodeResearchResult = {
      id: `research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      title: input.title,
      summary: input.summary,
      taskId: input.taskId,
      filePath: input.filePath,
      codeSnippet: input.codeSnippet,
      lineRange: input.lineRange,
      proposedLogic: input.proposedLogic,
      reasoning: input.reasoning,
    };
    this.results.set(result.id, result);
    return result;
  }

  getByType(type: CodeResearchResult["type"]): CodeResearchResult[] {
    return Array.from(this.results.values()).filter((r) => r.type === type);
  }

  getByTask(taskId: string): CodeResearchResult[] {
    return Array.from(this.results.values()).filter((r) => r.taskId === taskId);
  }

  getGlobal(): CodeResearchResult[] {
    return Array.from(this.results.values()).filter((r) => !r.taskId);
  }

  getAll(): CodeResearchResult[] {
    return Array.from(this.results.values());
  }

  clear(): void {
    this.results.clear();
  }
}
