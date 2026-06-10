# 专家团编排系统设计文档

> 日期：2026-06-10
> 状态：待实施
> 作者：BayesWang（设计），Claude Code（协助）

## 1. 概述

将 RepoHelm 现有的静态 Plan-then-Execute 编排模式替换为**动态专家团模式**。入口 Agent 通过对话理解需求、自动拆解任务树，用户可交互调整，确认后进入 TDD 测试先行执行流程。UI 层面新增 6 个 Inspector Tab 全景展示编排信息。

### 核心目标

- 入口 Agent 混合模式：自动出初版 → 用户交互调整 → 确认执行
- 预设专家原型 + 入口 Agent 可临时创建新 Agent
- TDD 流程内建：验收用例 → 具体测试 → 红绿重构
- 调研内嵌在任务拆解过程中，结果自然融入任务节点
- 全部迁移，统一新模式

### 非目标

- 不改变 `RepoHelmService` 作为核心 facade 的地位
- 不引入新的状态存储后端（继续用 SQLite）
- 不改变 Agent 后端执行机制（BYOK / CLI 模式不变）

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    RepoHelmService                       │
│  (facade 不变，新增 expert 相关方法)                       │
└──────────┬──────────────────────────────────┬───────────┘
           │                                  │
     ┌─────▼──────┐                  ┌────────▼────────
     │ 旧: SubAgent│                  │ 新: Expert      │
     │ Orchestrator│ (deprecated)     │ Orchestrator    │
     └────────────                  └────────────────┘
                                              │
              ┌───────────────────────────────┼──────────────┐
              │                               │              │
     ┌────────▼───────┐            ─────────▼──────┐  ┌────▼──────────┐
     │ Expert Session │            │ Agent Pool     │  │ Research      │
     │ Manager        │            │ Manager        │  │ Collector     │
     │ (任务树/状态)   │            │ (原型+动态创建)  │  │ (代码调研)     │
     └───────────────            └────────────────┘  └───────────────
              │
     ┌────────▼───────┐
     │ TDD Pipeline   │
     │ (用例→测试→实现)│
     └────────────────
```

### 关键文件变化

| 操作 | 文件 | 说明 |
|------|------|------|
| **新建** | `packages/core/src/expert/orchestrator.ts` | ExpertOrchestrator 主类 |
| **新建** | `packages/core/src/expert/types.ts` | 新数据模型 |
| **新建** | `packages/core/src/expert/agent-pool.ts` | Agent Pool 管理（原型+动态创建） |
| **新建** | `packages/core/src/expert/research-collector.ts` | 内嵌代码调研收集器 |
| **新建** | `packages/core/src/expert/tdd-pipeline.ts` | TDD 流程管道 |
| **新建** | `packages/core/src/expert/migration.ts` | 旧 Quest → 新模型迁移 |
| **修改** | `packages/core/src/service.ts` | 新增 expert 相关方法，旧方法标记 deprecated |
| **修改** | `packages/core/src/types.ts` | 新增类型导出 |
| **修改** | `apps/server/src/index.ts` | 新增 expert 相关 API |
| **修改** | `apps/web/src/api.ts` | 新增前端类型和 API 调用 |
| **修改** | `apps/web/src/App.tsx` | Inspector tab 重构 |

### 设计原则

- **Expert Session 是新的执行单元**：一个 Quest 启动后创建一个 Expert Session，管理整个生命周期（需求分析 → 任务树生成 → 用户交互调整 → 确认 → TDD 执行 → 交付）
- **Agent Pool 是可扩展的**：预设专家原型注册到 Pool，入口 Agent 可以在运行时请求创建临时 Agent，Pool 负责实例化和生命周期管理
- **Research Collector 是副作用**：不是独立阶段，而是入口 Agent 拆解任务时的伴随行为——每分析一个子任务，同步收集相关代码上下文，结果写入对应任务节点
- **TDD Pipeline 是执行策略**：不是独立流程，而是任务执行的方式——每个实现类任务自动进入"用例 → 测试 → 实现 → 验证"循环

---

## 3. 数据模型

### 3.1 Expert Session（核心）

```typescript
interface ExpertSession {
  id: string;                    // expert_<questId>
  questId: string;
  status: ExpertSessionStatus;
  entryAgentId: string;

  taskTree: ExpertTaskNode;      // 根节点，子任务递归嵌套
  flatTasks: ExpertTask[];       // 扁平列表，便于 UI 遍历

  acceptanceTests: AcceptanceTest[];
  research: CodeResearchResult[];
  agentPool: AgentPoolSnapshot;

  createdAt: string;
  confirmedAt?: string;
  completedAt?: string;
}

type ExpertSessionStatus =
  | "analyzing"
  | "awaiting_confirmation"
  | "confirmed"
  | "executing"
  | "completed"
  | "failed";
```

### 3.2 任务树

```typescript
interface ExpertTaskNode {
  id: string;
  title: string;
  type: TaskNodeType;
  status: TaskStatus;
  assignedAgentId?: string;
  assignedAgentName?: string;
  children: ExpertTaskNode[];
  dependencies: string[];

  research?: CodeResearchResult;
  artifacts: TaskArtifact[];
  acceptanceTestIds?: string[];

  description: string;
  expectedOutput: string;
}

type TaskNodeType = "root" | "analysis" | "research" | "implementation" | "test" | "review" | "delivery";
type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
```

### 3.3 扁平任务

```typescript
interface ExpertTask {
  id: string;
  nodeId: string;
  title: string;
  description: string;
  type: TaskNodeType;
  status: TaskStatus;
  assignedAgentId?: string;
  assignedAgentName?: string;
  agentAvatar?: string;
  progress?: number;           // 0-100
  startedAt?: string;
  completedAt?: string;
  artifacts: TaskArtifact[];
  failureReason?: string;
}
```

### 3.4 验收用例

```typescript
interface AcceptanceTest {
  id: string;
  title: string;
  description: string;
  status: AcceptanceTestStatus;
  testType: "unit" | "integration" | "e2e";
  relatedTaskIds: string[];

  userConfirmed: boolean;
  userNotes?: string;

  generatedTestPath?: string;
  testOutput?: string;
}

type AcceptanceTestStatus = "draft" | "confirmed" | "generated" | "passing" | "failing";
```

### 3.5 代码调研结果

```typescript
interface CodeResearchResult {
  id: string;
  taskId?: string;
  type: "reusable_function" | "existing_logic" | "proposed_change" | "related_code";
  title: string;
  filePath?: string;
  codeSnippet?: string;
  lineRange?: { start: number; end: number };
  summary: string;

  proposedLogic?: string;
  reasoning?: string;
}
```

### 3.6 Agent Pool

```typescript
interface AgentPrototype {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  systemPromptTemplate: string;
  defaultModelKitId?: string;
  isBuiltIn: boolean;
}

interface DynamicAgent extends AgentPrototype {
  createdBy: string;
  createdAt: string;
  taskId?: string;
  ttl?: number;
}

type AgentPoolEntry = AgentPrototype | DynamicAgent;

interface AgentPoolSnapshot {
  prototypes: AgentPrototype[];
  dynamicAgents: DynamicAgent[];
  activeAgents: string[];
}
```

### 3.7 任务产物

```typescript
interface TaskArtifact {
  id: string;
  taskId: string;
  type: "file_change" | "test_result" | "research_summary" | "review_comment";
  filePath?: string;
  projectId?: string;
  summary: string;
  diff?: string;
  createdAt: string;
}
```

### 3.8 错误码

```typescript
type ExpertErrorCode =
  | "ANALYSIS_FAILED"
  | "AGENT_UNAVAILABLE"
  | "TASK_EXECUTION_FAILED"
  | "TDD_ITERATION_EXCEEDED"
  | "WORKTREE_CREATION_FAILED"
  | "TEST_GENERATION_FAILED"
  | "TEST_RUN_FAILED"
  | "DYNAMIC_AGENT_LIMIT"
  | "SESSION_TIMEOUT"
  | "KNOWLEDGE_SEARCH_FAILED"
  | "OTHER";
```

每个错误附带：`code`、`message`（用户友好）、`detail`（技术细节）、`recoverable`（是否可重试）、`affectedTaskIds`。

### 3.9 与旧模型的映射

| 旧数据 | 迁移到新数据 |
|--------|-------------|
| `Quest.changedFiles[]` | → `TaskArtifact[]` (type: "file_change") |
| `Quest.agentSummary` | → 根节点 summary |
| `OrchestrationPlan.steps[]` | → `ExpertTask[]` |
| `AgentEvent[]` | → `ExpertTask.status` 变更记录 |
| `Quest.relatedKnowledgeIds` | → `CodeResearchResult` (type: "related_code") + 引用面板 |

---

## 4. Expert Orchestrator 执行流程

### 4.1 完整生命周期

```
用户提交 Quest 需求
        │
        ▼
─────────────────────────────────────────────┐
│ Phase 1: Analyzing                           │
│  1. 入口 Agent 加载上下文（偏好/失败经验/知识） │
│  2. Research Collector 伴随扫描代码            │
│  3. 生成初版任务树 + 验收用例 (draft)          │
│  4. Session → "awaiting_confirmation"        │
└─────────────────────────────────────────────
        │
        ▼
┌─────────────────────────────────────────────┐
│ Phase 2: User Interaction                    │
│  用户查看/调整任务树和验收用例                  │
│  可追问入口 Agent，实时调整                    │
│  确认后 → Session → "confirmed"              │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│ Phase 3: TDD Pipeline                        │
│  对每个 implementation 任务：                   │
│  A. 测试 Agent 生成具体测试（红）              │
│  B. 运行测试确认失败                          │
│  C. 专家 Agent 实现代码（绿）                  │
│  D. 运行测试验证 → 通过则完成，失败则回 C       │
│     最大迭代 3 次                              │
│  按依赖拓扑序执行，无依赖并行                   │
│  全部完成 → Session → "completed"             │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│ Phase 4: Post-Execution                      │
│  KB Agent 总结 → 更新知识库                    │
│  Failure Experience Agent 记录失败模式          │
│  Habits Agent 更新用户偏好                      │
│  生成 delivery commit / PR                    │
└─────────────────────────────────────────────┘
```

### 4.2 关键设计决策

1. **Research Collector 是伴随的**：入口 Agent 每分析一个子任务，同步调用 Research Collector，结果直接写入任务节点的 `research` 字段
2. **用户交互通过 API**：`PATCH /api/expert/session/:id/task` 修改任务，`POST /api/expert/session/:id/chat` 追问
3. **TDD 安全阀**：最大迭代 3 次、单任务超时可配置（默认 10 分钟）、失败回退继续其他任务
4. **并行策略**：同层无依赖并行，同项目串行（避免 worktree 冲突）

---

## 5. Inspector Tab 重构

### 5.1 Tab 布局

| Tab ID | 标签名 | 可见条件 | 说明 |
|--------|--------|----------|------|
| `orchestration` | **编排** | Session 存在即显示 | Agent 示意图 + 任务树全景 |
| `progress` | **进展** | Session 存在即显示 | 任务进展列表 |
| `acceptance` | **验收** | 有验收用例即显示 | 验收用例列表 + 状态跟踪 |
| `deliverables` | **产物** | 有产物即显示 | 文件列表 + diff 查看 |
| `references` | **引用** | 有引用数据即显示 | 知识库 + 用户习惯 + 反例 |
| `research` | **调研** | 有调研结果即显示 | 代码调研结果 |

### 5.2 各 Tab 详情

#### 编排 Tab
- **Agent 示意图**：入口 Agent 顶部中央，子 Agent 按类型分组，连线表示任务分配，颜色表示状态
- **任务树**：树形结构可折叠，显示标题/Agent/状态/预计产出
- 交互：点击节点跳转进展、`awaiting_confirmation` 下可编辑

#### 进展 Tab
- 扁平任务列表，按执行顺序排列
- 每行：`[状态] [Agent] 标题 — 状态标签`
- 展开看详情、失败原因、TDD 测试结果

#### 验收 Tab
- 用例卡片：标题 + 描述 + 类型标签 + 状态徽章 + 关联任务链接
- draft 阶段可确认/修改/删除
- 执行阶段实时显示测试结果

#### 产物 Tab
- 文件列表按项目分组，显示路径 + 状态 + 行数变化
- 点击文件展开 diff 视图（统一 diff 格式、行号高亮、hunk 折叠）
- 整合旧 "files" 和 "diff" tab

#### 引用 Tab
- **知识库引用**：命中 wiki 页面列表，标题 + slug + 预览
- **用户习惯**：高置信度偏好按类别分组，key + value + 置信度条
- **反例**：历史失败模式，场景 + 教训 + Quest 链接

#### 调研 Tab
- 按类型分组：可复用函数 / 当前逻辑 / 建议变更 / 相关代码
- 每卡片：标题 + 类型标签 + 文件路径 + 代码片段 + 摘要
- 建议变更类型额外显示 proposedLogic 和 reasoning

### 5.3 Tab 切换逻辑

```
analyzing → 自动"编排"
awaiting_confirmation → 停"编排"，用户可调整
confirmed → 自动"进展"
executing → 跟随最新活跃任务
completed → 停"产物"

用户手动切换后不再自动跳转
```

### 5.4 旧 UI 迁移

| 旧元素 | 新位置 |
|--------|--------|
| overview "进展" section | 进展 tab |
| overview "产物" section | 产物 tab 文件列表 |
| files tab | 合并进产物 tab |
| diff tab | 合并进产物 tab diff 查看器 |
| overview "关联知识" section | 引用 tab 知识库区域 |
| plan tab | 编排 tab 任务树 |
| spec tab | 保留只读展示 |
| capabilities tab | 保留但位置调整 |

---

## 6. API 设计

### 6.1 新增端点

```
POST   /api/expert/session                            — 创建 Session
GET    /api/expert/session/:id                        — 获取 Session 状态
PATCH  /api/expert/session/:id                        — 更新 Session

POST   /api/expert/session/:id/chat                   — 向入口 Agent 对话
PATCH  /api/expert/session/:id/task/:taskId           — 修改任务节点
POST   /api/expert/session/:id/task                   — 新增任务节点

PATCH  /api/expert/session/:id/acceptance-test/:testId — 修改验收用例
POST   /api/expert/session/:id/confirm                — 用户确认执行

GET    /api/expert/session/:id/research               — 获取调研结果
GET    /api/expert/session/:id/deliverables           — 获取产物列表
GET    /api/expert/session/:id/references             — 获取引用数据

GET    /api/expert/session/:id/acceptance-tests       — 获取所有验收用例
POST   /api/expert/session/:id/acceptance-test/:testId/run — 手动触发测试
```

### 6.2 SSE 实时推送

```
GET /api/expert/session/:id/stream

事件类型：
- task_started:      { taskId, agentName }
- task_progress:     { taskId, progress, message }
- task_completed:    { taskId, artifacts }
- task_failed:       { taskId, reason }
- test_result:       { testId, status, output }
- research_update:   { researchResult }
- agent_created:     { agent }
- session_complete:  { summary }
- session_failed:    { reason }
```

### 6.3 旧 API 关系

| 旧 API | 新 API | 说明 |
|--------|--------|------|
| `POST /api/quests/:id/plan` | `POST /api/expert/session` | 替代 |
| `POST /api/quests/:id/plan/approve` | `POST /api/expert/session/:id/confirm` | 替代 |
| `GET /api/quests/:id/events` | SSE `session/:id/stream` | 替代 |
| `GET /api/quests/:id/changed-files` | `GET /api/expert/session/:id/deliverables` | 替代 |
| 无 | `POST /api/expert/session/:id/chat` | 新增 |
| `GET /api/projects/:id/knowledge/search` | `GET /api/expert/session/:id/references` | 聚合替代 |

---

## 7. 迁移策略

### 7.1 迁移规则

| 旧数据 | 新数据 |
|--------|--------|
| Quest + Plan.steps[] | 每个 step → ExpertTaskNode，组合成单根任务树 |
| Quest.changedFiles[] | → TaskArtifact[]，挂载对应任务 |
| AgentEvent[] | → 任务 status 变更记录 |
| Quest.relatedKnowledgeIds | → CodeResearchResult[]，写入 Session.research |
| Quest.agentSummary | → 根节点 summary |
| Quest.reviewNotes | → review artifact |
| 旧 status 映射 | ready→completed, executing→executing, planning→analyzing |

### 7.2 迁移流程

1. 启动时检测未迁移 Quest
2. 逐个转换为 ExpertSession
3. 标记旧数据 `migratedToExpertSession: true`
4. 旧 Quest UI 只读展示，缺失 TDD 数据友好提示

---

## 8. 错误处理

### 8.1 降级策略

```
严重错误（Session 级）→ 停止执行，保存中间状态，用户可重试
中等错误（任务级）    → 标记失败，继续其他无依赖任务，最终汇总
轻微错误（数据/展示） → 静默降级，UI 显示"暂无数据"
```

### 8.2 各级错误处理

**Session 级**：分析失败重试 2 次 → failed；Agent 全部不可用 → failed；超时 → failed

**任务级**：执行失败 → 阻塞下游，其他继续；TDD 超限 → failed 保留最后代码；worktree 失败 → 重试 3 次指数退避

**TDD 管道**：测试生成失败 → 跳过测试直接实现；红灯失败（意外通过）→ 警告继续；绿灯失败 → 迭代直到上限

**动态 Agent**：无 ModelKit → 回退默认或拒绝；创建过多 → 上限 10 个，超出警告

**引用数据**：知识搜索/偏好/失败经验加载失败 → 静默降级，对应区域显示"暂无数据"

---

## 9. 测试策略

### 9.1 单元测试（vitest）

| 文件 | 内容 |
|------|------|
| `expert/orchestrator.test.ts` | Session 状态机、任务树生成、Agent 分配 |
| `expert/agent-pool.test.ts` | 原型注册、动态创建/回收 |
| `expert/tdd-pipeline.test.ts` | 红绿循环、迭代上限、回退 |
| `expert/research-collector.test.ts` | 代码扫描、语义搜索、分类写入 |
| `expert/migration.test.ts` | 各类型迁移正确性、边界情况 |

### 9.2 集成测试

完整 Session 生命周期、TDD 管道端到端、SSE 推送、动态 Agent 创建回收、并发任务

### 9.3 E2E 测试（Playwright）

Inspector tab 切换、任务树交互、验收用例确认、产物 diff 查看、引用面板展示、编排示意图渲染、实时推送、旧 Quest 迁移展示

### 9.4 测试原则

- TDD：先写测试再写实现
- Mock 边界：LLM 调用全部 mock（`REPOHELM_FAKE_MODELS=1`）
- 状态机测试优先
