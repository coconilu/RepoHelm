import { describe, expect, it, vi } from "vitest";
import { TDDPipeline } from "./tdd-pipeline.js";
import type { AcceptanceTest, ExpertTask } from "./types.js";

function makeAcceptanceTest(overrides: Partial<AcceptanceTest> = {}): AcceptanceTest {
  return { id: "at-1", title: "用户登录测试", description: "用户输入正确的用户名密码后应成功登录", status: "confirmed", testType: "unit", relatedTaskIds: ["task-1"], userConfirmed: true, ...overrides };
}
function makeTask(overrides: Partial<ExpertTask> = {}): ExpertTask {
  return { id: "task-1", nodeId: "node-1", title: "实现登录功能", description: "实现用户名密码登录", type: "implementation", status: "pending", artifacts: [], ...overrides };
}

describe("TDDPipeline", () => {
  it("应该生成具体测试代码从验收用例", async () => {
    const agentInvoker = { invoke: vi.fn().mockResolvedValue({ content: "```ts\ntest('login', () => {})\n```", error: undefined }) };
    const testRunner = { run: vi.fn().mockResolvedValue({ passed: false, output: "1 failing" }) };
    const pipeline = new TDDPipeline({ agentInvoker: agentInvoker as any, testRunner: testRunner as any, maxIterations: 3 });
    const result = await pipeline.generateTest(makeAcceptanceTest(), makeTask());
    expect(agentInvoker.invoke).toHaveBeenCalledTimes(1);
    expect(result.generatedTestPath).toBeDefined();
    expect(result.status).toBe("generated");
  });

  it("应该在达到最大迭代次数后停止", async () => {
    const agentInvoker = { invoke: vi.fn().mockResolvedValue({ content: "code", error: undefined }) };
    const testRunner = { run: vi.fn().mockResolvedValue({ passed: false, output: "still failing" }) };
    const pipeline = new TDDPipeline({ agentInvoker: agentInvoker as any, testRunner: testRunner as any, maxIterations: 3 });
    const result = await pipeline.executeRedGreenCycle(makeAcceptanceTest({ status: "generated" }), makeTask());
    expect(result.iterations).toBe(3);
    expect(result.success).toBe(false);
    expect(testRunner.run).toHaveBeenCalledTimes(3);
  });

  it("应该在测试通过后立即停止迭代", async () => {
    const agentInvoker = { invoke: vi.fn().mockResolvedValue({ content: "fixed code", error: undefined }) };
    let callCount = 0;
    const testRunner = { run: vi.fn().mockImplementation(async () => { callCount++; return { passed: callCount >= 2, output: callCount >= 2 ? "all passing" : "1 failing" }; }) };
    const pipeline = new TDDPipeline({ agentInvoker: agentInvoker as any, testRunner: testRunner as any, maxIterations: 3 });
    const result = await pipeline.executeRedGreenCycle(makeAcceptanceTest({ status: "generated" }), makeTask());
    expect(result.iterations).toBe(2);
    expect(result.success).toBe(true);
  });

  it("应该在测试生成失败时回退", async () => {
    const agentInvoker = { invoke: vi.fn().mockResolvedValue({ content: "", error: "Failed" }) };
    const testRunner = { run: vi.fn() };
    const pipeline = new TDDPipeline({ agentInvoker: agentInvoker as any, testRunner: testRunner as any, maxIterations: 3 });
    const result = await pipeline.generateTest(makeAcceptanceTest(), makeTask());
    expect(result.status).toBe("failing");
  });
});
