# Quest Spec 流式生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Quest 创建阶段真正调用模型流式生成 Spec——先逐 token 流出需求分析叙述，再淡入结构化 Spec 卡片，其余时间线事件按真实生成节奏逐条出现。

**Architecture:** `createQuest` 收窄为快速本地操作（建记录 + `quest.created` 事件，status=`specifying`）后立即返回；前端打开 SSE（`GET /api/quests/:id/spec-stream`）驱动新的 `service.streamQuestSpec` 异步生成器，后者用新增的 `streamLlmWithModelKit` 流式调用 BYOK 模型生成 Spec，并依次发出知识/偏好/风险/能力事件。模型不可用时降级回原模板，绝不让创建硬失败。

**Tech Stack:** TypeScript (ESM, `.js` import 后缀), Hono SSE (`setupSSE`/`formatSSE`), OpenAI 兼容 `stream:true` chat completions, React 19 + EventSource, vitest, Playwright。

**关键既有事实（已核实）：**
- `callLlmWithModelKit` (`packages/core/src/llm.ts:67`) 纯 buffered，底层 OpenAI 兼容 `POST {baseUrl}/chat/completions`。
- `chatJson`(`service.ts:139`)/`resolveChatModelKit`(`service.ts:122`) 已封装 BYOK 调用 + fake-mode；`REPOHELM_FAKE_MODELS==="1"` + `REPOHELM_FAKE_CHAT_JSON`。
- `mutateState`(`service.ts:359`) 串行化写库；`event(questId,type,title,detail,agent)`(`service.ts:2656`) 造事件。
- `QuestStatus`(`types.ts:1`) **已含 `"specifying"`**——复用它，不新增状态。
- `searchProjectKnowledge(projectIds, query)`(`service.ts:255`)、`getUserPreferences(cats?, minConf?)`(`service.ts:1090`)、`checkRisk(desc, projectIds)`(`service.ts:1201`)、`recommendCapabilities(caps, requirement, ts)`(`service.ts:2628`)、`inferAffectedProjectIds`(`service.ts:1499`)。
- SSE 设施 `setupSSE`/`formatSSE`(`apps/server/src/sse.ts`)；现有 expert stream 在 `index.ts:875`（轮询式，仅作写法参考）。
- 前端 `createQuest`(`App.tsx:282`) 创建后**紧接着** `await api.runQuest(quest.id)`；时间线从 `state.events` 渲染(`App.tsx:1125`)。

---

## File Structure

- `packages/core/src/llm.ts` — 新增 `streamLlmWithModelKit`（流式生成器）。
- `packages/core/src/llm.test.ts` — 流式单测。
- `packages/core/src/types.ts` — 新增 `QuestSpecStreamEvent` 联合类型（导出供 server/web 复用）。
- `packages/core/src/service.ts` — 拆 `createQuest`；新增 `streamQuestSpec`。
- `packages/core/src/service.test.ts` — `createQuest` 早返回 + `streamQuestSpec` 单测；更新受影响断言。
- `packages/core/src/orchestrator.test.ts` — 更新受影响断言。
- `apps/server/src/index.ts` — 新 SSE 路由 `GET /api/quests/:id/spec-stream`。
- `apps/server/src/index.test.ts` — 路由测试。
- `apps/web/src/api.ts` — `streamQuestSpec` EventSource 辅助。
- `apps/web/src/App.tsx` — 创建流程接入流式渲染。

---

## Task 1: llm.ts 新增流式生成器 `streamLlmWithModelKit`

**Files:**
- Modify: `packages/core/src/llm.ts`（在 `callLlmWithModelKit` 后追加）
- Test: `packages/core/src/llm.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/llm.test.ts` 末尾追加（顶部 import 改为 `import { embedWithModelKit, streamLlmWithModelKit } from "./llm.js";`）：

```typescript
function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) {
        const payload = c === "[DONE]" ? "[DONE]" : JSON.stringify({ choices: [{ delta: { content: c } }] });
        controller.enqueue(enc.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("streamLlmWithModelKit", () => {
  const chatKit: ModelKit = {
    id: "mk_chat", name: "chat", type: "byok", providerId: "deepseek",
    model: "deepseek-chat",
    config: { provider: "deepseek", baseUrl: "https://api.example.com/v1", model: "deepseek-chat", apiKey: "sk-test" },
    metadata: { createdAt: "", testedAt: "", costTier: "low", performanceProfile: "fast" }
  };

  it("yields content deltas and posts stream:true", async () => {
    const fetchMock = vi.fn(async () => sseResponse(["Hel", "lo", " world", "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);

    const out: string[] = [];
    for await (const delta of streamLlmWithModelKit({ modelKit: chatKit, messages: [{ role: "user", content: "hi" }] })) {
      out.push(delta);
    }

    expect(out.join("")).toBe("Hello world");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ model: "deepseek-chat", stream: true });
  });

  it("fake mode yields canned text without fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("REPOHELM_FAKE_MODELS", "1");
    vi.stubEnv("REPOHELM_FAKE_STREAM_TEXT", "abc");

    const out: string[] = [];
    for await (const d of streamLlmWithModelKit({ modelKit: chatKit, messages: [] })) out.push(d);

    expect(out.join("")).toBe("abc");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @repohelm/core test -t "streamLlmWithModelKit"`
Expected: FAIL — `streamLlmWithModelKit is not a function`。

- [ ] **Step 3: 实现 `streamLlmWithModelKit`**

在 `packages/core/src/llm.ts` 中 `callLlmWithModelKit` 函数之后追加：

```typescript
/**
 * Streaming variant of callLlmWithModelKit. Async-generates assistant content
 * deltas (OpenAI-compatible `choices[0].delta.content`). Honors REPOHELM_FAKE_MODELS.
 */
export async function* streamLlmWithModelKit(
  options: LlmCallOptions
): AsyncGenerator<string, void, unknown> {
  if (process.env.REPOHELM_FAKE_MODELS === "1") {
    const text = process.env.REPOHELM_FAKE_STREAM_TEXT ?? "";
    // emit in a few chunks to exercise streaming consumers
    const size = Math.max(1, Math.ceil(text.length / 4));
    for (let i = 0; i < text.length; i += size) {
      yield text.slice(i, i + size);
    }
    return;
  }

  const { modelKit, messages, tools, maxTokens, temperature, signal } = options;
  const { apiKey, baseUrl, model } = resolveByok(modelKit);
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: messages.map((m) => {
      const base: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
      if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
      if (m.tool_calls) base.tool_calls = m.tool_calls;
      return base;
    })
  };
  if (tools && tools.length > 0) body.tools = tools;
  if (typeof maxTokens === "number") body.max_tokens = maxTokens;
  if (typeof temperature === "number") body.temperature = temperature;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM stream to ${endpoint} failed (${response.status}): ${response.statusText} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore keep-alive / partial lines
      }
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @repohelm/core test -t "streamLlmWithModelKit"`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/llm.ts packages/core/src/llm.test.ts
git commit -m "feat: add streaming LLM helper streamLlmWithModelKit"
```

---

## Task 2: types.ts 定义流式事件联合类型

**Files:**
- Modify: `packages/core/src/types.ts`（在 `AgentEvent` 定义之后追加）

- [ ] **Step 1: 添加类型**

在 `packages/core/src/types.ts` 中 `AgentEvent` 接口之后追加：

```typescript
export type QuestSpecStreamEvent =
  | { type: "analysis_delta"; text: string }
  | { type: "spec_ready"; spec: QuestSpec }
  | { type: "event_added"; event: AgentEvent }
  | { type: "done"; quest: Quest }
  | { type: "error"; message: string };
```

（`QuestSpec` 与 `Quest` 已在本文件定义；若顺序导致前向引用报错，TS 类型别名允许同文件内任意顺序引用，无需调整位置。）

- [ ] **Step 2: 确认编译**

Run: `pnpm --filter @repohelm/core build`
Expected: 编译通过，无类型错误。

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/types.ts
git commit -m "feat: add QuestSpecStreamEvent type"
```

---

## Task 3: service.ts 拆分 createQuest + 新增 streamQuestSpec

**Files:**
- Modify: `packages/core/src/service.ts`（`createQuest` @1551；新增 `streamQuestSpec`；import 增 `streamLlmWithModelKit` 与 `QuestSpecStreamEvent`）
- Test: `packages/core/src/service.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/service.test.ts` 末尾追加（沿用文件内既有的 service 构造 helper；若该文件用 `createService()` 之类 helper，复用之——参考文件顶部现有 import 与 `beforeEach`）：

```typescript
describe("createQuest + streamQuestSpec (streaming)", () => {
  it("createQuest returns immediately in specifying status with only quest.created", async () => {
    const { service } = await createServiceForTest(); // 复用本文件既有 helper
    const state = await service.bootstrap();
    const workspace = state.workspaces[0]!;
    const quest = await service.createQuest({
      workspaceId: workspace.id,
      title: "stream test",
      requirement: "做一个太阳系动画网页"
    });
    expect(quest.status).toBe("specifying");
    const after = await service.getState();
    const evts = after.events.filter((e) => e.questId === quest.id);
    expect(evts.map((e) => e.type)).toEqual(["quest.created"]);
  });

  it("streamQuestSpec emits analysis -> spec_ready -> events -> done", async () => {
    process.env.REPOHELM_FAKE_MODELS = "1";
    process.env.REPOHELM_FAKE_STREAM_TEXT =
      '需求分析：这是一个纯前端动画。\n```json\n{"background":"b","userGoal":"g","functionalRequirements":["f1"],"nonFunctionalRequirements":["n1"],"affectedSurfaces":["Quest"],"outOfScope":["x"],"acceptanceCriteria":["a1"],"openQuestions":["q1"]}\n```';
    try {
      const { service } = await createServiceForTest();
      const state = await service.bootstrap();
      const workspace = state.workspaces[0]!;
      const quest = await service.createQuest({
        workspaceId: workspace.id, title: "s", requirement: "做一个太阳系动画网页"
      });

      const types: string[] = [];
      let analysis = "";
      let finalQuest: any = null;
      for await (const ev of service.streamQuestSpec(quest.id)) {
        types.push(ev.type);
        if (ev.type === "analysis_delta") analysis += ev.text;
        if (ev.type === "done") finalQuest = ev.quest;
      }

      expect(types.filter((t) => t === "analysis_delta").length).toBeGreaterThan(0);
      expect(types).toContain("spec_ready");
      expect(types[types.length - 1]).toBe("done");
      expect(analysis).toContain("需求分析");
      expect(finalQuest.status).toBe("planning");
      expect(finalQuest.spec.userGoal).toBe("g");
    } finally {
      delete process.env.REPOHELM_FAKE_MODELS;
      delete process.env.REPOHELM_FAKE_STREAM_TEXT;
    }
  });

  it("streamQuestSpec falls back to template spec when model output is unparseable", async () => {
    process.env.REPOHELM_FAKE_MODELS = "1";
    process.env.REPOHELM_FAKE_STREAM_TEXT = "纯文本没有 json 块";
    try {
      const { service } = await createServiceForTest();
      const state = await service.bootstrap();
      const workspace = state.workspaces[0]!;
      const quest = await service.createQuest({ workspaceId: workspace.id, title: "s", requirement: "abc" });
      let finalQuest: any = null;
      for await (const ev of service.streamQuestSpec(quest.id)) {
        if (ev.type === "done") finalQuest = ev.quest;
        expect(ev.type).not.toBe("error");
      }
      expect(finalQuest.status).toBe("planning");
      expect(finalQuest.spec.userGoal).toBe("abc"); // template uses requirement as userGoal
    } finally {
      delete process.env.REPOHELM_FAKE_MODELS;
      delete process.env.REPOHELM_FAKE_STREAM_TEXT;
    }
  });
});
```

> 注意：若 `service.test.ts` 没有名为 `createServiceForTest` 的 helper，查看文件顶部现有的 service 构造方式（如 `orchestrator.test.ts:createGitRepoService`），改用相同 helper。`streamQuestSpec` 需要真实 git repo 服务以让 workspace/project 存在。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @repohelm/core test -t "streaming"`
Expected: FAIL — `service.streamQuestSpec is not a function` 及 `createQuest` status 断言失败。

- [ ] **Step 3: 改 import**

在 `packages/core/src/service.ts` 顶部 llm import 改为：

```typescript
import { embedWithModelKit, callLlmWithModelKit, streamLlmWithModelKit, type LlmMessage } from "./llm.js";
```

并确保 `QuestSpec`, `Quest`, `AgentEvent`, `QuestSpecStreamEvent` 在本文件的 types import 中（多数已在；缺哪个补哪个）。

- [ ] **Step 4: 收窄 `createQuest`**

将 `createQuest`（`service.ts:1551-1645`）整段替换为下面版本——只保留快速本地操作，spec 置占位，status=`specifying`，仅发 `quest.created`：

```typescript
  async createQuest(input: CreateQuestInput): Promise<Quest> {
    const state = await this.getState();
    const workspace = state.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    const affectedProjectIds =
      input.affectedProjectIds && input.affectedProjectIds.length > 0
        ? input.affectedProjectIds
        : this.inferAffectedProjectIds(state, workspace.projectIds, input.requirement);
    const timestamp = now();
    const questId = id("quest");
    const entrySubAgentId = input.entrySubAgentId ?? state.entrySubAgentId;
    const quest: Quest = {
      id: questId,
      workspaceId: input.workspaceId,
      title: input.title,
      requirement: input.requirement,
      status: "specifying",
      spec: this.placeholderSpec(input.requirement),
      agentBackendId: input.agentBackendId ?? "mock",
      entrySubAgentId,
      affectedProjectIds,
      relatedKnowledgeIds: [],
      worktrees: [],
      changedFiles: [],
      validationResults: [],
      reviewNotes: [],
      deliveryResults: [],
      capabilityRecommendations: [],
      autoApprovePlan: input.autoApprovePlan ?? false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const createdEvent = this.event(questId, "quest.created", "Quest 已创建", "用户需求已进入 Quest 工作流。", "Lead Agent");
    await this.mutateState(async (s) => ({
      newState: { ...s, quests: [quest, ...s.quests], events: [createdEvent, ...s.events] },
      result: undefined
    }));
    return quest;
  }
```

- [ ] **Step 5: 新增 `placeholderSpec` 与 `streamQuestSpec`**

在 `generateSpec`（`service.ts:2368`）附近新增 `placeholderSpec`（复用模板但标记生成中），并在 service 类中新增 `streamQuestSpec`：

```typescript
  private placeholderSpec(requirement: string): QuestSpec {
    return {
      background: "正在分析需求并生成 Spec…",
      userGoal: requirement,
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      affectedSurfaces: [],
      outOfScope: [],
      acceptanceCriteria: [],
      openQuestions: []
    };
  }

  private buildSpecPrompt(requirement: string, knowledgeTitles: string[]): string {
    const knowledgeLine =
      knowledgeTitles.length > 0
        ? `相关 workspace 知识：${knowledgeTitles.join("、")}。\n`
        : "";
    return [
      "你是 RepoHelm 的 Spec Agent。请先用 2-4 句简体中文口语化地分析用户这个研发需求（像在思考，不要分点）。",
      "分析之后，另起一行输出一个 ```json 代码块，字段严格为：",
      "background(string), userGoal(string), functionalRequirements(string[]), nonFunctionalRequirements(string[]), affectedSurfaces(string[]), outOfScope(string[]), acceptanceCriteria(string[]), openQuestions(string[])。",
      "userGoal 用用户原始需求。只输出分析文字 + 一个 json 块，不要其它内容。",
      "",
      knowledgeLine + `用户需求：${requirement}`
    ].join("\n");
  }

  async *streamQuestSpec(questId: string): AsyncGenerator<QuestSpecStreamEvent, void, unknown> {
    const state = await this.getState();
    const quest = state.quests.find((q) => q.id === questId);
    if (!quest) {
      yield { type: "error", message: "Quest not found" };
      return;
    }
    const workspace = state.workspaces.find((w) => w.id === quest.workspaceId);
    const relatedPages = workspace
      ? await this.searchProjectKnowledge(workspace.projectIds, quest.requirement).catch(() => [])
      : [];
    const relatedKnowledge = relatedPages.slice(0, 3);

    // 1) 流式生成分析 + spec JSON
    let raw = "";
    let analysisEmitted = "";
    try {
      const kit = await this.resolveChatModelKit();
      const prompt = this.buildSpecPrompt(quest.requirement, relatedKnowledge.map((p) => p.title));
      for await (const delta of streamLlmWithModelKit({
        modelKit: kit,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3
      })) {
        raw += delta;
        // 只把 ```json 围栏之前的文字作为分析叙述流出
        const fence = raw.indexOf("```");
        const analysisSoFar = fence >= 0 ? raw.slice(0, fence) : raw;
        const newPart = analysisSoFar.slice(analysisEmitted.length);
        if (newPart) {
          analysisEmitted = analysisSoFar;
          yield { type: "analysis_delta", text: newPart };
        }
      }
    } catch {
      // 模型不可用：raw 保持空，下面走降级
    }

    // 2) 解析 spec（失败则降级模板）
    let spec: QuestSpec;
    try {
      const match = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("no json");
      const jsonText = (match[1] ?? match[0]).trim();
      const parsed = JSON.parse(jsonText) as QuestSpec;
      if (!parsed.userGoal) parsed.userGoal = quest.requirement;
      spec = parsed;
    } catch {
      spec = this.generateSpec(quest.requirement, relatedKnowledge);
    }

    const relatedKnowledgeIds = relatedKnowledge.map((p) => p.id);
    await this.mutateState(async (s) => {
      const quests = s.quests.map((q) =>
        q.id === questId ? { ...q, spec, relatedKnowledgeIds, updatedAt: now() } : q
      );
      return { newState: { ...s, quests }, result: undefined };
    });
    yield { type: "spec_ready", spec };

    // 3) 依次发出其余时间线事件（带节奏延迟）
    const emit = async (type: string, title: string, detail: string, agent: string) => {
      const ev = this.event(questId, type, title, detail, agent);
      await this.mutateState(async (s) => ({ newState: { ...s, events: [ev, ...s.events] }, result: undefined }));
      return ev;
    };
    const pace = () => new Promise((r) => setTimeout(r, 350));

    await pace();
    yield { type: "event_added", event: await emit("spec.generated", "轻量 Spec 已生成", "Spec Agent 根据需求生成了初版目标、范围和验收标准。", "Spec Agent") };

    if (relatedKnowledge.length > 0) {
      await pace();
      yield { type: "event_added", event: await emit("knowledge.retrieved", "知识库已引用", `Agent 读取了 ${relatedKnowledge.length} 条相关知识。`, "Knowledge Agent") };
    }

    const userPrefs = await this.getUserPreferences(undefined, 0.5).catch(() => []);
    if (userPrefs.length > 0) {
      await pace();
      yield { type: "event_added", event: await emit("preference.injected", "用户偏好已注入", `检测到 ${userPrefs.length} 条用户偏好，将作为约束指导 Agent 行为。`, "用户习惯助手") };
    }

    const riskPatterns = await this.checkRisk(quest.requirement, quest.affectedProjectIds).catch(() => []);
    if (riskPatterns.length > 0) {
      await pace();
      yield { type: "event_added", event: await emit("risk.warning", "风险提示已生成", `发现 ${riskPatterns.length} 条相关失败经验，已提示 Agent 注意规避。`, "失败经验助手") };
    }

    const caps = this.recommendCapabilities(state.capabilities, quest.requirement, now());
    if (caps.length > 0) {
      await this.mutateState(async (s) => {
        const quests = s.quests.map((q) => (q.id === questId ? { ...q, capabilityRecommendations: caps } : q));
        return { newState: { ...s, quests }, result: undefined };
      });
      await pace();
      yield { type: "event_added", event: await emit("capability.recommended", "能力推荐已生成", `Capability Agent 推荐了 ${caps.length} 个可审计能力。`, "Capability Agent") };
    }

    // 4) 推进到 planning
    await pace();
    yield { type: "event_added", event: await emit("plan.created", "实施计划已生成", "Lead Agent 已将 Quest 推进到规划阶段，等待准备 worktree。", "Lead Agent") };

    let finalQuest!: Quest;
    await this.mutateState(async (s) => {
      const quests = s.quests.map((q) => (q.id === questId ? { ...q, status: "planning" as QuestStatus, updatedAt: now() } : q));
      finalQuest = quests.find((q) => q.id === questId)!;
      return { newState: { ...s, quests }, result: undefined };
    });
    yield { type: "done", quest: finalQuest };
  }
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @repohelm/core test -t "streaming"`
Expected: PASS（3 个用例）。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/service.ts packages/core/src/service.test.ts
git commit -m "feat: split createQuest and add streamQuestSpec generator"
```

---

## Task 4: 更新受 createQuest 行为变化影响的既有测试

**Files:**
- Modify: `packages/core/src/orchestrator.test.ts`、`packages/core/src/service.test.ts`（仅断言 spec 内容/事件数量/status 的用例）

- [ ] **Step 1: 找出受影响断言**

Run: `pnpm --filter @repohelm/core test`
Expected: 部分既有用例 FAIL——凡断言 `quest.status === "planning"` 紧随 `createQuest`、或断言 spec 模板字段、或断言事件包含 `spec.generated`/`capability.recommended` 的，现在 `createQuest` 只产出 `specifying` + `quest.created`。

- [ ] **Step 2: 逐个修正**

对每个失败用例做最小修改：
- 若用例只需 quest 存在/字段（如 `autoApprovePlan` 默认、`runQuest` 无 entry agent 报错），把对 `status`/spec 的断言改为 `specifying` 或删除无关断言。
- 若用例本意是验证完整 spec/事件，在 `createQuest` 后补一行驱动流：

```typescript
// 驱动流式生成把 quest 推进到 planning（fake 模式）
process.env.REPOHELM_FAKE_MODELS = "1";
process.env.REPOHELM_FAKE_STREAM_TEXT = '分析。\n```json\n{"userGoal":"g","background":"b","functionalRequirements":[],"nonFunctionalRequirements":[],"affectedSurfaces":[],"outOfScope":[],"acceptanceCriteria":[],"openQuestions":[]}\n```';
for await (const _ of service.streamQuestSpec(quest.id)) { /* drain */ }
delete process.env.REPOHELM_FAKE_MODELS;
delete process.env.REPOHELM_FAKE_STREAM_TEXT;
```

> 不要为了让旧断言通过而改回旧行为。旧的"createQuest 即出完整 spec"语义已被设计性替换。

- [ ] **Step 3: 运行确认全绿**

Run: `pnpm --filter @repohelm/core test`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/orchestrator.test.ts packages/core/src/service.test.ts
git commit -m "test: update quest tests for deferred spec generation"
```

---

## Task 5: server 新增 SSE 路由

**Files:**
- Modify: `apps/server/src/index.ts`（在 quests 相关路由附近新增；`formatSSE`/`setupSSE` 已 import）
- Test: `apps/server/src/index.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/server/src/index.test.ts` 末尾追加（复用文件内既有 app 构造方式；参考现有 quest 路由测试如何拿到 `app`/`service`）：

```typescript
it("GET /api/quests/:id/spec-stream streams spec events", async () => {
  process.env.REPOHELM_FAKE_MODELS = "1";
  process.env.REPOHELM_FAKE_STREAM_TEXT = '分析。\n```json\n{"userGoal":"g","background":"b","functionalRequirements":[],"nonFunctionalRequirements":[],"affectedSurfaces":[],"outOfScope":[],"acceptanceCriteria":[],"openQuestions":[]}\n```';
  try {
    const { app, service } = await createTestApp(); // 复用既有 helper
    const state = await service.bootstrap();
    const ws = state.workspaces[0]!;
    const quest = await service.createQuest({ workspaceId: ws.id, title: "t", requirement: "做个动画" });

    const res = await app.request(`/api/quests/${quest.id}/spec-stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: analysis_delta");
    expect(body).toContain("event: spec_ready");
    expect(body).toContain("event: done");
  } finally {
    delete process.env.REPOHELM_FAKE_MODELS;
    delete process.env.REPOHELM_FAKE_STREAM_TEXT;
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/server test -t "spec-stream"`
Expected: FAIL — 404 / 路由不存在。

- [ ] **Step 3: 新增路由**

在 `apps/server/src/index.ts` 的 quest 路由区追加：

```typescript
app.get("/api/quests/:id/spec-stream", async (c) => {
  const questId = c.req.param("id");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of service.streamQuestSpec(questId)) {
          controller.enqueue(encoder.encode(formatSSE(ev.type, ev)));
        }
      } catch (err) {
        controller.enqueue(encoder.encode(formatSSE("error", { message: String((err as Error)?.message ?? err) })));
      } finally {
        controller.close();
      }
    }
  });
  return setupSSE(c, stream);
});
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/server test -t "spec-stream"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/index.ts apps/server/src/index.test.ts
git commit -m "feat: add quest spec-stream SSE route"
```

---

## Task 6: 前端 api.ts 新增 EventSource 辅助

**Files:**
- Modify: `apps/web/src/api.ts`（新增导出；类型从 `@repohelm/core` 复用 `QuestSpecStreamEvent`）

- [ ] **Step 1: 新增辅助函数**

在 `apps/web/src/api.ts` 中（与其它 quest 方法同区）新增。先确认顶部已从 core 导入类型；若未导 `QuestSpecStreamEvent`，在现有 `import type { ... } from "@repohelm/core"` 增加它。

```typescript
export function streamQuestSpec(
  questId: string,
  handlers: {
    onAnalysis?: (text: string) => void;
    onSpecReady?: (spec: QuestSpec) => void;
    onEvent?: (event: AgentEvent) => void;
    onDone?: (quest: Quest) => void;
    onError?: (message: string) => void;
  }
): () => void {
  const es = new EventSource(`/api/quests/${questId}/spec-stream`);
  const parse = <T,>(e: MessageEvent): T => JSON.parse(e.data) as T;
  es.addEventListener("analysis_delta", (e) => handlers.onAnalysis?.(parse<{ text: string }>(e as MessageEvent).text));
  es.addEventListener("spec_ready", (e) => handlers.onSpecReady?.(parse<{ spec: QuestSpec }>(e as MessageEvent).spec));
  es.addEventListener("event_added", (e) => handlers.onEvent?.(parse<{ event: AgentEvent }>(e as MessageEvent).event));
  es.addEventListener("done", (e) => { handlers.onDone?.(parse<{ quest: Quest }>(e as MessageEvent).quest); es.close(); });
  es.addEventListener("error", (e) => {
    // EventSource 网络错误无 data；优雅关闭
    const data = (e as MessageEvent).data;
    handlers.onError?.(data ? (JSON.parse(data).message ?? "stream error") : "stream closed");
    es.close();
  });
  return () => es.close();
}
```

> `QuestSpec` / `AgentEvent` / `Quest` 应已在本文件从 `@repohelm/core` 导入（其它方法用过）；缺则补。

- [ ] **Step 2: 确认 web 类型检查通过**

Run: `pnpm --filter @repohelm/core build && pnpm --filter @repohelm/web typecheck`（若无该脚本用 `pnpm typecheck`）
Expected: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/api.ts
git commit -m "feat: add streamQuestSpec EventSource client helper"
```

---

## Task 7: App.tsx 接入流式渲染

**Files:**
- Modify: `apps/web/src/App.tsx`（`createQuest` @282；时间线渲染区 @1125 附近）

- [ ] **Step 1: 在 createQuest 中插入流式等待**

把 `App.tsx:282` 的 `createQuest` 改为：拿到 generating quest 后，打开流，累积分析文字到一个新 state（`streamingAnalysis`），等 `done` 后再 `await api.runQuest`。用 Promise 包住流：

```typescript
const quest = await api.createQuest({
  workspaceId: workspace.id,
  title: deriveRequestTitle(trimmedRequirement),
  requirement: trimmedRequirement,
  agentBackendId,
  entrySubAgentId: selectedEntrySubAgentId || undefined
});
setSelectedQuestId(quest.id);
setInspectorTab("plan");
setPendingAction("正在分析需求并生成 Spec...");
setStreamingAnalysis("");

await new Promise<void>((resolve) => {
  api.streamQuestSpec(quest.id, {
    onAnalysis: (text) => setStreamingAnalysis((prev) => prev + text),
    onSpecReady: () => { void load(); },          // 刷新拿到 spec
    onEvent: () => { void load(); },              // 逐条事件落库后刷新
    onDone: () => { setStreamingAnalysis(""); resolve(); },
    onError: () => { setStreamingAnalysis(""); resolve(); }
  });
});

setPendingAction("Supervisor 正在生成编排计划...");
await api.runQuest(quest.id);
```

新增 state（与其它 `useState` 同区）：

```typescript
const [streamingAnalysis, setStreamingAnalysis] = useState("");
```

- [ ] **Step 2: 在时间线/对话区渲染流式分析**

在渲染 `pendingAction` 或时间线的位置（参考 `App.tsx:1125` 附近事件列表上方），当 `streamingAnalysis` 非空时显示一个带 spinner 的"分析中"气泡：

```tsx
{streamingAnalysis && (
  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm text-[var(--text-2)]">
    <div className="mb-1 flex items-center gap-2 text-xs text-[var(--text-3)]">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
      Spec Agent 正在分析…
    </div>
    <div className="whitespace-pre-wrap">{streamingAnalysis}</div>
  </div>
)}
```

> 颜色一律用 token（`var(--...)`），不要硬编码——遵循项目 UI 约定。具体 class 命名对齐 `App.tsx` 既有气泡样式。

- [ ] **Step 3: 手动验证（真实模型）**

```bash
pnpm dev
```
打开 http://localhost:5173，进入 feiji workspace，输入"帮我生成一个 html 网页，里面是一个模拟太阳系的星球运动动画"提交。
预期：先出现"Spec Agent 正在分析…"+ 文字逐渐蹦出（2-5s）；随后 Spec 卡片淡入；时间线 6 条按节奏逐条出现，而非瞬间齐刷。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: render streaming spec analysis in quest creation"
```

---

## Task 8: e2e 适配 + 全量校验

**Files:**
- Modify: 受影响的 `e2e/*.spec.ts`（创建 quest 后断言 spec/事件的用例）

- [ ] **Step 1: 跑 e2e 找出受影响用例**

Run: `pnpm test:e2e`
Expected: 凡"创建 quest 后立即断言 spec 内容/planning 状态/事件齐全"的用例可能 FAIL（现在异步流式）。

- [ ] **Step 2: 适配**

对受影响用例，在断言前等待流式完成的可见信号（如等待 Spec 卡片出现 / 时间线 `plan.created` 行出现），用 Playwright `await expect(locator).toBeVisible()` 替代立即断言。e2e 默认 fake 模式（`REPOHELM_FAKE_MODELS=1`），流式会走 `REPOHELM_FAKE_STREAM_TEXT`——在 e2e 启动配置中设置该 env 为一段含 ```json 的固定文本（参考 playwright config 注入 env 的位置）。

- [ ] **Step 3: 全量校验**

Run: `pnpm test:all`
Expected: typecheck + 单测 + e2e 全绿。

- [ ] **Step 4: 提交**

```bash
git add e2e
git commit -m "test: adapt e2e to streaming quest spec generation"
```

---

## Self-Review 结论

- **Spec 覆盖**：流式 LLM(Task1)、状态/事件类型(Task2)、createQuest 拆分 + streamQuestSpec + 降级(Task3)、SSE 路由(Task5)、前端 EventSource + 渲染(Task6/7)、测试与 e2e(Task4/8) 全部对应。设计中"复用 specifying 替代新增 spec_generating"已在计划落实。
- **Placeholder 扫描**：无 TBD/TODO；每个改码步骤含完整代码。
- **类型一致**：`QuestSpecStreamEvent` 五个 variant 在 service/server/web 全程一致；`streamLlmWithModelKit`、`streamQuestSpec`、`placeholderSpec`、`buildSpecPrompt` 命名前后统一；fake env 用 `REPOHELM_FAKE_STREAM_TEXT` 全程一致。
- **风险**：`service.test.ts`/`index.test.ts` 的 service/app 构造 helper 名称需按各文件实际命名对齐（计划已注明"复用既有 helper"）；前端气泡 class 需对齐既有样式 token。
