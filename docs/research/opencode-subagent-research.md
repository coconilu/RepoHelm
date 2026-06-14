# Opencode Sub-agent 架构深度调研报告

## 执行摘要

本报告深入分析了位于 `/Users/chenmeili/Documents/GitHub/opencode` 的 Opencode 项目的 Sub-agent 实现机制。Opencode 采用了一套基于 **Task Tool** 的 Sub-agent 编排系统，通过声明式配置、权限继承、会话隔离和后台任务管理实现了灵活的多 Agent 协作架构。

---

## 1. Sub-agent 定义与管理

### 1.1 核心数据结构

#### Agent Info Schema (V2)

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/core/src/agent.ts`

```typescript
export class Info extends Schema.Class<Info>("AgentV2.Info")({
  id: ID,                              // Agent 唯一标识符
  model: ModelV2.Ref.pipe(Schema.optional),  // 绑定的模型引用
  request: ProviderV2.Request,         // 请求配置(headers, body)
  system: Schema.String.pipe(Schema.optional),    // 系统提示词
  description: Schema.String.pipe(Schema.optional), // 使用场景描述
  mode: Schema.Literals(["subagent", "primary", "all"]), // 运行模式
  hidden: Schema.Boolean,              // 是否在 UI 中隐藏
  color: Color.pipe(Schema.optional),  // UI 展示颜色
  steps: PositiveInt.pipe(Schema.optional),       // 最大迭代步数
  permissions: PermissionSchema.Ruleset,          // 权限规则集
})
```

**关键字段说明**:
- `mode`: 区分 agent 类型
  - `"subagent"`: 只能作为子任务被调用，不能作为主会话 agent
  - `"primary"`: 可作为主会话的默认 agent
  - `"all"`: 两种模式都支持
- `permissions`: 细粒度权限控制，决定该 agent 能执行哪些工具操作
- `model`: 可选的专用模型绑定，未指定时继承父会话模型

#### V1 Config Agent Schema

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/core/src/v1/config/agent.ts`

```typescript
const AgentSchema = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.optional(Schema.String),        // 模型标识 (如 "anthropic/claude-sonnet")
    variant: Schema.optional(Schema.String),      // 模型变体
    temperature: Schema.optional(Schema.Finite),  // 温度参数
    top_p: Schema.optional(Schema.Finite),        // Top-p 采样
    prompt: Schema.optional(Schema.String),       // 系统提示词
    tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)), // @deprecated
    disable: Schema.optional(Schema.Boolean),     // 是否禁用
    description: Schema.optional(Schema.String),  // 使用时机描述
    mode: Schema.optional(Schema.Literals(["subagent", "primary", "all"])),
    hidden: Schema.optional(Schema.Boolean),      // UI 隐藏标志
    options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
    color: Schema.optional(Color),                // 主题色
    steps: Schema.optional(PositiveInt),          // 最大步骤数
    permission: Schema.optional(ConfigPermissionV1.Info), // 权限配置
  }),
  [Schema.Record(Schema.String, Schema.Any)],     // 允许扩展字段
)
```

### 1.2 Agent 创建与配置加载

#### 配置文件格式

Opencode 支持多种配置方式：

**1. Markdown 文件配置** (推荐)

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/.opencode/agent/duplicate-pr.md`

```markdown
---
mode: primary
hidden: true
model: opencode/claude-haiku-4-5
color: "#E67E22"
tools:
  "*": false
  "github-pr-search": true
---

You are a duplicate PR detection agent. When a PR is opened, your job is to search for potentially duplicate or related open PRs.
...
```

**加载逻辑**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/config/agent.ts`

```typescript
export async function load(dir: string) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item)
    const name = configEntryNameFromPath(path.relative(dir, item), ["agent/", "agents/"])
    const config = {
      name,
      ...md.data,      // YAML frontmatter
      prompt: md.content.trim(),  // Markdown 正文作为 prompt
    }
    result[config.name] = ConfigParse.schema(ConfigAgentV1.Info, config, item)
  }
  return result
}
```

**2. JSON/JSONC 配置**

在 `opencode.json` 或 `opencode.jsonc` 中:

```json
{
  "agents": {
    "reviewer": {
      "model": "openrouter/openai/gpt-5",
      "description": "Review changes",
      "mode": "subagent",
      "permissions": [
        { "action": "edit", "resource": "*", "effect": "deny" },
        { "action": "read", "resource": "*", "effect": "allow" }
      ]
    }
  }
}
```

**3. Mode 文件** (自动设为 primary 模式)

扫描 `{mode,modes}/*.md` 目录，所有 mode 文件自动设置 `mode: "primary"`。

### 1.3 内置 Agent 定义

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/agent/agent.ts`

Opencode 预定义了 8 个内置 agent:

| Agent 名称 | 模式 | 用途 | 特殊权限 |
|-----------|------|------|---------|
| `build` | primary | 默认开发 agent | 允许 question, plan_enter |
| `plan` | primary | 只读分析模式 | 禁止 edit, 允许 plan_exit |
| `general` | subagent | 通用多步任务 | 禁止 todowrite |
| `explore` | subagent | 代码库探索 | 仅允许 read/grep/glob/bash/webfetch/websearch/list |
| `compaction` | primary (hidden) | 会话压缩 | 禁止所有工具 |
| `title` | primary (hidden) | 生成会话标题 | 禁止所有工具, temperature=0.5 |
| `summary` | primary (hidden) | 生成会话摘要 | 禁止所有工具 |

**Explore Agent 示例**:

```typescript
explore: {
  name: "explore",
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny",
      grep: "allow",
      glob: "allow",
      list: "allow",
      bash: "allow",
      webfetch: "allow",
      websearch: "allow",
      read: "allow",
      external_directory: readonlyExternalDirectory,
    }),
    user,
  ),
  description: `Fast agent specialized for exploring codebases...`,
  prompt: PROMPT_EXPLORE,  // 来自 explore.txt
  options: {},
  mode: "subagent",
  native: true,
}
```

### 1.4 Agent 与模型的绑定关系

**绑定策略**:

1. **显式绑定**: Agent 配置中指定 `model` 字段
   ```json
   {
     "model": "anthropic/claude-sonnet"
   }
   ```

2. **继承父会话模型**: 未指定 model 时，使用父会话的 modelID 和 providerID

**Task Tool 中的模型选择逻辑**:

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/tool/task.ts` (Lines 155-158)

```typescript
const model = next.model ?? {
  modelID: msg.info.modelID,
  providerID: msg.info.providerID,
}
```

**Variant 支持**: Agent 可指定默认 variant，仅在 using the agent's configured model 时生效。

---

## 2. Sub-agent 编排与路由

### 2.1 Task Tool: Sub-agent 调用入口

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/tool/task.ts`

Task Tool 是触发 sub-agent 的核心机制，相当于一个 "Agent 工厂"。

#### Task Tool 参数定义

```typescript
const Parameters = Schema.Struct({
  description: Schema.String.annotate({ 
    description: "A short (3-5 words) description of the task" 
  }),
  prompt: Schema.String.annotate({ 
    description: "The task for the agent to perform" 
  }),
  subagent_type: Schema.String.annotate({ 
    description: "The type of specialized agent to use for this task" 
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description: "Resume a previous task by task_id"
  }),
  command: Schema.optional(Schema.String).annotate({ 
    description: "The command that triggered this task" 
  }),
  background: Schema.optional(Schema.Boolean).annotate({
    description: "Run the agent in the background"
  }),
})
```

#### 执行流程

```typescript
const run = Effect.fn("TaskTool.execute")(function* (params, ctx) {
  // 1. 获取目标 agent 配置
  const next = yield* agent.get(params.subagent_type)
  if (!next) {
    return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type}`))
  }

  // 2. 获取或创建子会话
  const session = params.task_id
    ? yield* sessions.get(SessionID.make(params.task_id))
    : undefined
  
  const nextSession = session ?? (yield* sessions.create({
    parentID: ctx.sessionID,  // 建立父子关系
    title: params.description + ` (@${next.name} subagent)`,
    agent: next.name,
    permission: deriveSubagentSessionPermission({
      parentSessionPermission: parent.permission ?? [],
      parentAgent,
      subagent: next,
    }),
  }))

  // 3. 确定模型配置
  const model = next.model ?? {
    modelID: msg.info.modelID,
    providerID: msg.info.providerID,
  }

  // 4. 构建子任务 prompt parts
  const parts = yield* ops.resolvePromptParts(params.prompt)

  // 5. 在子会话中执行 prompt
  const result = yield* ops.prompt({
    messageID: MessageID.ascending(),
    sessionID: nextSession.id,
    model: { modelID: model.modelID, providerID: model.providerID },
    agent: next.name,
    tools: {
      // 根据 subagent 权限动态禁用某些工具
      ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
      ...(next.permission.some((rule) => rule.permission === id) ? {} : { task: false }),
      ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
    },
    parts,
  })

  // 6. 返回结果
  return result.parts.findLast((item) => item.type === "text")?.text ?? ""
})
```

### 2.2 路由决策机制

**当前实现**: Opencode **没有自动路由机制**。Sub-agent 的选择完全由 **主 agent 显式指定**。

**工作流程**:

```
用户输入 → 主 Agent (build/plan) → 判断需要子任务 
         → 调用 Task Tool (指定 subagent_type) 
         → Sub-agent 执行 
         → 返回结果给主 Agent
```

**Agent 选择依据**:

1. **LLM 自主决策**: 主 Agent 根据任务描述和可用 agent 列表自主决定使用哪个 subagent
2. **System Prompt 指导**: 在 `task.txt` 中提供使用指南

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/tool/task.txt`

```
When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Glob tool instead
- If you are searching for a specific class definition like "class Foo", use the Grep tool instead
- If no available agent is a good fit for the task, use other tools directly

Usage notes:
1. Launch multiple agents concurrently whenever possible
2. Once you have delegated work to an agent, do not duplicate that work yourself
3. Each agent invocation starts with a fresh context unless you provide task_id
4. Clearly tell the agent whether you expect it to write code or just do research
```

3. **UI 辅助选择**: 用户可通过 `@agent_name` 语法直接指定 agent

### 2.3 入口 Agent (Entry Point) 概念

**默认 Entry Point**: `build` agent

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/core/src/agent.ts`

```typescript
export const defaultID = ID.make("build")

// 默认 agent 选择逻辑
const selectedDefault = () => {
  const data = state.get()
  const configured = data.default ? selectable(data.agents.get(data.default)) : undefined
  if (configured) return configured
  const build = selectable(data.agents.get(ID.make("build")))
  if (build) return build
  // Fallback: 第一个非 subagent 且非 hidden 的 agent
  for (const agent of data.agents.values()) {
    const fallback = selectable(agent)
    if (fallback) return fallback
  }
}

function selectable(agent: Info | undefined) {
  return agent && agent.mode !== "subagent" && !agent.hidden ? agent : undefined
}
```

**配置覆盖**: 用户可在 `opencode.json` 中设置 `default_agent` 字段自定义入口 agent。

### 2.4 Sub-agent 协作与通信机制

#### 会话层级结构

```
Parent Session (session_id: abc123, agent: build)
├─ Message 1: User prompt
├─ Message 2: Assistant response with Task Tool call
│  └─ Child Session (session_id: def456, agent: explore, parentID: abc123)
│     ├─ Message 1: Task prompt
│     ├─ Message 2: Assistant exploration results
│     └─ Return: Text summary to parent
└─ Message 3: Assistant continues with subagent result
```

**关键特性**:

1. **会话隔离**: 每个 subagent 在独立的 session 中运行
2. **上下文不共享**: Subagent 启动时是 "fresh context"，除非提供 `task_id` 恢复历史
3. **结果回传**: Subagent 的最终文本输出通过 `<task_result>` XML 标签返回给父 agent

**输出格式**:

```typescript
function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}
```

#### 权限继承机制

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/agent/subagent-permissions.ts`

```typescript
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  parentAgent: Agent.Info | undefined
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  
  // 继承父 agent 的 edit deny 规则 (Plan Mode 的关键)
  const parentAgentDenies =
    input.parentAgent?.permission.filter((rule) => rule.action === "deny" && rule.permission === "edit") ?? []
  
  return [
    ...parentAgentDenies,  // 1. 父 agent 的 deny 规则
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny"
    ),  // 2. 父会话的 deny 和 external_directory 规则
    ...(canTodo ? [] : [{ permission: "todowrite", pattern: "*", action: "deny" }]),  // 3. 默认禁用 todowrite
    ...(canTask ? [] : [{ permission: "task", pattern: "*", action: "deny" }]),       // 4. 默认禁用嵌套 task
  ]
}
```

**设计意图**:
- Plan Mode 的 `edit: deny` 规则会传递给 subagent，防止 subagent 绕过限制
- Subagent 默认不能创建新的 subagent (防止无限递归)，除非显式授权

### 2.5 后台任务 (Background Jobs)

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/core/src/background-job.ts`

Opencode 支持异步执行 subagent 任务，主 agent 可继续工作而不阻塞等待。

#### Background Job 状态机

```
running → completed (成功)
running → error (失败)
running → cancelled (取消)
```

#### 核心 API

```typescript
export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly extend: (input: ExtendInput) => Effect.Effect<boolean>  // 追加新任务到现有 job
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly waitForPromotion: (id: string) => Effect.Effect<Info>   // 等待后台任务提升为前台
  readonly promote: (id: string) => Effect.Effect<Info | undefined> // 将后台任务提升为前台会话
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
}
```

#### Task Tool 中的后台模式

```typescript
if (runInBackground) {
  // 立即返回，不等待结果
  yield* notify(info.id)
  return backgroundResult()
}

// 前景模式: 等待任务完成
const result = yield* Effect.raceFirst(
  background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
  background.waitForPromotion(nextSession.id),
)
```

**使用场景**:
- 独立的研究任务 (如代码探索)
- 长时间运行的测试或构建
- 并行执行的多个子任务

---

## 3. 架构设计模式

### 3.1 整体架构图 (文字描述)

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interface Layer                     │
│  (TUI / Web UI / Desktop App)                               │
│  - Agent selection menu (@agent)                             │
│  - Subagent tabs & navigation                                │
│  - Task visualization                                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   API / SDK Layer                            │
│  - GET /api/agent (list agents)                              │
│  - POST /api/session/prompt (execute prompt)                 │
│  - WebSocket events (real-time updates)                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  Session Management Layer                    │
│  - Session creation with parentID                            │
│  - Message history persistence (SQLite)                      │
│  - Context epoch management                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   Agent Orchestration Layer                  │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Agent Service │◄──►│ Task Tool    │◄──►│Background Job│  │
│  │ - get()      │    │ - execute()  │    │ - start()    │  │
│  │ - list()     │    │ - permission │    │ - wait()     │  │
│  │ - generate() │    │ - routing    │    │ - promote()  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  Configuration Layer                         │
│  - Markdown file loading (.opencode/agent/*.md)             │
│  - JSON config merging (opencode.json)                       │
│  - Plugin-defined agents                                     │
│  - Built-in agents (build, plan, explore, general)           │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  Permission Engine                           │
│  - Rule-based access control                                 │
│  - Parent→Child permission inheritance                       │
│  - Tool-level authorization                                  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据流分析

#### Subagent 执行数据流

```
1. User Input
   ↓
2. Main Agent receives prompt
   ↓
3. LLM decides to delegate → generates Task Tool call
   ↓
4. Task Tool.execute() invoked
   ├─ 4a. Lookup agent config by subagent_type
   ├─ 4b. Create child session (parentID = current session)
   ├─ 4c. Derive permissions (parent rules + agent rules)
   ├─ 4d. Resolve model (agent.model ?? parent.model)
   └─ 4e. Build prompt parts from task description
   ↓
5. Session.prompt() called on child session
   ├─ 5a. Load system context for child agent
   ├─ 5b. Assemble message history (empty for new session)
   ├─ 5c. Call LLM provider with agent-specific config
   └─ 5d. Execute tool calls within permission bounds
   ↓
6. Child session completes
   ├─ Extract final text output
   ├─ Format as <task_result> XML
   └─ Inject into parent session as synthetic message
   ↓
7. Main Agent continues with subagent result
```

#### 配置加载数据流

```
Startup
  ↓
Scan directories (global, project, .opencode)
  ↓
For each directory:
  ├─ Load opencode.json / opencode.jsonc
  ├─ Scan {agent,agents}/**/*.md
  │   ├─ Parse YAML frontmatter
  │   ├─ Extract markdown content as prompt
  │   └─ Merge into agent registry
  ├─ Scan {mode,modes}/*.md
  │   └─ Auto-set mode: "primary"
  └─ Load plugin-defined agents
  ↓
Merge configurations (later sources override earlier)
  ↓
Initialize built-in agents (build, plan, explore, etc.)
  ↓
Apply user overrides from config
  ↓
Final agent registry ready
```

### 3.3 状态管理

#### InstanceState Pattern

Opencode 使用 `InstanceState` 管理运行时状态，支持热重载。

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/effect/instance-state.ts`

```typescript
// Agent service 使用 InstanceState
const state = yield* InstanceState.make<State>(
  Effect.fn("Agent.state")(function* (ctx) {
    // 构建初始 agent 映射
    const agents: Record<string, Info> = { ... }
    
    return {
      get: (agent: string) => Effect.succeed(agents[agent]),
      list: () => Effect.succeed(Object.values(agents)),
      defaultInfo: () => ...,
      defaultAgent: () => ...,
    }
  })
)

// 服务接口通过 state 访问
return Service.of({
  get: (agent) => InstanceState.useEffect(state, (s) => s.get(agent)),
  list: () => InstanceState.useEffect(state, (s) => s.list()),
  // ...
})
```

**优势**:
- 配置变更时可重新计算 state 而无需重启服务
- 订阅者可响应状态变化
- 支持作用域隔离 (不同 workspace 有不同的 agent 注册表)

### 3.4 可借鉴的设计模式

#### 模式 1: 声明式 Agent 配置

**特点**:
- Agent 定义与代码分离 (Markdown/YAML)
- Frontmatter 元数据 + 正文 prompt
- 支持目录扫描自动发现

**适用场景**: RepoHelm 可采用类似方式让用户轻松定义 Quest 专用的 sub-agents

#### 模式 2: 权限继承与沙箱

**特点**:
- 子会话继承父会话的 deny 规则
- Agent 级别的 permission ruleset
- 默认最小权限原则 (deny by default)

**价值**: 确保 subagent 不会绕过主会话的安全策略

#### 模式 3: 会话隔离 + 上下文不共享

**特点**:
- 每个 subagent 有独立 session ID
- Fresh context 避免上下文污染
- 通过 `task_id` 支持会话恢复

**优势**: 
- 清晰的职责边界
- 易于调试和审计
- 支持并行执行

#### 模式 4: Task Tool 抽象

**特点**:
- 统一的 subagent 调用接口
- 支持 foreground/background 模式
- 结构化输出格式 (XML tags)

**可借鉴**: RepoHelm 可设计类似的 "Quest Delegation Tool"

#### 模式 5: Background Job 生命周期管理

**特点**:
- 异步任务跟踪
- 自动通知完成
- 支持提升到前台会话

**应用场景**: 长时间运行的验证、测试、知识库构建

#### 模式 6: Model Binding Flexibility

**特点**:
- Agent 可绑定专用模型
- 未绑定时继承父会话模型
- 支持 model variant

**价值**: 可为不同任务选择成本/性能最优的模型

---

## 4. 配置文件和持久化

### 4.1 配置存储位置

Opencode 按优先级扫描以下目录:

1. **全局配置**: `$XDG_CONFIG_HOME/opencode` 或 `~/.config/opencode`
2. **项目配置**: 项目根目录的 `.opencode/`
3. **Workspace 配置**: 特定 workspace 目录

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/config/paths.ts`

### 4.2 配置合并策略

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/config/config.ts` (Line 453-454)

```typescript
result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir)))
result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir)))
```

**合并规则**:
- 后续来源的配置深度合并 (deep merge) 到前面的配置
- 同名 agent 的配置会被覆盖
- `disable: true` 可移除内置 agent

### 4.3 "ModelKit" 类比配置抽象

Opencode **没有** 明确的 "ModelKit" 概念，但有以下相关抽象:

#### Provider Catalog

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/core/src/provider.ts`

Provider Catalog 管理可用的 LLM 提供商和模型:

```typescript
// 模型引用格式
{
  providerID: "anthropic",
  id: "claude-sonnet-4",
  variant: "thinking"  // 可选
}
```

#### Agent Request Configuration

Agent 可配置请求级别的参数:

```typescript
request: {
  headers: { "x-custom": "value" },
  body: {
    temperature: 0.7,
    max_tokens: 4096,
    effort: "high"  // Anthropic-specific
  }
}
```

#### 与 RepoHelm 的对比

| 特性 | Opencode | RepoHelm (推测) |
|-----|----------|----------------|
| Agent 定义 | Markdown + YAML frontmatter | 可能使用 JSON/TS |
| 模型绑定 | Agent 级别可选绑定 | 需确认 |
| 权限系统 | 细粒度 rule-based | 可能有类似机制 |
| 配置热重载 | 支持 (InstanceState) | 需确认 |
| 会话持久化 | SQLite + 文件系统 | SQLite (state.sqlite) |

### 4.4 持久化机制

#### Session 持久化

**数据库**: SQLite (`state.sqlite`)

**表结构** (推断):
- `sessions`: 会话元数据 (id, parent_id, agent, model, title, etc.)
- `messages`: 消息历史
- `parts`: 消息片段 (tool calls, text, etc.)

**文件路径**: `/Users/chenmeili/Documents/GitHub/opencode/packages/core/src/session/sql.ts`

#### Agent 配置持久化

Agent 配置 **不持久化到数据库**，而是:
- 从文件系统实时加载
- 运行时缓存在 InstanceState 中
- 配置变更触发重新加载

---

## 5. 与 RepoHelm 架构的对比分析

### 5.1 相似之处

| 维度 | Opencode | RepoHelm |
|-----|----------|----------|
| **多 Agent 支持** | ✓ (build, plan, explore, custom) | ✓ (需确认具体实现) |
| **会话隔离** | ✓ (parent-child sessions) | ✓ (worktree isolation) |
| **配置驱动** | ✓ (Markdown/JSON) | ✓ (可能使用不同格式) |
| **权限控制** | ✓ (rule-based) | ✓ (命令 allowlist, file scope) |
| **后台任务** | ✓ (BackgroundJob) | 需确认 |
| **知识库集成** | ✗ (无明确 KB 概念) | ✓ (Markdown files + metadata) |
| **Spec 驱动** | ✗ | ✓ (Spec-driven Quests) |
| **GitHub PR 集成** | ✓ (via plugins) | ✓ (ENABLE_GH_PR) |

### 5.2 关键差异

#### 1. Sub-agent 路由机制

**Opencode**: 
- ❌ 无自动路由
- ✅ LLM 自主决策 + 用户显式指定 (`@agent`)

**RepoHelm**: 
- 需调研是否有 Capability Agent 推荐机制
- Spec 驱动可能意味着更结构化的任务分发

#### 2. 上下文管理

**Opencode**:
- Subagent 启动时为 fresh context
- 通过 `task_id` 恢复历史
- Context Epoch 概念 (baseline system context)

**RepoHelm**:
- Worktree 隔离可能意味着物理文件隔离
- 需了解如何在 Quest 间共享上下文

#### 3. 任务编排粒度

**Opencode**:
- Task Tool 级别: 单次 subagent 调用
- 支持并发多个 tasks

**RepoHelm**:
- Quest 级别: 可能是多步骤工作流
- 需了解 Quest 内部是否使用 sub-agents

#### 4. 模型配置抽象

**Opencode**:
- Provider Catalog + Agent-level binding
- Request-level customization

**RepoHelm**:
- 环境变量配置 (`REPOHELM_OPENAI_*`)
- 需确认是否有 per-Agent 模型绑定

### 5.3 可借鉴的设计

#### 对 RepoHelm 的建议

1. **引入声明式 Agent 配置**
   ```markdown
   # .repohelm/agents/code-reviewer.md
   ---
   mode: subagent
   model: anthropic/claude-sonnet
   permissions:
     read: allow
     edit: deny
     bash: ask
   ---
   
   You are a code review specialist...
   ```

2. **实现 Task Delegation Tool**
   - 类似 Opencode 的 Task Tool
   - 支持 `quest_id` 恢复长期任务
   - Foreground/Background 模式

3. **权限继承机制**
   - Quest 级别的权限传递给 sub-tasks
   - 防止 sub-agent 绕过安全策略

4. **Background Quest 支持**
   - 异步执行验证、测试、文档生成
   - 自动通知完成状态

5. **Agent Registry API**
   ```typescript
   GET /api/agents          // 列出可用 agents
   GET /api/agents/:name    // 获取 agent 详情
   POST /api/agents/generate // AI 生成新 agent 配置
   ```

6. **UI 增强**
   - Sub-agent 标签页导航
   - 任务执行可视化
   - Agent 选择菜单 (`@agent` autocomplete)

---

## 6. 关键源码文件索引

### 核心实现文件

| 文件路径 | 用途 | 行数 |
|---------|------|------|
| `/packages/opencode/src/tool/task.ts` | Task Tool 实现 (subagent 执行引擎) | 340 |
| `/packages/opencode/src/agent/agent.ts` | Agent Service (注册、查询、生成) | 434 |
| `/packages/opencode/src/agent/subagent-permissions.ts` | 权限继承逻辑 | 36 |
| `/packages/core/src/agent.ts` | Agent V2 Schema & Service | 143 |
| `/packages/core/src/background-job.ts` | 后台任务管理器 | 365 |
| `/packages/opencode/src/session/prompt.ts` | Session Prompt 执行 (包含 task 调用) | 1756 |
| `/packages/opencode/src/config/agent.ts` | Agent 配置加载 (Markdown/Mode) | 69 |
| `/packages/core/src/v1/config/agent.ts` | Agent Config Schema V1 | 90 |

### 配置文件示例

| 文件路径 | 用途 |
|---------|------|
| `/.opencode/agent/duplicate-pr.md` | GitHub PR 去重 agent |
| `/.opencode/agent/triage.md` | Issue 分类 agent |
| `/packages/opencode/src/tool/task.txt` | Task Tool system prompt |
| `/packages/opencode/src/agent/prompt/explore.txt` | Explore agent system prompt |

### UI 组件

| 文件路径 | 用途 |
|---------|------|
| `/packages/ui/src/components/message-part.tsx` | Task/Subagent UI 渲染 |
| `/packages/opencode/src/cli/cmd/run/footer.view.tsx` | Footer 视图 (subagent 菜单) |
| `/packages/opencode/src/cli/cmd/run/footer.subagent.tsx` | Subagent 标签页组件 |

### 测试文件

| 文件路径 | 用途 |
|---------|------|
| `/packages/core/test/config/agent.test.ts` | Agent 配置加载测试 |
| `/packages/core/test/agent.test.ts` | Agent Service 测试 |

---

## 7. 总结与建议

### 7.1 Opencode Sub-agent 架构亮点

1. ✅ **简洁的 Task Tool 抽象**: 统一的 subagent 调用接口
2. ✅ **灵活的配置系统**: Markdown + YAML，易于编辑和版本控制
3. ✅ **严格的权限继承**: 防止 subagent 绕过安全策略
4. ✅ **会话隔离**: 清晰的职责边界，易于调试
5. ✅ **后台任务支持**: 非阻塞执行，提升用户体验
6. ✅ **模型绑定灵活性**: per-agent 模型选择

### 7.2 局限性

1. ❌ **无自动路由**: 依赖 LLM 自主决策，可能选择不当
2. ❌ **上下文不共享**: 每次 subagent 调用都是 fresh start，需重复传递上下文
3. ❌ **无 Agent 协作协议**: Subagents 之间无法直接通信
4. ❌ **无任务分解自动化**: 需主 agent 手动拆分任务

### 7.3 对 RepoHelm 的具体建议

#### 短期改进 (1-2 周)

1. **实现 Agent Registry API**
   - 暴露可用 agents 列表
   - 支持动态注册/注销

2. **添加 Task Delegation Tool**
   - 封装 subagent 调用逻辑
   - 支持 foreground/background 模式

3. **UI 增强**
   - Subagent 执行状态可视化
   - Agent 选择 autocomplete

#### 中期改进 (1-2 月)

4. **智能路由机制**
   - 基于任务描述的 agent 推荐
   - Capability matching 算法

5. **上下文共享优化**
   - 可选的上下文继承模式
   - 知识库引用自动注入

6. **Agent 协作协议**
   - Subagent 间消息传递
   - 任务链式编排

#### 长期愿景 (3-6 月)

7. **Agent Marketplace**
   - 社区贡献的 agent 模板
   - 一键安装和配置

8. **自适应学习**
   - 记录 agent 使用效果
   - 自动优化路由策略

9. **多模态 Agent**
   - 支持图像、音频处理
   - 专用模型绑定

---

## 附录 A: 术语表

| 术语 | 定义 |
|-----|------|
| **Sub-agent** | 被主 agent 调用的专用 agent，在独立 session 中运行 |
| **Task Tool** | 调用 sub-agent 的工具接口 |
| **Session** | 一次完整的对话会话，包含消息历史 |
| **Parent Session** | 发起 subagent 调用的会话 |
| **Child Session** | subagent 执行的会话，有 parentID 指向父会话 |
| **Context Epoch** | system context 保持不变的时段 |
| **Background Job** | 异步执行的任务，不阻塞主流程 |
| **Permission Ruleset** | 定义 agent 可执行操作的规则集合 |
| **Mode** | Agent 运行模式: subagent/primary/all |
| **Variant** | 模型的变体配置 (如 thinking/non-thinking) |

---

## 附录 B: 参考链接

- Opencode 官方文档: https://opencode.ai/docs/agents
- Task Tool 源码: `/packages/opencode/src/tool/task.ts`
- Agent Service 源码: `/packages/opencode/src/agent/agent.ts`
- Background Job 源码: `/packages/core/src/background-job.ts`

---

**报告生成时间**: 2026-06-07  
**调研范围**: Opencode repository at `/Users/chenmeili/Documents/GitHub/opencode`  
**报告作者**: Research Analyst Agent
