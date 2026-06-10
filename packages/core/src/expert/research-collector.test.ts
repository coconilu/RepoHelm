import { describe, expect, it, vi } from "vitest";
import { ResearchCollector } from "./research-collector.js";

function createMockService() {
  return {
    searchProjectKnowledge: vi.fn().mockResolvedValue([]),
    getUserPreferences: vi.fn().mockResolvedValue([]),
    getFailurePatterns: vi.fn().mockResolvedValue([]),
  };
}

describe("ResearchCollector", () => {
  it("应该创建调研结果并关联到任务", () => {
    const service = createMockService();
    const collector = new ResearchCollector(service as any);
    const result = collector.createResult({
      type: "reusable_function",
      title: "useAuth hook",
      summary: "认证相关的 React hook",
      filePath: "src/hooks/useAuth.ts",
      codeSnippet: "export function useAuth() { ... }",
      lineRange: { start: 1, end: 30 },
      taskId: "task-1",
    });
    expect(result.id).toBeDefined();
    expect(result.type).toBe("reusable_function");
    expect(result.taskId).toBe("task-1");
    expect(result.filePath).toBe("src/hooks/useAuth.ts");
  });

  it("应该分类管理调研结果", () => {
    const service = createMockService();
    const collector = new ResearchCollector(service as any);
    collector.createResult({ type: "reusable_function", title: "函数 A", summary: "可复用函数", taskId: "task-1" });
    collector.createResult({ type: "existing_logic", title: "现有逻辑 B", summary: "当前行为" });
    collector.createResult({ type: "proposed_change", title: "建议变更 C", summary: "未来逻辑", proposedLogic: "改为使用...", reasoning: "因为...", taskId: "task-2" });
    expect(collector.getByType("reusable_function")).toHaveLength(1);
    expect(collector.getByType("proposed_change")).toHaveLength(1);
    expect(collector.getAll()).toHaveLength(3);
  });

  it("应该按任务 ID 过滤调研结果", () => {
    const service = createMockService();
    const collector = new ResearchCollector(service as any);
    collector.createResult({ type: "related_code", title: "任务 1 的代码", summary: "...", taskId: "task-1" });
    collector.createResult({ type: "related_code", title: "任务 2 的代码", summary: "...", taskId: "task-2" });
    collector.createResult({ type: "related_code", title: "全局代码", summary: "..." });
    expect(collector.getByTask("task-1")).toHaveLength(1);
    expect(collector.getGlobal()).toHaveLength(1);
  });
});
