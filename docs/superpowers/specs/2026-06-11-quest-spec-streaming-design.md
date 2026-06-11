# Quest 创建改为真实流式生成 — 设计

> 日期：2026-06-11
> 状态：已确认，待转实施计划

## 背景与问题

当前 `createQuest`（`packages/core/src/service.ts:1551`）在**一次同步 HTTP 请求**里（实测 ~0.21s）拼出 Spec 和 6 条时间线事件后返回：

- `generateSpec`（`service.ts:2368`）是**写死的模板**：无论需求是什么，`background` / `functionalRequirements` / `nonFunctionalRequirements` / `affectedSurfaces` / `outOfScope` / `acceptanceCriteria` / `openQuestions` 全是固定文字，只有 `userGoal` 替换成需求原文。
- 6 条事件（Quest 已创建 / 轻量 Spec 已生成 / 实施计划已生成 / 知识库已引用 / 用户偏好已注入 / 能力推荐已生成）在 `service.ts:1597-1637` 同步拼出，署名 Spec/Knowledge/Capability Agent，但**背后没有任何模型或 Agent 在跑**——知识检索是关键词匹配，能力推荐置信度写死 0.72。

结果：创建后零延迟弹出一堆带 Agent 署名的消息，用户感知为"mock、不真实"。真正的模型工作要到 `runQuest`（orchestrator 工具调用循环）才发生。

## 目标

让 Quest 创建阶段**真的调用模型生成 Spec**，并以 **SSE token 级流式**呈现：先逐字流出一段"需求分析"叙述（像在思考），解析出结构化 Spec 后整体淡入卡片，其余时间线事件按真实生成节奏逐条出现。

## 非目标

- 不改 `runQuest` / orchestrator 执行阶段。
- 不顺带重构 expert session 的轮询式 SSE（`apps/server/src/index.ts:875`）——保持聚焦。
- 不引入新的流式 UI 组件库，沿用现有 token 驱动样式与时间线渲染。

## 现状关键事实（已核实）

- `callLlmWithModelKit`（`packages/core/src/llm.ts:67`）是**纯 buffered**，无流式；底层是 OpenAI 兼容 `POST /chat/completions` 的 `fetch`。DeepSeek 兼容 `stream:true`。
- `chatJson`（`service.ts:139`）已封装"调 BYOK 模型 + 解析 JSON"，并支持 `REPOHELM_FAKE_MODELS` / `REPOHELM_FAKE_CHAT_JSON`。`resolveChatModelKit`（`service.ts:122`）从 `state.engine.modelKits` 找 `type==="byok"` 的 kit。
- SSE 基础设施 `setupSSE` / `formatSSE` 存在（`apps/server/src/sse.ts`），但现有 `/api/expert/session/:id/stream` 是 `setInterval` 轮询式，**前端无任何 EventSource 消费代码**——客户端流式模式需新建。
- 前端事件时间线在 `App.tsx:1125` 从 `state.events` 渲染；`createQuest` 调用在 `App.tsx:282`，是一次 `await api.createQuest` 拿到完整 Quest。

## 总体数据流

```
用户提交
  │
  ├─① POST /api/quests (createQuest) ── 立即返回
  │     创建 quest 记录, status="spec_generating"
  │     spec 暂空(占位), 只发 1 条 "quest.created" 事件
  │
  └─② 前端拿到 quest → 打开 EventSource: GET /api/quests/:id/spec-stream
        │
        ├─ analysis_delta {text}  ← 模型分析叙述, 逐 token (字一个个蹦)
        ├─ spec_ready {spec}      ← JSON 解析完成, Spec 卡片 fade-in
        ├─ event_added {event}    ← 知识/偏好/风险/能力 逐条 push (带节奏延迟)
        ├─ done {quest}           ← status→"planning", 前端刷新 state
        └─ error {message}        ← 失败时(已降级则不发, 见下)
```

## 改动分层

### 1. `packages/core/src/llm.ts` — 新增流式变体

新增 `streamLlmWithModelKit(options: LlmCallOptions): AsyncGenerator<string, LlmCallResult>`：

- 复用 `resolveByok` 与现有 endpoint 构造；body 增 `stream: true`。
- 读取 `response.body` 流，按行解析 OpenAI 兼容 SSE：`data: {...}`，取 `choices[0].delta.content` 逐块 `yield`；`data: [DONE]` 结束。
- 累积完整 content，返回 `LlmCallResult`（content/finishReason/usage）。
- `REPOHELM_FAKE_MODELS==="1"`：把 `REPOHELM_FAKE_CHAT_JSON`（或固定文本）切成若干块逐块 yield，保证 e2e/单测不打真实端点。

### 2. `packages/core/src/service.ts` — 拆分 createQuest + 新增流式生成

**`createQuest` 收窄为"快的本地活"：**
- 建 quest 记录、推断 `affectedProjectIds`（保留现有 `inferAffectedProjectIds`）、发 `quest.created` 事件。
- spec 设占位（空结构或仅含 `userGoal`），`status: "spec_generating"`。
- 立即返回 quest。不再在此做知识检索 / 偏好 / 风险 / 能力推荐 / spec 生成。

**新增 `async *streamQuestSpec(questId: string)`：**
1. 取 quest + workspace，组 prompt：需求原文 + 相关知识标题；要求模型**先输出 2-4 句中文需求分析（口语化，像在思考），再输出一个 ```json 代码块**，字段沿用现有 `QuestSpec` 结构。经 `streamLlmWithModelKit` 流式 `yield {type:"analysis_delta", text}`（仅 ```json 围栏前的文字作为分析）。
2. 解析尾部 JSON → `QuestSpec`；写入 `quest.spec`（走 `_mutationQueue`）；`yield {type:"spec_ready", spec}`。
3. 依次执行并各自落库 + yield `event_added`，步间插入小延迟（节奏感）：
   - 知识检索（`searchProjectKnowledge`）→ `knowledge.retrieved`
   - 用户偏好（`getUserPreferences`）→ `preference.injected`
   - 风险检查（`checkRisk`）→ `risk.warning`
   - 能力推荐（`recommendCapabilities`）→ `capability.recommended`
   - 计划阶段事件 → `plan.created`
   （沿用 `service.ts:1597-1637` 原有判空条件，仅在非空时发。）
4. `status` 设 `planning`；`yield {type:"done", quest}`。

**降级策略：** 模型不可用 / 无 BYOK kit / JSON 解析失败时，回退现有 `generateSpec` 模板生成 spec，照常发出后续事件并完成（status→planning），**不发 error、不让创建硬失败**。仅在内部日志标记降级。

所有增量写库通过现有 `_mutationQueue` 串行化，避免整 blob read-modify-write 互相 clobber。

### 3. `apps/server/src/index.ts` — 新 SSE 路由

`GET /api/quests/:id/spec-stream`：
- 校验 quest 存在；构造 `ReadableStream`，在 `start` 中 `for await (const ev of service.streamQuestSpec(id))`，按 `ev.type` 用 `formatSSE` 转发对应事件；结束后 `controller.close()`。
- `cancel()` 处理客户端断开（中断生成 / 释放）。
- 沿用 `setupSSE`。

### 4. `apps/web` — 前端消费

- `apps/web/src/api.ts`：新增 EventSource 订阅辅助（如 `streamQuestSpec(questId, handlers)`），返回可关闭句柄。Vite 已代理 `/api`，SSE 直通。
- `apps/web/src/App.tsx`（`createQuest` @282 / 时间线 @1125）：
  - `createQuest` 返回 generating 态 quest 后，打开 spec-stream。
  - 渲染"分析中…"loading + 流式叙述文本（累积 `analysis_delta`）。
  - `spec_ready`：淡入 Spec 卡片。
  - `event_added`：逐条淡入时间线行。
  - `done`：刷新 `/api/state`，关闭流。
  - `error`：提示并刷新（正常路径已降级，error 仅兜底）。

### 配套

- `packages/core/src/types.ts`：`Quest["status"]` 联合类型加 `"spec_generating"`；核对现有 status 取值与前端 switch/映射处一并补齐。
- **测试**：
  - 更新现有 `createQuest` 单测（`orchestrator.test.ts` / server 测试中断言 spec 内容与事件时序处）。
  - 新增 `streamQuestSpec` 单测：fake 模式下断言事件序列（analysis_delta → spec_ready → event_added* → done）与降级路径。
  - e2e：创建 quest 后等待流 `done` 再断言，依赖 fake-mode 流式。

## 风险与取舍

- 引擎当前为 CLI 模式（claude-code/opus），但 Spec 走 BYOK DeepSeek，与知识库索引同路径（`resolveChatModelKit`）。无 BYOK kit → 降级模板，不阻断。
- 流式增加了一个"生成中"中间态，需保证：刷新页面 / 中途断开后 quest 不会卡在 `spec_generating`——降级与 `done` 必达；可在 stream 异常时也置 `planning`。
- 时间线 6 条不再瞬间齐刷，而是按真实生成节奏出现——预期内的行为变化，e2e 需相应调整等待逻辑。
