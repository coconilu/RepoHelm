# 编排任务契约（Task Contract）设计

- 日期：2026-06-12
- 主题：为 RepoHelm 的 Quest 编排补全「worker 任务契约」，让 worker 知道"做到什么算完"
- 状态：设计已确认，待转入实现计划

## 背景与问题

RepoHelm 的编排是 Plan-then-Execute 的中心化 orchestrator-worker 模型（`SubAgentOrchestrator`）：
入口（监督者）agent 画计划，worker agent 按依赖图执行。当前协作存在一个核心缺口——

`OrchestrationPlanStep` 上的 `expectedOutput` 字段**在执行阶段被丢弃**：`invokeWorkerAgent`
（`orchestrator.ts` 第 264-266 行）只把 `step.description` + JSON `context` 拼进 worker prompt，
worker 拿不到"产出格式 / 边界 / 完成判据"。对照 Anthropic 多 agent 研究系统的经验：
**每个 subagent 的任务契约需含 objective / output format / tools-sources guidance / task boundaries
四要素，缺任一项 subagent 就会跑偏**。

本设计补齐这个契约，并在用户审批计划时（plan.md + Web UI）可见。

### 调研依据（社区方案）

- **Anthropic Multi-Agent Research System** — orchestrator-worker；每个 subagent 必须有明确的
  4 要素任务契约，否则不知道"done 长什么样"。本设计直接对标此点。
- **Google ADK** — session state（小数据）/ Artifact（大文件，命名+版本化）分层；本次先做契约文本，
  不引入 artifact 层（列为后续）。
- **LangGraph** — typed shared state；本次不引入共享状态图，保持现有中心化调度。

## 目标与非目标

### 目标
1. 给每个 step 一份结构化任务契约（objective / output format / boundaries / sources guidance / done criteria）。
2. 契约由 planner LLM 生成，落进 plan.md，执行时注入 worker prompt。
3. 用户审批计划时，Web UI 计划视图展示契约。

### 非目标（YAGNI / 后续）
- 不联动知识库（`knowledge.ts`）：sources guidance 仅为 planner 写的**纯文本指引**，不检索 wiki。
- 不做下游感知上游"改了哪些文件"（writtenFiles 回传）——独立改进，本次不含。
- 不做结构化共享内存 / 黑板、不做 DAG 环检测——独立改进，本次不含。
- 不引入执行期二次 LLM 生成契约（与"审批时可见"冲突，且慢且贵）。

## 方案：嵌套 contract 对象 + 独立 task-contract.ts 模块

新建 `packages/core/src/task-contract.ts` 作为契约的唯一事实源（与 `quest-workspace.ts`、
`planning.ts` 平级的专职 collaborator）。`orchestrator.ts` / `quest-workspace.ts` / `planning.ts`
都只调用它，不各自拼字符串。

### 数据模型（types.ts）

复用现有字段映射 Anthropic 四要素，避免重复造字段：
- objective ← 已有 `step.description`
- output format ← 已有 `step.expectedOutput`（作为回退）

只补缺失要素，新增一个**整体可选**的嵌套对象（保证向后兼容）：

```ts
export interface TaskContract {
  outputFormat?: string;     // 产出格式（缺则回退到 step.expectedOutput）
  boundaries?: string;       // 边界 / 不要做什么
  sourcesGuidance?: string;  // 信息源与注意事项（纯文本）
  doneCriteria?: string;     // 完成判据（done 长什么样）
}

export interface OrchestrationPlanStep {
  // ...现有字段不变...
  contract?: TaskContract;   // 新增，可选
}
```

`index.ts` 自动 re-export。

### task-contract.ts 对外接口（三个纯函数，便于单测）

- `resolveContract(step): ResolvedContract`
  把 `description` / `expectedOutput` / `contract` 合并成统一 5 要素视图；缺字段回退
  （`outputFormat ← expectedOutput`），永不抛错。
- `renderContractSection(resolved, deps): string`
  产出注入 worker systemPrompt 的结构化段落；缺字段对应行不输出；无依赖时省略 Upstream 段。
- `renderContractMarkdown(step)` / `parseContractMarkdown(block)`
  plan.md 契约块的写 / 读，与现有解析正交。

worker prompt 段落形如：

```
## Task Contract
- Objective: <description>
- Expected output: <outputFormat>
- Boundaries: <boundaries>          # 缺则不输出此行
- Sources & notes: <sourcesGuidance>
- Done when: <doneCriteria>
## Upstream results                  # 无依赖时整段省略
- <depStepId>: <result 摘要>
```

## 数据流

```
planner LLM ──生成含 contract 的 plan──► validatePlan ──► plan.md(含契约块)
                                                              │
                                          用户审批(Web UI 展示契约) ──批准──►
                                                              │
plan.md ──parsePlanMarkdown(还原 contract)──► executeApprovedPlan
                                                              │
              每个 step: resolveContract + renderContractSection ──► worker systemPrompt
```

不变量：
- 契约事实源是 **plan.md**（与现有 plan 一致：内存生成→落盘→执行时重新解析）。
- worker 拿到的契约永不因字段缺失而报错，只是少一行。

## 逐文件改动

1. **types.ts** — 加 `TaskContract` + `OrchestrationPlanStep.contract?`。
2. **planning.ts** —
   - `PLAN_SYSTEM_PROMPT` 的 JSON schema 给 step 加 `contract` 四字段，补规则"必须给出 boundaries 与 doneCriteria"。
   - `validatePlan` 对 `s.contract` 逐字段 `typeof === "string"` 过滤，全空则省略 `contract`。
   - `createSimplePlan` 与 `parsePlanFromResponse` 的 fallback step 填**最小契约**（`doneCriteria` 用 `expectedOutput` 兜底）。
3. **task-contract.ts（新）** — 上述三个纯函数。
4. **quest-workspace.ts** — `renderPlanMarkdown` 在每个 step 元数据块**之后**、下一个 `###` 之前追加契约块；
   `parsePlanMarkdown` 增量解析还原 `contract`；沿用"块内逐行 match、匹配不到就跳过"的健壮风格。
5. **orchestrator.ts** — `executeApprovedPlan` 把完整 `step` 传入 `invokeWorkerAgent`（签名小调整）；
   `invokeWorkerAgent` 调 `resolveContract` + `renderContractSection`，把契约段并入 `systemPrompt`
   （紧跟 basePrompt / worktree 说明之后）。
6. **apps/server** — 若 plan 响应 Zod schema 为 `.strict()`，加 `contract` 为 `.optional()`；否则透传。
7. **api.ts** — plan step 类型加 `contract?`。
8. **App.tsx** — 计划审批视图每个 step 卡片下渲染契约；`contract` 或字段为空则不渲染（无空标签）。

## 错误处理与边界

1. **LLM 没生成 / 脏数据** — `validatePlan` 逐字段过滤；畸形 JSON 走现有 fallback，无契约也合法。
2. **Simple / fallback plan** — 填最小契约，`doneCriteria ← expectedOutput`，保证简单 quest 也有完成判据。
3. **老 quest plan.md（向后兼容）** — 无契约块 → `parseContractMarkdown` 返回 undefined →
   `resolveContract` 回退 `outputFormat ← expectedOutput`，其余省略；已批准/执行中的老 quest 不受影响。
4. **worker prompt 组装** — 字段"有才输出"，避免空标签误导模型；无依赖省略 Upstream 段。
5. **plan.md 解析健壮性** — 契约块放在 Agent/Dependencies/Expected Output 三行之后，
   与现有 `### step` 标题扫描和三行正则正交，不破坏既有解析。
6. **UI 缺字段** — 渲染前判空，老 quest 无契约区，与现状一致。
7. **server Zod** — 实现时确认 schema 严格性，避免新字段被剥离。

## 测试策略

遵循 CLAUDE.md：core 用 vitest colocated 单测；e2e 用 Playwright + `REPOHELM_FAKE_*`。

1. **task-contract.test.ts（新，核心）**
   - `resolveContract`：完整 / 部分 / 无 contract（回退）三种输入。
   - `renderContractSection`：缺字段不输出对应行；无依赖省略 Upstream 段；依赖结果正确摘要。
   - `renderContractMarkdown` ↔ `parseContractMarkdown` round-trip 一致；老 plan.md（无契约块）解析返回 undefined。
2. **quest-workspace 测试增强** — `render/parsePlanMarkdown` round-trip 加带 `contract` 的 step；
   断言契约块不破坏 Agent/Dependencies/Expected Output 三行解析。
3. **planning.test.ts** — `validatePlan` 喂合法 / 脏字段 / 无 contract；`createSimplePlan` 断言产出最小契约。
4. **orchestrator 层** — `invokeWorkerAgent` 收完整 step；用 mock backend 断言 worker `systemPrompt`
   含契约关键行；缺字段断言对应行不出现。
5. **e2e** — `REPOHELM_FAKE_MODELS=1` + `REPOHELM_FAKE_CHAT_JSON` 注入带 contract 的假 plan JSON，
   跑通 createQuest→生成计划→审批视图，断言 UI 渲染契约区；复用现有 API 注入套路，不依赖真实 LLM。
6. **回归护栏** — `pnpm typecheck` + `pnpm test` + `pnpm test:e2e -g "plan"`。

## 影响面小结

- core：`types.ts`、`planning.ts`、`task-contract.ts`（新）、`quest-workspace.ts`、`orchestrator.ts`
- server：`apps/server`（可能加一处 Zod optional）
- web：`api.ts`、`App.tsx`
- 测试：新增 `task-contract.test.ts`，增强 `quest-workspace` / `planning` 单测，新增/扩展一个 plan e2e
