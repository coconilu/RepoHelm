# 编排任务契约（Task Contract）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Quest 编排的每个 step 补一份结构化任务契约（objective / output format / boundaries / sources guidance / done criteria），由 planner 生成、落进 plan.md、执行时注入 worker prompt、并在 Web UI 计划审批视图展示。

**Architecture:** 新建 `task-contract.ts` 作为契约唯一事实源（类型解析、prompt 段落、plan.md 读写）。`types.ts` 给 `OrchestrationPlanStep` 加可选 `contract` 对象；`planning.ts` 让 planner LLM 生成契约；`quest-workspace.ts` 调 task-contract 渲染/解析 plan.md；`orchestrator.ts` 注入 worker prompt；`api.ts`/`App.tsx` 展示。契约整体可选 → 向后兼容老 quest。

**Tech Stack:** TypeScript ESM（`.js` 后缀导入）、vitest（core 单测）、Playwright（e2e）、React 19 + Tailwind v4（web）。`@repohelm/core` 必须先 build。

设计依据：`docs/superpowers/specs/2026-06-12-orchestration-task-contract-design.md`

---

## 文件结构

- **Create** `packages/core/src/task-contract.ts` — 契约唯一事实源：`TaskContract` 解析、worker prompt 段落、plan.md 契约行读写、最小契约工厂。
- **Create** `packages/core/src/task-contract.test.ts` — 上述纯函数单测。
- **Modify** `packages/core/src/types.ts:80-88` — 加 `TaskContract` 接口 + `OrchestrationPlanStep.contract?`。
- **Modify** `packages/core/src/planning.ts` — `PLAN_SYSTEM_PROMPT` schema/rules、`validatePlan` 解析 contract、`parsePlanFromResponse` fallback 填最小契约。
- **Create** `packages/core/src/planning.test.ts` — `generateOrchestrationPlan` 经 stub backend 验证 contract 解析/兜底。
- **Modify** `packages/core/src/quest-workspace.ts` — `renderPlanMarkdown`/`parsePlanMarkdown` 调 task-contract 写/读契约块。
- **Modify** `packages/core/src/orchestrator.ts` — `createSimplePlan` 填最小契约；`invokeWorkerAgent`/`executeApprovedPlan` 注入契约段。
- **Modify** `packages/core/src/orchestrator.test.ts` — plan.md round-trip 带 contract 的 step。
- **Modify** `apps/web/src/api.ts:87-94` — `OrchestrationPlanStep` 加 `contract?`。
- **Modify** `apps/web/src/App.tsx:1484-1496` — 计划视图渲染契约。
- **Modify** `e2e/`（新增或扩展一个 plan 用例）— 假 plan JSON 带 contract，断言 UI 渲染。

**无需改动**：`apps/server/src/index.ts` 的 `/api/quests/:id/plan` 直接 `context.json(plan)`，无输出 Zod，`contract` 自动透传。

---

## Task 1: 领域类型加 TaskContract

**Files:**
- Modify: `packages/core/src/types.ts:80-88`
- Modify: `apps/web/src/api.ts:87-94`

- [ ] **Step 1: 在 types.ts 加接口并扩展 step**

把 `packages/core/src/types.ts` 第 80-88 行的 `OrchestrationPlanStep` 替换为（在它前面插入 `TaskContract`）：

```ts
export interface TaskContract {
  outputFormat?: string;     // 产出格式（缺则回退到 step.expectedOutput）
  boundaries?: string;       // 边界 / 不要做什么
  sourcesGuidance?: string;  // 信息源与注意事项（纯文本）
  doneCriteria?: string;     // 完成判据（done 长什么样）
}

export interface OrchestrationPlanStep {
  id: string;
  description: string;
  agentId: string;
  agentName: string;
  dependencies: string[];
  expectedOutput: string;
  targetProjectId?: string;
  contract?: TaskContract;
}
```

`index.ts` 已 `export * from "./types.js"`，自动 re-export，无需改。

- [ ] **Step 2: 在 api.ts 同步前端类型**

把 `apps/web/src/api.ts` 第 87-94 行的 `OrchestrationPlanStep` 替换为（前面插入 `TaskContract`）：

```ts
export interface TaskContract {
  outputFormat?: string;
  boundaries?: string;
  sourcesGuidance?: string;
  doneCriteria?: string;
}

export interface OrchestrationPlanStep {
  id: string;
  description: string;
  agentId: string;
  agentName: string;
  dependencies: string[];
  expectedOutput: string;
  contract?: TaskContract;
}
```

- [ ] **Step 3: typecheck 验证类型编译**

Run: `pnpm --filter @repohelm/core build`
Expected: 编译通过，无类型错误。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/types.ts apps/web/src/api.ts
git commit -m "Add TaskContract type to orchestration plan step"
```

---

## Task 2: task-contract.ts 模块（纯函数 + 单测）

**Files:**
- Create: `packages/core/src/task-contract.ts`
- Test: `packages/core/src/task-contract.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/task-contract.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  resolveContract,
  renderContractSection,
  minimalContract,
  renderContractMarkdownLines,
  parseContractFromBlock
} from "./task-contract.js";
import type { OrchestrationPlanStep } from "./types.js";

function step(overrides: Partial<OrchestrationPlanStep> = {}): OrchestrationPlanStep {
  return {
    id: "step_1",
    description: "Implement feature A",
    agentId: "coder",
    agentName: "Coder",
    dependencies: [],
    expectedOutput: "Source code for A",
    ...overrides
  };
}

describe("resolveContract", () => {
  it("falls back to expectedOutput when no contract", () => {
    const r = resolveContract(step());
    expect(r.objective).toBe("Implement feature A");
    expect(r.outputFormat).toBe("Source code for A");
    expect(r.boundaries).toBeUndefined();
    expect(r.doneCriteria).toBeUndefined();
  });

  it("uses contract fields when present", () => {
    const r = resolveContract(
      step({
        contract: {
          outputFormat: "A diff",
          boundaries: "Do not touch auth",
          sourcesGuidance: "See README",
          doneCriteria: "Tests pass"
        }
      })
    );
    expect(r.outputFormat).toBe("A diff");
    expect(r.boundaries).toBe("Do not touch auth");
    expect(r.sourcesGuidance).toBe("See README");
    expect(r.doneCriteria).toBe("Tests pass");
  });

  it("treats blank contract strings as absent", () => {
    const r = resolveContract(step({ contract: { boundaries: "   ", doneCriteria: "" } }));
    expect(r.boundaries).toBeUndefined();
    expect(r.doneCriteria).toBeUndefined();
    expect(r.outputFormat).toBe("Source code for A");
  });
});

describe("renderContractSection", () => {
  it("omits absent fields and the upstream section when no deps", () => {
    const out = renderContractSection(resolveContract(step()), []);
    expect(out).toContain("## Task Contract");
    expect(out).toContain("- Objective: Implement feature A");
    expect(out).toContain("- Expected output: Source code for A");
    expect(out).not.toContain("- Boundaries:");
    expect(out).not.toContain("## Upstream results");
  });

  it("renders present fields and upstream results", () => {
    const out = renderContractSection(
      resolveContract(step({ contract: { boundaries: "No auth", doneCriteria: "Green tests" } })),
      [
        { stepId: "step_0", result: "did setup" },
        { stepId: "step_x", result: "" }
      ]
    );
    expect(out).toContain("- Boundaries: No auth");
    expect(out).toContain("- Done when: Green tests");
    expect(out).toContain("## Upstream results");
    expect(out).toContain("- step_0: did setup");
    expect(out).not.toContain("- step_x:");
  });
});

describe("minimalContract", () => {
  it("uses expectedOutput as done criteria", () => {
    expect(minimalContract("Implementation artifacts")).toEqual({
      doneCriteria: "Implementation artifacts"
    });
  });
});

describe("plan.md contract block round-trip", () => {
  it("renders only present fields and parses them back", () => {
    const lines = renderContractMarkdownLines(
      step({
        contract: {
          outputFormat: "A diff",
          boundaries: "No auth\nchanges",
          doneCriteria: "Tests pass"
        }
      })
    );
    const block = lines.join("\n");
    expect(block).toContain("- **Output Format**: A diff");
    expect(block).toContain("- **Boundaries**: No auth changes"); // newline collapsed
    expect(block).toContain("- **Done Criteria**: Tests pass");
    expect(block).not.toContain("Sources Guidance");

    const parsed = parseContractFromBlock(block);
    expect(parsed).toEqual({
      outputFormat: "A diff",
      boundaries: "No auth changes",
      doneCriteria: "Tests pass"
    });
  });

  it("returns no lines and undefined when contract is absent", () => {
    expect(renderContractMarkdownLines(step())).toEqual([]);
    expect(parseContractFromBlock("- **Agent**: Coder (`coder`)")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core test -t "resolveContract"`
Expected: FAIL（`Cannot find module './task-contract.js'`）。

- [ ] **Step 3: 实现 task-contract.ts**

创建 `packages/core/src/task-contract.ts`：

```ts
import type { OrchestrationPlanStep, TaskContract } from "./types.js";

export interface ResolvedContract {
  objective: string;
  outputFormat: string;
  boundaries?: string;
  sourcesGuidance?: string;
  doneCriteria?: string;
}

export interface DependencyResult {
  stepId: string;
  result: string;
}

/** Collapse newlines so a value stays on one plan.md metadata line. */
function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").trim();
}

function clean(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Merge step fields + contract into a unified 5-element view. Never throws. */
export function resolveContract(step: OrchestrationPlanStep): ResolvedContract {
  const c = step.contract;
  return {
    objective: step.description,
    outputFormat: clean(c?.outputFormat) ?? step.expectedOutput,
    boundaries: clean(c?.boundaries),
    sourcesGuidance: clean(c?.sourcesGuidance),
    doneCriteria: clean(c?.doneCriteria)
  };
}

/** Build the structured contract section injected into a worker's prompt. */
export function renderContractSection(resolved: ResolvedContract, deps: DependencyResult[]): string {
  const lines: string[] = ["## Task Contract", `- Objective: ${resolved.objective}`];
  if (resolved.outputFormat) lines.push(`- Expected output: ${resolved.outputFormat}`);
  if (resolved.boundaries) lines.push(`- Boundaries: ${resolved.boundaries}`);
  if (resolved.sourcesGuidance) lines.push(`- Sources & notes: ${resolved.sourcesGuidance}`);
  if (resolved.doneCriteria) lines.push(`- Done when: ${resolved.doneCriteria}`);
  const realDeps = deps.filter((d) => d.result);
  if (realDeps.length > 0) {
    lines.push("## Upstream results");
    for (const d of realDeps) lines.push(`- ${d.stepId}: ${d.result}`);
  }
  return lines.join("\n");
}

/** Minimal contract for code-generated (simple/fallback) plans. */
export function minimalContract(expectedOutput: string): TaskContract {
  return { doneCriteria: expectedOutput };
}

/** plan.md metadata lines for a step's contract (only present fields). */
export function renderContractMarkdownLines(step: OrchestrationPlanStep): string[] {
  const c = step.contract;
  if (!c) return [];
  const lines: string[] = [];
  if (clean(c.outputFormat)) lines.push(`- **Output Format**: ${oneLine(c.outputFormat!)}`);
  if (clean(c.boundaries)) lines.push(`- **Boundaries**: ${oneLine(c.boundaries!)}`);
  if (clean(c.sourcesGuidance)) lines.push(`- **Sources Guidance**: ${oneLine(c.sourcesGuidance!)}`);
  if (clean(c.doneCriteria)) lines.push(`- **Done Criteria**: ${oneLine(c.doneCriteria!)}`);
  return lines;
}

/** Parse a step's metadata block back into a TaskContract (undefined if none). */
export function parseContractFromBlock(block: string): TaskContract | undefined {
  const outputFormat = block.match(/- \*\*Output Format\*\*: (.+)/)?.[1]?.trim();
  const boundaries = block.match(/- \*\*Boundaries\*\*: (.+)/)?.[1]?.trim();
  const sourcesGuidance = block.match(/- \*\*Sources Guidance\*\*: (.+)/)?.[1]?.trim();
  const doneCriteria = block.match(/- \*\*Done Criteria\*\*: (.+)/)?.[1]?.trim();
  if (!outputFormat && !boundaries && !sourcesGuidance && !doneCriteria) {
    return undefined;
  }
  const contract: TaskContract = {};
  if (outputFormat) contract.outputFormat = outputFormat;
  if (boundaries) contract.boundaries = boundaries;
  if (sourcesGuidance) contract.sourcesGuidance = sourcesGuidance;
  if (doneCriteria) contract.doneCriteria = doneCriteria;
  return contract;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/core test -t "resolveContract"`
然后跑全部本文件：`pnpm --filter @repohelm/core test task-contract`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/task-contract.ts packages/core/src/task-contract.test.ts
git commit -m "Add task-contract module for worker prompt and plan.md"
```

---

## Task 3: plan.md 渲染/解析契约块

**Files:**
- Modify: `packages/core/src/quest-workspace.ts:62-93`（render）、`:95-140`（parse）
- Test: `packages/core/src/orchestrator.test.ts`（现有 QuestWorkspaceManager round-trip 套件）

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/orchestrator.test.ts` 的 `describe("QuestWorkspaceManager", ...)` 内追加一个用例（放在第一个 `it` 之后）：

```ts
  it("round-trips a step contract", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-orchestrator-test-"));
    const manager = new QuestWorkspaceManager(rootDir);
    const questId = "quest_contract_test";
    const plan: OrchestrationPlan = {
      questId,
      generatedAt: "2026-06-12T00:00:00.000Z",
      summary: "Plan with contract",
      notes: "",
      steps: [
        {
          id: "step_1",
          description: "Build A",
          agentId: "coder",
          agentName: "Coder",
          dependencies: [],
          expectedOutput: "Code for A",
          contract: {
            boundaries: "Do not touch auth",
            sourcesGuidance: "See README",
            doneCriteria: "Tests pass"
          }
        }
      ]
    };

    await manager.writePlan(questId, plan);
    const readBack = await manager.readPlan(questId);

    expect(readBack!.steps[0]!.agentId).toBe("coder");
    expect(readBack!.steps[0]!.expectedOutput).toBe("Code for A");
    expect(readBack!.steps[0]!.contract).toEqual({
      boundaries: "Do not touch auth",
      sourcesGuidance: "See README",
      doneCriteria: "Tests pass"
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/core test -t "round-trips a step contract"`
Expected: FAIL（`contract` 为 undefined，不等于期望对象）。

- [ ] **Step 3: 接入 task-contract 到 quest-workspace.ts**

在 `packages/core/src/quest-workspace.ts` 顶部 import 后追加：

```ts
import { renderContractMarkdownLines, parseContractFromBlock } from "./task-contract.js";
```

在 `renderPlanMarkdown`（第 76-86 行循环体）里，把 `- **Expected Output**` 行之后、`lines.push(``)` 空行之前，插入契约行。将该循环体改为：

```ts
  for (const step of plan.steps) {
    const safeDescription = step.description.replace(/\s*\n\s*/g, " ").trim();
    lines.push(`### ${step.id}: ${safeDescription}`);
    lines.push(``);
    lines.push(`- **Agent**: ${step.agentName} (\`${step.agentId}\`)`);
    lines.push(`- **Dependencies**: ${step.dependencies.length > 0 ? step.dependencies.join(", ") : "none"}`);
    lines.push(`- **Expected Output**: ${step.expectedOutput}`);
    for (const contractLine of renderContractMarkdownLines(step)) {
      lines.push(contractLine);
    }
    lines.push(``);
  }
```

在 `parsePlanMarkdown` 的 step 构造处（第 123-130 行 `steps.push({...})`），加入契约解析。把该块改为：

```ts
    const contract = parseContractFromBlock(block);
    steps.push({
      id: stepId,
      description,
      agentName: agentMatch[1]!.trim(),
      agentId: agentMatch[2]!.trim(),
      dependencies: depsRaw === "none" ? [] : depsRaw.split(",").map((d) => d.trim()),
      expectedOutput: outputMatch[1]!.trim(),
      ...(contract ? { contract } : {})
    });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/core test orchestrator`
Expected: 新用例 PASS，且原有 round-trip 用例仍 PASS（契约块不破坏 Agent/Dependencies/Expected Output 解析）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/quest-workspace.ts packages/core/src/orchestrator.test.ts
git commit -m "Persist task contract in plan.md round-trip"
```

---

## Task 4: planner 生成契约 + fallback 兜底

**Files:**
- Modify: `packages/core/src/planning.ts:38-65`（system prompt）、`:145-169`（fallback）、`:171-195`（validatePlan）
- Test: `packages/core/src/planning.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/planning.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { generateOrchestrationPlan } from "./planning.js";
import type { SubAgentBackend, SubAgentBackendResult } from "./orchestrator.js";
import type { Quest, SubAgent } from "./types.js";

function stubBackend(content: string): SubAgentBackend {
  return {
    async run(): Promise<SubAgentBackendResult> {
      return { content, toolCalls: [], finishReason: "stop", events: [] };
    }
  };
}

function fakeQuest(): Quest {
  return {
    id: "quest_1",
    title: "Add feature",
    requirement: "Add feature A to project",
    affectedProjectIds: ["proj_1"],
    worktrees: []
  } as unknown as Quest;
}

function fakeAgent(id: string): SubAgent {
  return { id, name: id, role: "worker", capabilities: ["coding"] } as unknown as SubAgent;
}

const entry = { id: "entry", name: "Supervisor", role: "supervisor" } as unknown as SubAgent;

describe("generateOrchestrationPlan contract", () => {
  it("parses contract fields from planner JSON", async () => {
    const json = JSON.stringify({
      summary: "Plan",
      steps: [
        {
          id: "step_1",
          description: "Build A",
          agentId: "coder",
          agentName: "coder",
          dependencies: [],
          expectedOutput: "Code",
          targetProjectId: "proj_1",
          contract: {
            boundaries: "No auth",
            sourcesGuidance: "See docs",
            doneCriteria: "Tests pass"
          }
        }
      ],
      notes: ""
    });
    const plan = await generateOrchestrationPlan({
      entryAgent: entry,
      quest: fakeQuest(),
      agentPool: [fakeAgent("coder")],
      backend: stubBackend(json)
    });
    expect(plan.steps[0]!.contract).toEqual({
      boundaries: "No auth",
      sourcesGuidance: "See docs",
      doneCriteria: "Tests pass"
    });
  });

  it("drops non-string contract fields", async () => {
    const json = JSON.stringify({
      summary: "Plan",
      steps: [
        {
          id: "step_1",
          description: "Build A",
          agentId: "coder",
          agentName: "coder",
          dependencies: [],
          expectedOutput: "Code",
          contract: { boundaries: 42, doneCriteria: "ok" }
        }
      ]
    });
    const plan = await generateOrchestrationPlan({
      entryAgent: entry,
      quest: fakeQuest(),
      agentPool: [fakeAgent("coder")],
      backend: stubBackend(json)
    });
    expect(plan.steps[0]!.contract).toEqual({ doneCriteria: "ok" });
  });

  it("fills a minimal contract on the non-JSON fallback step", async () => {
    const plan = await generateOrchestrationPlan({
      entryAgent: entry,
      quest: fakeQuest(),
      agentPool: [fakeAgent("coder")],
      backend: stubBackend("sorry, I cannot produce JSON")
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.contract).toEqual({
      doneCriteria: "Implementation code and artifacts"
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/core test planning`
Expected: FAIL（`contract` 为 undefined）。

- [ ] **Step 3: 更新 PLAN_SYSTEM_PROMPT**

在 `packages/core/src/planning.ts` 的 `PLAN_SYSTEM_PROMPT` 里，把示例 JSON 的 step 对象（第 44-52 行）加上 `contract`，并补一条规则。把 step 示例改为：

```
    {
      "id": "step_1",
      "description": "What this step does — be specific about the actual work",
      "agentId": "agent-id-from-pool",
      "agentName": "Agent Display Name",
      "dependencies": [],
      "expectedOutput": "What the step produces",
      "targetProjectId": "project-id-from-affected-projects",
      "contract": {
        "boundaries": "What the worker must NOT do / scope limits",
        "sourcesGuidance": "Files, prior results, or notes the worker should consult",
        "doneCriteria": "Concrete definition of done"
      }
    }
```

在 `Rules:` 列表末尾追加一行：

```
- Each step MUST include a "contract" with "boundaries" and "doneCriteria" so the worker knows its limits and what "done" looks like. "sourcesGuidance" is optional free text (do not reference a knowledge base).
```

- [ ] **Step 4: validatePlan 解析 contract**

在 `packages/core/src/planning.ts` 顶部 import 后追加：

```ts
import { minimalContract } from "./task-contract.js";
import type { TaskContract } from "./types.js";
```

在 `validatePlan` 内（第 174 行 `const steps = ...` 上方）加一个本地 helper：

```ts
  function parseContract(raw: any): TaskContract | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const out: TaskContract = {};
    for (const key of ["outputFormat", "boundaries", "sourcesGuidance", "doneCriteria"] as const) {
      if (typeof raw[key] === "string" && raw[key].trim().length > 0) out[key] = raw[key].trim();
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
```

把 step 的 `.map((s: any) => ({ ... }))`（第 177-185 行）末尾加 `contract`：

```ts
        .map((s: any) => {
          const contract = parseContract(s.contract);
          return {
            id: s.id,
            description: s.description || "",
            agentId: s.agentId,
            agentName: s.agentName || agentPool.find((a) => a.id === s.agentId)?.name || s.agentId,
            dependencies: Array.isArray(s.dependencies) ? s.dependencies.filter((d: any) => typeof d === "string") : [],
            expectedOutput: s.expectedOutput || "",
            targetProjectId: s.targetProjectId || defaultProjectId,
            ...(contract ? { contract } : {})
          };
        })
```

- [ ] **Step 5: fallback step 填最小契约**

在 `parsePlanFromResponse` 的 `fallbackSteps`（第 148-160 行）里给 step 加 `contract: minimalContract("Implementation code and artifacts")`。把对象改为：

```ts
        {
          id: "step_1",
          description: quest.requirement,
          agentId: defaultAgent.id,
          agentName: defaultAgent.name,
          dependencies: [] as string[],
          expectedOutput: "Implementation code and artifacts",
          targetProjectId: defaultProjectId,
          contract: minimalContract("Implementation code and artifacts")
        }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/core test planning`
Expected: 三个用例全 PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/planning.ts packages/core/src/planning.test.ts
git commit -m "Generate and validate task contracts in planner"
```

---

## Task 5: orchestrator 注入契约到 worker + simple plan 兜底

**Files:**
- Modify: `packages/core/src/orchestrator.ts:99-133`（createSimplePlan）、`:160-201`（executeApprovedPlan 调用）、`:247-345`（invokeWorkerAgent）
- Test: `packages/core/src/orchestrator.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/orchestrator.test.ts` 顶部 import 区追加：

```ts
import { resolveContract, renderContractSection } from "./task-contract.js";
```

在文件末尾追加一个独立 describe（验证契约段渲染契合 worker 注入所用的函数；这是注入逻辑的纯函数核心）：

```ts
describe("worker contract injection", () => {
  it("renders objective, boundaries, done criteria and upstream results", () => {
    const section = renderContractSection(
      resolveContract({
        id: "step_2",
        description: "Review A",
        agentId: "rev",
        agentName: "Reviewer",
        dependencies: ["step_1"],
        expectedOutput: "Review notes",
        contract: { boundaries: "No refactor", doneCriteria: "Notes written" }
      }),
      [{ stepId: "step_1", result: "implemented A" }]
    );
    expect(section).toContain("- Objective: Review A");
    expect(section).toContain("- Boundaries: No refactor");
    expect(section).toContain("- Done when: Notes written");
    expect(section).toContain("- step_1: implemented A");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/core test -t "renders objective, boundaries"`
Expected: 该测试本身 PASS（task-contract 已实现）——它锚定预期行为。继续改 orchestrator 让真实注入使用这些函数（下一步），失败信号来自下一步前 invokeWorkerAgent 仍用旧拼接。先确保本测试通过即可继续。

- [ ] **Step 3: createSimplePlan 填最小契约**

在 `packages/core/src/orchestrator.ts` 顶部 import（第 19 行 fs tools import 后）追加：

```ts
import { resolveContract, renderContractSection, minimalContract, type DependencyResult } from "./task-contract.js";
```

在 `createSimplePlan` 的返回 step（第 119-128 行）里加 `contract`。把 steps 数组的对象改为：

```ts
        {
          id: "step_1",
          description,
          agentId: codingAgent.id,
          agentName: codingAgent.name,
          dependencies: [],
          expectedOutput: "Implementation code and artifacts",
          targetProjectId: projectId,
          contract: minimalContract("Implementation code and artifacts")
        }
```

- [ ] **Step 4: executeApprovedPlan 传 step + dependencies**

在 `executeApprovedPlan` 中，定位第 178-201 行（构造 `context` 并调用 `invokeWorkerAgent`）。把 `context` 里的 `dependencies` 复用为强类型变量，并把 `step` 传入。将该段改为：

```ts
        const targetProjectId = step.targetProjectId || quest.affectedProjectIds[0];
        const targetWorktree = quest.worktrees.find((w) => w.projectId === targetProjectId);

        const dependencies: DependencyResult[] = step.dependencies.map((dep) => ({
          stepId: dep,
          result: stepResults.get(dep) || ""
        }));

        const result = await this.invokeWorkerAgent(agent, {
          step,
          dependencies,
          quest,
          targetProjectId
        });
```

（删除原先的 `const context: Record<string, unknown> = { ... }` 整块——它的 stepId/questTitle/targetWorktree/dependencies 信息已由契约段与 systemPrompt 覆盖。`targetWorktree` 变量若不再被引用，一并删除其声明。）

- [ ] **Step 5: invokeWorkerAgent 用契约组装 prompt**

把 `invokeWorkerAgent` 的签名与 prompt 组装（第 247-267 行）改为：

```ts
  private async invokeWorkerAgent(
    worker: SubAgent,
    input: {
      step: OrchestrationPlanStep;
      dependencies: DependencyResult[];
      quest: Quest;
      targetProjectId?: string;
    }
  ): Promise<{ content: string; error?: string; writtenFiles?: string[] }> {
    try {
      const modelKit = await this.requireModelKit(worker);
      const basePrompt =
        worker.promptTemplate ??
        `You are a specialized worker agent named "${worker.name}". ` +
          `Your capabilities: ${worker.capabilities?.join(", ") || "general"}. ` +
          `Produce a concise, high-quality result for the task below.`;
      const userContent = renderContractSection(
        resolveContract(input.step),
        input.dependencies
      );
```

随后该方法内所有 `input.targetProjectId` 保持不变；所有 `input.quest` 保持不变；把 `input.stepId`（第 330 行附近 `if (input.stepId)`）改为 `input.step.id`，并把 `writeWorkerArtifact` 的 `input.quest.id, input.stepId` 改为 `input.quest.id, input.step.id`：

```ts
      await this.writeWorkerArtifactSafely(input.quest.id, input.step.id, worker.name, content);
```

若原代码是直接 `await this.questWorkspace.writeWorkerArtifact(input.quest.id, input.stepId, worker.name, content);`，则改为：

```ts
      await this.questWorkspace.writeWorkerArtifact(input.quest.id, input.step.id, worker.name, content);
```

并确认顶部 import 的类型含 `OrchestrationPlanStep`（第 20 行 `import type { ModelKit, OrchestrationPlan, Quest, SubAgent, WorktreeState } from "./types.js";` 加上 `OrchestrationPlanStep`）：

```ts
import type { ModelKit, OrchestrationPlan, OrchestrationPlanStep, Quest, SubAgent, WorktreeState } from "./types.js";
```

- [ ] **Step 6: typecheck + 测试**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/core test orchestrator`
Expected: PASS，无类型错误（确认 `targetWorktree`/旧 `context` 删除后无悬空引用）。

- [ ] **Step 7: 全量 core 测试回归**

Run: `pnpm --filter @repohelm/core test`
Expected: 全绿。

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/orchestrator.ts packages/core/src/orchestrator.test.ts
git commit -m "Inject task contract into worker prompts"
```

---

## Task 6: Web UI 计划视图展示契约

**Files:**
- Modify: `apps/web/src/App.tsx:1484-1496`

- [ ] **Step 1: 渲染契约字段**

把 `apps/web/src/App.tsx` 第 1484-1496 行的 `plan.steps.map(...)` 块替换为（在"预期输出"之后追加契约行，缺字段不渲染）：

```tsx
        {plan.steps.map((step, index) => (
          <div key={step.id} style={{ padding: "8px 0", borderBottom: index < plan.steps.length - 1 ? "1px solid var(--border)" : undefined }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>
              {index + 1}. {step.description}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              Agent: {step.agentName}
              {step.dependencies.length > 0 ? ` · 依赖: ${step.dependencies.join(", ")}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
              预期输出: {step.contract?.outputFormat || step.expectedOutput}
            </div>
            {step.contract?.boundaries ? (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                边界: {step.contract.boundaries}
              </div>
            ) : null}
            {step.contract?.sourcesGuidance ? (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                信息源: {step.contract.sourcesGuidance}
              </div>
            ) : null}
            {step.contract?.doneCriteria ? (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                完成判据: {step.contract.doneCriteria}
              </div>
            ) : null}
          </div>
        ))}
```

- [ ] **Step 2: typecheck web**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/web typecheck`
（若无 `web typecheck` 脚本则用根 `pnpm typecheck`。）
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/App.tsx
git commit -m "Show task contract in plan approval view"
```

---

## Task 7: e2e + 全量回归

**Files:**
- Modify/Create: `e2e/`（扩展现有 plan 审批用例，或新增 `e2e/quest-contract.spec.ts`）
- 参考：`e2e/` 现有用例如何用 API 注入 quest/ModelKit 并断言 UI（见现有 quest-workspace e2e）。

- [ ] **Step 1: 确认 e2e 注入契约的方式**

Run: `grep -rn "REPOHELM_FAKE_CHAT_JSON\|getQuestPlan\|plan" e2e/ | head -30`
Expected: 找到现有注入假模型输出与读取/展示计划的用例，作为模板。

- [ ] **Step 2: 写 e2e 用例**

新增 `e2e/quest-contract.spec.ts`（按现有用例的 fixture 风格调整 import 与启动钩子）：

```ts
import { test, expect } from "@playwright/test";

// 复用现有 e2e 的 API 注入辅助：创建 workspace/project、注入带 contract 的 plan。
// 假 plan JSON 通过 REPOHELM_FAKE_CHAT_JSON 提供给 planner（playwright.config 已设 REPOHELM_FAKE_MODELS=1）。
const FAKE_PLAN = JSON.stringify({
  summary: "Contract plan",
  steps: [
    {
      id: "step_1",
      description: "Build feature A",
      agentId: "coding-agent",
      agentName: "Coding Agent",
      dependencies: [],
      expectedOutput: "Code for A",
      contract: {
        boundaries: "Do not modify auth",
        doneCriteria: "Unit tests pass"
      }
    }
  ],
  notes: ""
});

test("plan approval view shows task contract", async ({ page }) => {
  // TODO(实现时按现有 e2e 辅助补全): 设置 REPOHELM_FAKE_CHAT_JSON=FAKE_PLAN，
  // 经 API 创建 workspace/project/quest 并 runQuest，使计划进入 pending。
  // 然后打开该 quest 的计划视图：
  await page.goto("/");
  // 选中含 pending 计划的 quest 后，断言契约渲染：
  await expect(page.getByText("边界: Do not modify auth")).toBeVisible();
  await expect(page.getByText("完成判据: Unit tests pass")).toBeVisible();
});
```

> 注：上面的 `TODO` 仅标记"按现有 e2e 辅助补全注入步骤"，实现者应直接复用 Step 1 找到的模板里的 API 注入函数（创建 workspace/project/quest、设置 fake plan、runQuest），不要留占位。FAKE_PLAN 与两条断言是完整可用的。

- [ ] **Step 3: 运行 e2e 用例**

Run: `pnpm test:e2e -g "task contract"`
Expected: PASS（契约在计划视图可见）。

- [ ] **Step 4: 全量回归**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 通过、core 单测全绿。

Run: `pnpm test:e2e -g "plan"`
Expected: 现有计划相关 e2e 不回归。

- [ ] **Step 5: 提交**

```bash
git add e2e/
git commit -m "Add e2e for task contract in plan view"
```

---

## Self-Review 结果

- **Spec 覆盖**：四要素契约（Task 1 类型 / Task 4 planner 生成 / Task 5 注入）、plan.md 落盘（Task 3）、UI 展示（Task 6）、兼容老 quest（Task 2 `resolveContract` 回退 + Task 3 `parseContractFromBlock` 返回 undefined）、simple/fallback 最小契约（Task 4 Step 5 / Task 5 Step 3）、测试策略（Task 2/3/4/5 单测 + Task 7 e2e）——逐条有对应任务。
- **server Zod**：spec 第 7 边界项标记"实现时确认"，已在文件结构中确认 `context.json(plan)` 无输出 schema，**无需改动**，故无对应任务。
- **类型一致性**：`TaskContract` 四字段（outputFormat/boundaries/sourcesGuidance/doneCriteria）在 types.ts、api.ts、task-contract.ts、planning.ts、quest-workspace.ts、App.tsx 全程一致；`resolveContract`/`renderContractSection`/`minimalContract`/`renderContractMarkdownLines`/`parseContractFromBlock`/`DependencyResult` 命名跨任务一致。
- **占位符**：仅 Task 7 e2e 注入步骤保留一处显式标注的 TODO（依赖实现者复用现有 e2e 辅助），其余步骤均为完整代码。
