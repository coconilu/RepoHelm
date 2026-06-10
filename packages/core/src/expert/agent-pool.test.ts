import { describe, expect, it } from "vitest";
import { AgentPool } from "./agent-pool.js";
import type { AgentPrototype, DynamicAgent } from "./types.js";

describe("AgentPool", () => {
  it("应该注册和列出原型", () => {
    const pool = new AgentPool();
    const proto: AgentPrototype = {
      id: "coder",
      name: "Coder",
      role: "代码实现",
      capabilities: ["coding", "refactoring"],
      systemPromptTemplate: "你是一个编码专家...",
      isBuiltIn: true,
    };
    pool.registerPrototype(proto);
    const prototypes = pool.listPrototypes();
    expect(prototypes).toHaveLength(1);
    expect(prototypes[0].id).toBe("coder");
  });

  it("应该根据能力匹配 Agent", () => {
    const pool = new AgentPool();
    pool.registerPrototype({
      id: "coder",
      name: "Coder",
      role: "代码实现",
      capabilities: ["coding"],
      systemPromptTemplate: "...",
      isBuiltIn: true,
    });
    pool.registerPrototype({
      id: "reviewer",
      name: "Reviewer",
      role: "代码审查",
      capabilities: ["review"],
      systemPromptTemplate: "...",
      isBuiltIn: true,
    });
    const matched = pool.matchAgents(["coding"]);
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe("coder");
  });

  it("应该创建动态 Agent", () => {
    const pool = new AgentPool();
    const dynamic = pool.createDynamicAgent({
      name: "前端组件专家",
      role: "React 组件开发",
      capabilities: ["react", "typescript", "tailwind"],
      systemPromptTemplate: "你是 React 组件专家...",
      createdBy: "supervisor",
      taskId: "task-1",
    });
    expect(dynamic.id).toBeDefined();
    expect(dynamic.isBuiltIn).toBe(false);
    expect(dynamic.createdBy).toBe("supervisor");
    expect(dynamic.taskId).toBe("task-1");
  });

  it("应该限制动态 Agent 数量", () => {
    const pool = new AgentPool({ maxDynamicAgents: 2 });
    pool.createDynamicAgent({ name: "A1", role: "r1", capabilities: [], systemPromptTemplate: "...", createdBy: "s" });
    pool.createDynamicAgent({ name: "A2", role: "r2", capabilities: [], systemPromptTemplate: "...", createdBy: "s" });
    expect(() => pool.createDynamicAgent({ name: "A3", role: "r3", capabilities: [], systemPromptTemplate: "...", createdBy: "s" })).toThrow("动态 Agent 数量已达上限");
  });

  it("应该回收动态 Agent", () => {
    const pool = new AgentPool();
    const dynamic = pool.createDynamicAgent({ name: "临时", role: "r", capabilities: [], systemPromptTemplate: "...", createdBy: "s", taskId: "task-1" });
    pool.recycleDynamicAgent(dynamic.id);
    expect(pool.listDynamicAgents()).toHaveLength(0);
  });

  it("应该生成快照", () => {
    const pool = new AgentPool();
    pool.registerPrototype({ id: "coder", name: "Coder", role: "编码", capabilities: ["coding"], systemPromptTemplate: "...", isBuiltIn: true });
    const snapshot = pool.getSnapshot();
    expect(snapshot.prototypes).toHaveLength(1);
    expect(snapshot.dynamicAgents).toHaveLength(0);
    expect(snapshot.activeAgents).toHaveLength(0);
  });
});
