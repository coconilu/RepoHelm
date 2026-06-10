import type { AcceptanceTest, ExpertTask } from "./types.js";

export interface TDDAgentInvoker {
  invoke(input: { systemPrompt: string; messages: Array<{ role: string; content: string }> }): Promise<{ content: string; error?: string }>;
}
export interface TDDTestRunner {
  run(input: { worktreePath: string; testPath: string; command: string }): Promise<{ passed: boolean; output: string }>;
}
export interface TDDPipelineOptions { agentInvoker: TDDAgentInvoker; testRunner: TDDTestRunner; maxIterations: number; }
export interface TestGenerationResult { status: AcceptanceTest["status"]; generatedTestPath?: string; error?: string; }
export interface RedGreenResult { iterations: number; success: boolean; finalTestStatus: AcceptanceTest["status"]; lastOutput: string; }

export class TDDPipeline {
  private agentInvoker: TDDAgentInvoker;
  private testRunner: TDDTestRunner;
  private maxIterations: number;

  constructor(options: TDDPipelineOptions) {
    this.agentInvoker = options.agentInvoker;
    this.testRunner = options.testRunner;
    this.maxIterations = options.maxIterations;
  }

  async generateTest(acceptanceTest: AcceptanceTest, task: ExpertTask): Promise<TestGenerationResult> {
    const systemPrompt = "你是测试工程师。根据验收用例生成具体的测试代码。只输出测试代码，使用 fenced code block 包裹。";
    const userContent = `验收用例：${acceptanceTest.title}\n${acceptanceTest.description}\n\n任务描述：${task.title}\n${task.description}\n\n请生成具体的测试代码。`;
    const result = await this.agentInvoker.invoke({ systemPrompt, messages: [{ role: "user", content: userContent }] });
    if (result.error || !result.content.trim()) return { status: "failing", error: result.error || "测试生成为空" };
    const testPath = `tests/${task.id}_${acceptanceTest.id}.test.ts`;
    return { status: "generated", generatedTestPath: testPath };
  }

  async executeRedGreenCycle(acceptanceTest: AcceptanceTest, task: ExpertTask): Promise<RedGreenResult> {
    let iterations = 0;
    for (let i = 0; i < this.maxIterations; i++) {
      iterations++;
      const implResult = await this.agentInvoker.invoke({
        systemPrompt: "你是工程师。根据测试失败信息修复代码使测试通过。",
        messages: [{ role: "user", content: `任务：${task.title}\n请实现代码使相关测试通过。` }],
      });
      if (implResult.error) continue;
      const testResult = await this.testRunner.run({ worktreePath: "", testPath: acceptanceTest.generatedTestPath || "", command: "npx vitest run" });
      if (testResult.passed) return { iterations, success: true, finalTestStatus: "passing", lastOutput: testResult.output };
    }
    return { iterations, success: false, finalTestStatus: "failing", lastOutput: "超过最大迭代次数" };
  }
}
