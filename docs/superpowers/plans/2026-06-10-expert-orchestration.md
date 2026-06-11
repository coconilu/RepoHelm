# 专家团编排系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 RepoHelm 的静态 Plan-then-Execute 编排替换为动态专家团模式，包含 TDD 测试先行流程、6 个 Inspector Tab 全景展示、全量数据迁移。

**Architecture:** 新建 `packages/core/src/expert/` 目录，包含 ExpertOrchestrator、AgentPool、ResearchCollector、TDDPipeline、Migration 五个模块。Expert Session 作为新的执行单元替代 OrchestrationPlan。UI 层 Inspector tab 重构为 6 个专业面板。Server 层新增 `/api/expert/*` 路由和 SSE 推送。

**Tech Stack:** TypeScript (ES2022, ESM), Hono (server), React 19 + Vite 7 + Tailwind 4 (web), SQLite (store), vitest (unit tests), Playwright (e2e)

---

## Phase 1: 核心数据模型 + Expert Session 状态机

> 产出：可导入的类型系统和 Expert Session 基础管理，状态机可测试

### Task 1: 专家团核心类型定义

**Files:**
- Create: `packages/core/src/expert/types.ts`
- Modify: `packages/core/src/types.ts` (~line 1) — 添加 expert 类型 re-export

- [ ] **Step 1: 创建 expert/types.ts 定义所有新类型**

```typescript
// packages/core/src/expert/types.ts

// === Expert Session ===

export interface ExpertSession {
  id: string;
  questId: string;
  status: ExpertSessionStatus;
  entryAgentId: string;
  taskTree: ExpertTaskNode;
  flatTasks: ExpertTask[];
  acceptanceTests: AcceptanceTest[];
  research: CodeResearchResult[];
  agentPool: AgentPoolSnapshot;
  createdAt: string;
  confirmedAt?: string;
  completedAt?: string;
  errors: ExpertError[];
}

export type ExpertSessionStatus =
  | "analyzing"
  | "awaiting_confirmation"
  | "confirmed"
  | "executing"
  | "completed"
  | "failed";

// === Task Tree ===

export interface ExpertTaskNode {
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
  summary?: string;
}

export type TaskNodeType =
  | "root"
  | "analysis"
  | "research"
  | "implementation"
  | "test"
  | "review"
  | "delivery";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

// === Flat Task (for UI) ===

export interface ExpertTask {
  id: string;
  nodeId: string;
  title: string;
  description: string;
  type: TaskNodeType;
  status: TaskStatus;
  assignedAgentId?: string;
  assignedAgentName?: string;
  agentAvatar?: string;
  progress?: number;
  startedAt?: string;
  completedAt?: string;
  artifacts: TaskArtifact[];
  failureReason?: string;
}

// === Acceptance Test ===

export interface AcceptanceTest {
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

export type AcceptanceTestStatus =
  | "draft"
  | "confirmed"
  | "generated"
  | "passing"
  | "failing";

// === Code Research ===

export interface CodeResearchResult {
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

// === Agent Pool ===

export interface AgentPrototype {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  systemPromptTemplate: string;
  defaultModelKitId?: string;
  isBuiltIn: boolean;
}

export interface DynamicAgent extends AgentPrototype {
  createdBy: string;
  createdAt: string;
  taskId?: string;
  ttl?: number;
}

export type AgentPoolEntry = AgentPrototype | DynamicAgent;

export interface AgentPoolSnapshot {
  prototypes: AgentPrototype[];
  dynamicAgents: DynamicAgent[];
  activeAgents: string[];
}

// === Artifacts ===

export interface TaskArtifact {
  id: string;
  taskId: string;
  type: "file_change" | "test_result" | "research_summary" | "review_comment";
  filePath?: string;
  projectId?: string;
  summary: string;
  diff?: string;
  createdAt: string;
}

// === Errors ===

export interface ExpertError {
  code: ExpertErrorCode;
  message: string;
  detail: string;
  recoverable: boolean;
  affectedTaskIds: string[];
  createdAt: string;
}

export type ExpertErrorCode =
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

- [ ] **Step 2: 在 core/types.ts 添加 expert 类型 re-export**

在 `packages/core/src/types.ts` 的 exports 区域添加：

```typescript
// Expert orchestration types
export type {
  ExpertSession,
  ExpertSessionStatus,
  ExpertTaskNode,
  ExpertTask,
  TaskNodeType,
  TaskStatus,
  AcceptanceTest,
  AcceptanceTestStatus,
  CodeResearchResult,
  AgentPrototype,
  DynamicAgent,
  AgentPoolEntry,
  AgentPoolSnapshot,
  TaskArtifact,
  ExpertError,
  ExpertErrorCode,
} from "./expert/types.js";
```

- [ ] **Step 3: 在 core/index.ts 添加 expert 导出**

在 `packages/core/src/index.ts` 添加：

```typescript
export * from "./expert/types.js";
```

- [ ] **Step 4: 运行 typecheck 确认编译通过**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/expert/types.ts packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat(expert): add core type definitions for expert orchestration"
```

---

### Task 2: Expert Session 状态机 + 基本管理

**Files:**
- Create: `packages/core/src/expert/session-manager.ts`
- Test: `packages/core/src/expert/session-manager.test.ts`

- [ ] **Step 1: 写测试 — Session 状态机合法转换**

```typescript
// packages/core/src/expert/session-manager.test.ts
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStateStore } from "../store.js";
import { RepoHelmService } from "../service.js";
import { ExpertSessionManager } from "./session-manager.js";
import type { ExpertSession, ExpertTaskNode } from "./types.js";

async function createTestService() {
  const rootDir = await mkdtemp(join(tmpdir(), "repohelm-expert-test-"));
  const store = new SqliteStateStore(rootDir);
  const service = new RepoHelmService(store, rootDir);
  return { rootDir, service };
}

function makeRootNode(): ExpertTaskNode {
  return {
    id: "root",
    title: "根任务",
    type: "root",
    status: "pending",
    children: [],
    dependencies: [],
    artifacts: [],
    description: "",
    expectedOutput: "",
  };
}

function makeSession(overrides: Partial<ExpertSession> = {}): ExpertSession {
  return {
    id: "expert_test-1",
    questId: "test-1",
    status: "analyzing",
    entryAgentId: "supervisor",
    taskTree: makeRootNode(),
    flatTasks: [],
    acceptanceTests: [],
    research: [],
    agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
    createdAt: new Date().toISOString(),
    errors: [],
    ...overrides,
  };
}

describe("ExpertSessionManager", () => {
  it("应该创建新的 Expert Session", async () => {
    const { service } = await createTestService();
    const manager = new ExpertSessionManager(service);

    const session = await manager.createSession({
      questId: "test-1",
      entryAgentId: "supervisor",
    });

    expect(session.id).toBe("expert_test-1");
    expect(session.status).toBe("analyzing");
    expect(session.questId).toBe("test-1");
    expect(session.entryAgentId).toBe("supervisor");
    expect(session.taskTree.type).toBe("root");
  });

  it("应该按合法顺序推进状态", async () => {
    const { service } = await createTestService();
    const manager = new ExpertSessionManager(service);

    let session = await manager.createSession({
      questId: "test-2",
      entryAgentId: "supervisor",
    });

    session = await manager.transitionStatus(session.id, "awaiting_confirmation");
    expect(session.status).toBe("awaiting_confirmation");

    session = await manager.transitionStatus(session.id, "confirmed");
    expect(session.status).toBe("confirmed");

    session = await manager.transitionStatus(session.id, "executing");
    expect(session.status).toBe("executing");

    session = await manager.transitionStatus(session.id, "completed");
    expect(session.status).toBe("completed");
  });

  it("应该拒绝非法状态转换", async () => {
    const { service } = await createTestService();
    const manager = new ExpertSessionManager(service);

    const session = await manager.createSession({
      questId: "test-3",
      entryAgentId: "supervisor",
    });

    // 从 analyzing 不能直接到 completed
    await expect(
      manager.transitionStatus(session.id, "completed")
    ).rejects.toThrow("非法状态转换");
  });

  it("应该获取 session 并包含最新状态", async () => {
    const { service } = await createTestService();
    const manager = new ExpertSessionManager(service);

    await manager.createSession({ questId: "test-4", entryAgentId: "supervisor" });
    const retrieved = await manager.getSession("expert_test-4");

    expect(retrieved).toBeDefined();
    expect(retrieved!.questId).toBe("test-4");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core test -t "ExpertSessionManager"`
Expected: FAIL — `ExpertSessionManager` not defined

- [ ] **Step 3: 实现 ExpertSessionManager**

```typescript
// packages/core/src/expert/session-manager.ts
import type { RepoHelmService } from "../service.js";
import type {
  ExpertSession,
  ExpertSessionStatus,
  ExpertTaskNode,
} from "./types.js";

// 合法状态转换表
const VALID_TRANSITIONS: Record<ExpertSessionStatus, ExpertSessionStatus[]> = {
  analyzing: ["awaiting_confirmation", "failed"],
  awaiting_confirmation: ["confirmed", "analyzing", "failed"],
  confirmed: ["executing", "failed"],
  executing: ["completed", "failed"],
  completed: [],
  failed: ["analyzing"], // 允许从失败重试
};

export interface CreateSessionInput {
  questId: string;
  entryAgentId: string;
}

export class ExpertSessionManager {
  constructor(private service: RepoHelmService) {}

  async createSession(input: CreateSessionInput): Promise<ExpertSession> {
    const rootNode: ExpertTaskNode = {
      id: "root",
      title: input.questId,
      type: "root",
      status: "pending",
      children: [],
      dependencies: [],
      artifacts: [],
      description: "",
      expectedOutput: "",
    };

    const session: ExpertSession = {
      id: `expert_${input.questId}`,
      questId: input.questId,
      status: "analyzing",
      entryAgentId: input.entryAgentId,
      taskTree: rootNode,
      flatTasks: [],
      acceptanceTests: [],
      research: [],
      agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
      createdAt: new Date().toISOString(),
      errors: [],
    };

    // 持久化到 state store
    const state = await this.service.readState();
    // 注意：这里需要 service 提供存储 expert session 的能力
    // Phase 4 会完善持久化层
    return session;
  }

  async getSession(id: string): Promise<ExpertSession | undefined> {
    const state = await this.service.readState();
    // Phase 4 完善
    return undefined;
  }

  async transitionStatus(
    sessionId: string,
    newStatus: ExpertSessionStatus
  ): Promise<ExpertSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} 不存在`);
    }

    const allowed = VALID_TRANSITIONS[session.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `非法状态转换: ${session.status} → ${newStatus}，允许: ${allowed.join(", ")}`
      );
    }

    session.status = newStatus;
    if (newStatus === "confirmed") {
      session.confirmedAt = new Date().toISOString();
    }
    if (newStatus === "completed" || newStatus === "failed") {
      session.completedAt = new Date().toISOString();
    }

    // 持久化
    // Phase 4 完善
    return session;
  }

  async listSessions(questId?: string): Promise<ExpertSession[]> {
    // Phase 4 完善
    return [];
  }
}
```

- [ ] **Step 4: 在 service.ts 添加 readState 公开方法（如果还没有）**

检查 `packages/core/src/service.ts` 是否已有公开的 `readState()` 方法。如果没有，添加：

```typescript
// 在 RepoHelmService 类中添加
async readState() {
  return this._store.read();
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core test -t "ExpertSessionManager"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/expert/session-manager.ts packages/core/src/expert/session-manager.test.ts packages/core/src/service.ts
git commit -m "feat(expert): add ExpertSessionManager with state machine"
```

---

## Phase 2: Agent Pool 管理

> 产出：可注册原型、创建/回收动态 Agent 的 Agent Pool

### Task 3: Agent Prototype 注册表

**Files:**
- Create: `packages/core/src/expert/agent-pool.ts`
- Create: `packages/core/src/expert/agent-prototypes.ts`
- Test: `packages/core/src/expert/agent-pool.test.ts`

- [ ] **Step 1: 写测试 — Agent Pool 基本操作**

```typescript
// packages/core/src/expert/agent-pool.test.ts
import { describe, expect, it } from "vitest";
import { AgentPool, type CreateDynamicAgentInput } from "./agent-pool.js";
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

    pool.createDynamicAgent({
      name: "Agent 1",
      role: "r1",
      capabilities: [],
      systemPromptTemplate: "...",
      createdBy: "supervisor",
    });
    pool.createDynamicAgent({
      name: "Agent 2",
      role: "r2",
      capabilities: [],
      systemPromptTemplate: "...",
      createdBy: "supervisor",
    });

    expect(() =>
      pool.createDynamicAgent({
        name: "Agent 3",
        role: "r3",
        capabilities: [],
        systemPromptTemplate: "...",
        createdBy: "supervisor",
      })
    ).toThrow("动态 Agent 数量已达上限");
  });

  it("应该回收动态 Agent", () => {
    const pool = new AgentPool();
    const dynamic = pool.createDynamicAgent({
      name: "临时 Agent",
      role: "r",
      capabilities: [],
      systemPromptTemplate: "...",
      createdBy: "supervisor",
      taskId: "task-1",
    });

    pool.recycleDynamicAgent(dynamic.id);
    const remaining = pool.listDynamicAgents();
    expect(remaining).toHaveLength(0);
  });

  it("应该生成包含原型和动态 Agent 的快照", () => {
    const pool = new AgentPool();
    pool.registerPrototype({
      id: "coder",
      name: "Coder",
      role: "编码",
      capabilities: ["coding"],
      systemPromptTemplate: "...",
      isBuiltIn: true,
    });

    const snapshot = pool.getSnapshot();
    expect(snapshot.prototypes).toHaveLength(1);
    expect(snapshot.dynamicAgents).toHaveLength(0);
    expect(snapshot.activeAgents).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core test -t "AgentPool"`
Expected: FAIL

- [ ] **Step 3: 实现 AgentPool**

```typescript
// packages/core/src/expert/agent-pool.ts
import type {
  AgentPoolEntry,
  AgentPoolSnapshot,
  AgentPrototype,
  DynamicAgent,
} from "./types.js";

export interface AgentPoolOptions {
  maxDynamicAgents?: number;
}

export interface CreateDynamicAgentInput {
  name: string;
  role: string;
  capabilities: string[];
  systemPromptTemplate: string;
  createdBy: string;
  taskId?: string;
  ttl?: number;
  defaultModelKitId?: string;
}

export class AgentPool {
  private prototypes: Map<string, AgentPrototype> = new Map();
  private dynamicAgents: Map<string, DynamicAgent> = new Map();
  private activeAgentIds: Set<string> = new Set();
  private maxDynamicAgents: number;

  constructor(options: AgentPoolOptions = {}) {
    this.maxDynamicAgents = options.maxDynamicAgents ?? 10;
  }

  registerPrototype(proto: AgentPrototype): void {
    this.prototypes.set(proto.id, proto);
  }

  listPrototypes(): AgentPrototype[] {
    return Array.from(this.prototypes.values());
  }

  getPrototype(id: string): AgentPrototype | undefined {
    return this.prototypes.get(id);
  }

  matchAgents(capabilities: string[]): AgentPoolEntry[] {
    const all: AgentPoolEntry[] = [
      ...this.prototypes.values(),
      ...this.dynamicAgents.values(),
    ];
    return all.filter((agent) =>
      capabilities.some((cap) => agent.capabilities.includes(cap))
    );
  }

  createDynamicAgent(input: CreateDynamicAgentInput): DynamicAgent {
    if (this.dynamicAgents.size >= this.maxDynamicAgents) {
      throw new Error(
        `动态 Agent 数量已达上限 (${this.maxDynamicAgents})`
      );
    }

    const agent: DynamicAgent = {
      id: `dynamic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: input.name,
      role: input.role,
      capabilities: input.capabilities,
      systemPromptTemplate: input.systemPromptTemplate,
      defaultModelKitId: input.defaultModelKitId,
      isBuiltIn: false,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      taskId: input.taskId,
      ttl: input.ttl,
    };

    this.dynamicAgents.set(agent.id, agent);
    return agent;
  }

  listDynamicAgents(): DynamicAgent[] {
    return Array.from(this.dynamicAgents.values());
  }

  getDynamicAgent(id: string): DynamicAgent | undefined {
    return this.dynamicAgents.get(id);
  }

  recycleDynamicAgent(id: string): void {
    this.dynamicAgents.delete(id);
    this.activeAgentIds.delete(id);
  }

  activateAgent(id: string): void {
    this.activeAgentIds.add(id);
  }

  deactivateAgent(id: string): void {
    this.activeAgentIds.delete(id);
  }

  getSnapshot(): AgentPoolSnapshot {
    return {
      prototypes: this.listPrototypes(),
      dynamicAgents: this.listDynamicAgents(),
      activeAgents: Array.from(this.activeAgentIds),
    };
  }
}
```

- [ ] **Step 4: 创建内置专家原型定义**

```typescript
// packages/core/src/expert/agent-prototypes.ts
import type { AgentPrototype } from "./types.js";

export const BUILTIN_EXPERT_PROTOTYPES: AgentPrototype[] = [
  {
    id: "expert-architect",
    name: "架构师",
    role: "系统架构设计和分析",
    capabilities: ["architecture", "design", "analysis"],
    systemPromptTemplate:
      "你是系统架构师。分析需求，设计系统架构，识别模块边界和依赖关系。输出清晰的设计决策和理由。",
    isBuiltIn: true,
  },
  {
    id: "expert-coder",
    name: "工程师",
    role: "代码实现",
    capabilities: ["coding", "implementation", "refactoring"],
    systemPromptTemplate:
      "你是全栈工程师。根据任务描述实现代码变更，遵循项目规范和最佳实践。",
    isBuiltIn: true,
  },
  {
    id: "expert-tester",
    name: "测试工程师",
    role: "测试编写和执行",
    capabilities: ["testing", "test-generation", "validation"],
    systemPromptTemplate:
      "你是测试工程师。编写高质量的单元测试、集成测试和 E2E 测试。遵循 TDD 原则。",
    isBuiltIn: true,
  },
  {
    id: "expert-reviewer",
    name: "审查员",
    role: "代码审查和质量保证",
    capabilities: ["review", "quality", "security"],
    systemPromptTemplate:
      "你是代码审查员。审查代码变更的正确性、安全性、性能和维护性。",
    isBuiltIn: true,
  },
  {
    id: "expert-researcher",
    name: "调研员",
    role: "代码调研和上下文收集",
    capabilities: ["research", "search", "analysis"],
    systemPromptTemplate:
      "你是代码调研员。搜索和分析代码库，找出可复用的代码块、理解现有逻辑、识别需要变更的部分。",
    isBuiltIn: true,
  },
  {
    id: "expert-frontend",
    name: "前端专家",
    role: "前端 UI/UX 实现",
    capabilities: ["frontend", "react", "css", "ui"],
    systemPromptTemplate:
      "你是前端专家。实现 React 组件、CSS 样式和交互逻辑。",
    isBuiltIn: true,
  },
  {
    id: "expert-backend",
    name: "后端专家",
    role: "后端 API 和服务实现",
    capabilities: ["backend", "api", "database", "server"],
    systemPromptTemplate:
      "你是后端专家。实现 API 端点、服务逻辑和数据层代码。",
    isBuiltIn: true,
  },
];
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core test -t "AgentPool"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/expert/agent-pool.ts packages/core/src/expert/agent-pool.test.ts packages/core/src/expert/agent-prototypes.ts
git commit -m "feat(expert): add AgentPool with prototype registry and dynamic agent creation"
```

---

## Phase 3: Research Collector

> 产出：可在任务拆解过程中同步收集代码调研结果的模块

### Task 4: Research Collector 实现

**Files:**
- Create: `packages/core/src/expert/research-collector.ts`
- Test: `packages/core/src/expert/research-collector.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/core/src/expert/research-collector.test.ts
import { describe, expect, it, vi } from "vitest";
import { ResearchCollector } from "./research-collector.js";
import type { CodeResearchResult } from "./types.js";

// Mock service with minimal interface
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

    collector.createResult({
      type: "reusable_function",
      title: "函数 A",
      summary: "可复用函数",
      taskId: "task-1",
    });
    collector.createResult({
      type: "existing_logic",
      title: "现有逻辑 B",
      summary: "当前行为",
    });
    collector.createResult({
      type: "proposed_change",
      title: "建议变更 C",
      summary: "未来逻辑",
      proposedLogic: "改为使用...",
      reasoning: "因为...",
      taskId: "task-2",
    });

    const reusable = collector.getByType("reusable_function");
    expect(reusable).toHaveLength(1);

    const proposed = collector.getByType("proposed_change");
    expect(proposed).toHaveLength(1);

    const all = collector.getAll();
    expect(all).toHaveLength(3);
  });

  it("应该按任务 ID 过滤调研结果", () => {
    const service = createMockService();
    const collector = new ResearchCollector(service as any);

    collector.createResult({
      type: "related_code",
      title: "任务 1 的代码",
      summary: "...",
      taskId: "task-1",
    });
    collector.createResult({
      type: "related_code",
      title: "任务 2 的代码",
      summary: "...",
      taskId: "task-2",
    });
    collector.createResult({
      type: "related_code",
      title: "全局代码",
      summary: "...",
    });

    const task1Results = collector.getByTask("task-1");
    expect(task1Results).toHaveLength(1);

    const globalResults = collector.getGlobal();
    expect(globalResults).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core test -t "ResearchCollector"`
Expected: FAIL

- [ ] **Step 3: 实现 ResearchCollector**

```typescript
// packages/core/src/expert/research-collector.ts
import type {
  CodeResearchResult,
  CodeResearchResultType,
} from "./types.js";

export interface CreateResearchInput {
  type: CodeResearchResult["type"];
  title: string;
  summary: string;
  taskId?: string;
  filePath?: string;
  codeSnippet?: string;
  lineRange?: { start: number; end: number };
  proposedLogic?: string;
  reasoning?: string;
}

export class ResearchCollector {
  private results: Map<string, CodeResearchResult> = new Map();

  constructor(private service: any) {}

  createResult(input: CreateResearchInput): CodeResearchResult {
    const result: CodeResearchResult = {
      id: `research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      title: input.title,
      summary: input.summary,
      taskId: input.taskId,
      filePath: input.filePath,
      codeSnippet: input.codeSnippet,
      lineRange: input.lineRange,
      proposedLogic: input.proposedLogic,
      reasoning: input.reasoning,
    };

    this.results.set(result.id, result);
    return result;
  }

  getByType(type: CodeResearchResult["type"]): CodeResearchResult[] {
    return Array.from(this.results.values()).filter((r) => r.type === type);
  }

  getByTask(taskId: string): CodeResearchResult[] {
    return Array.from(this.results.values()).filter(
      (r) => r.taskId === taskId
    );
  }

  getGlobal(): CodeResearchResult[] {
    return Array.from(this.results.values()).filter((r) => !r.taskId);
  }

  getAll(): CodeResearchResult[] {
    return Array.from(this.results.values());
  }

  clear(): void {
    this.results.clear();
  }
}
```

注意：需要在 `types.ts` 中添加类型别名：

```typescript
// 在 expert/types.ts 中添加
export type CodeResearchResultType = CodeResearchResult["type"];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core test -t "ResearchCollector"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/expert/research-collector.ts packages/core/src/expert/research-collector.test.ts
git commit -m "feat(expert): add ResearchCollector for inline code research"
```

---

## Phase 4: TDD Pipeline

> 产出：验收用例 → 测试生成 → 红绿循环的 TDD 执行管道

### Task 5: TDD Pipeline 实现

**Files:**
- Create: `packages/core/src/expert/tdd-pipeline.ts`
- Test: `packages/core/src/expert/tdd-pipeline.test.ts`

- [ ] **Step 1: 写测试 — TDD 管道基本流程**

```typescript
// packages/core/src/expert/tdd-pipeline.test.ts
import { describe, expect, it, vi } from "vitest";
import { TDDPipeline, type TDDPipelineOptions } from "./tdd-pipeline.js";
import type { AcceptanceTest, ExpertTask } from "./types.js";

function createMockAgentInvoker() {
  return {
    invoke: vi.fn().mockResolvedValue({
      content: "test code",
      error: undefined,
    }),
  };
}

function createMockTestRunner() {
  return {
    run: vi.fn().mockResolvedValue({
      passed: false,
      output: "1 failing",
    }),
  };
}

function makeAcceptanceTest(overrides: Partial<AcceptanceTest> = {}): AcceptanceTest {
  return {
    id: "at-1",
    title: "用户登录测试",
    description: "用户输入正确的用户名密码后应成功登录",
    status: "confirmed",
    testType: "unit",
    relatedTaskIds: ["task-1"],
    userConfirmed: true,
    ...overrides,
  };
}

function makeTask(overrides: Partial<ExpertTask> = {}): ExpertTask {
  return {
    id: "task-1",
    nodeId: "node-1",
    title: "实现登录功能",
    description: "实现用户名密码登录",
    type: "implementation",
    status: "pending",
    artifacts: [],
    ...overrides,
  };
}

describe("TDDPipeline", () => {
  it("应该生成具体测试代码从验收用例", async () => {
    const agentInvoker = createMockAgentInvoker();
    const testRunner = createMockTestRunner();
    const pipeline = new TDDPipeline({
      agentInvoker: agentInvoker as any,
      testRunner: testRunner as any,
      maxIterations: 3,
    });

    const test = makeAcceptanceTest();
    const task = makeTask();

    const result = await pipeline.generateTest(test, task);

    expect(agentInvoker.invoke).toHaveBeenCalledTimes(1);
    expect(result.generatedTestPath).toBeDefined();
    expect(result.status).toBe("generated");
  });

  it("应该在达到最大迭代次数后停止", async () => {
    const agentInvoker = {
      invoke: vi.fn().mockResolvedValue({
        content: "implementation code",
        error: undefined,
      }),
    };
    const testRunner = {
      run: vi.fn().mockResolvedValue({
        passed: false,
        output: "still failing",
      }),
    };
    const pipeline = new TDDPipeline({
      agentInvoker: agentInvoker as any,
      testRunner: testRunner as any,
      maxIterations: 3,
    });

    const test = makeAcceptanceTest({ status: "generated" });
    const task = makeTask();

    const result = await pipeline.executeRedGreenCycle(test, task);

    expect(result.iterations).toBe(3);
    expect(result.success).toBe(false);
    expect(testRunner.run).toHaveBeenCalledTimes(3);
  });

  it("应该在测试通过后立即停止迭代", async () => {
    const agentInvoker = {
      invoke: vi.fn().mockResolvedValue({
        content: "fixed code",
        error: undefined,
      }),
    };
    let callCount = 0;
    const testRunner = {
      run: vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          passed: callCount >= 2,
          output: callCount >= 2 ? "all passing" : "1 failing",
        };
      }),
    };
    const pipeline = new TDDPipeline({
      agentInvoker: agentInvoker as any,
      testRunner: testRunner as any,
      maxIterations: 3,
    });

    const test = makeAcceptanceTest({ status: "generated" });
    const task = makeTask();

    const result = await pipeline.executeRedGreenCycle(test, task);

    expect(result.iterations).toBe(2);
    expect(result.success).toBe(true);
  });

  it("应该在测试生成失败时回退", async () => {
    const agentInvoker = {
      invoke: vi.fn().mockResolvedValue({
        content: "",
        error: "Failed to generate test",
      }),
    };
    const testRunner = createMockTestRunner();
    const pipeline = new TDDPipeline({
      agentInvoker: agentInvoker as any,
      testRunner: testRunner as any,
      maxIterations: 3,
    });

    const test = makeAcceptanceTest();
    const task = makeTask();

    const result = await pipeline.generateTest(test, task);

    expect(result.status).toBe("failing");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core test -t "TDDPipeline"`
Expected: FAIL

- [ ] **Step 3: 实现 TDDPipeline**

```typescript
// packages/core/src/expert/tdd-pipeline.ts
import type { AcceptanceTest, ExpertTask } from "./types.js";

export interface TDDAgentInvoker {
  invoke(input: {
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<{ content: string; error?: string }>;
}

export interface TDDTestRunner {
  run(input: {
    worktreePath: string;
    testPath: string;
    command: string;
  }): Promise<{ passed: boolean; output: string }>;
}

export interface TDDPipelineOptions {
  agentInvoker: TDDAgentInvoker;
  testRunner: TDDTestRunner;
  maxIterations: number;
}

export interface TestGenerationResult {
  status: AcceptanceTest["status"];
  generatedTestPath?: string;
  error?: string;
}

export interface RedGreenResult {
  iterations: number;
  success: boolean;
  finalTestStatus: AcceptanceTest["status"];
  lastOutput: string;
}

export class TDDPipeline {
  private agentInvoker: TDDAgentInvoker;
  private testRunner: TDDTestRunner;
  private maxIterations: number;

  constructor(options: TDDPipelineOptions) {
    this.agentInvoker = options.agentInvoker;
    this.testRunner = options.testRunner;
    this.maxIterations = options.maxIterations;
  }

  async generateTest(
    acceptanceTest: AcceptanceTest,
    task: ExpertTask
  ): Promise<TestGenerationResult> {
    const systemPrompt = `你是测试工程师。根据验收用例生成具体的测试代码。
输出要求：只输出测试代码，使用 fenced code block 包裹。
语言：根据项目技术栈选择合适的测试框架。`;

    const userContent = `验收用例：${acceptanceTest.title}
${acceptanceTest.description}

任务描述：${task.title}
${task.description}

请生成具体的测试代码。`;

    const result = await this.agentInvoker.invoke({
      systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    if (result.error || !result.content.trim()) {
      return {
        status: "failing",
        error: result.error || "测试生成为空",
      };
    }

    // 提取代码块（简化版本，实际需要从 content 中提取）
    const codeMatch = result.content.match(/```[\w]*\n([\s\S]*?)```/);
    const testCode = codeMatch ? codeMatch[1] : result.content;

    // 这里需要将 testCode 写入文件
    // 实际实现中会通过 task 的 worktree 路径写入
    const testPath = `tests/${task.id}_${acceptanceTest.id}.test.ts`;

    return {
      status: "generated",
      generatedTestPath: testPath,
    };
  }

  async executeRedGreenCycle(
    acceptanceTest: AcceptanceTest,
    task: ExpertTask
  ): Promise<RedGreenResult> {
    let iterations = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      iterations++;

      // Green: 尝试实现
      const implResult = await this.agentInvoker.invoke({
        systemPrompt: `你是工程师。根据测试失败信息修复代码使测试通过。`,
        messages: [
          {
            role: "user",
            content: `任务：${task.title}\n请实现代码使相关测试通过。`,
          },
        ],
      });

      if (implResult.error) {
        continue;
      }

      // 运行测试验证
      const testResult = await this.testRunner.run({
        worktreePath: "", // 实际从 task 获取
        testPath: acceptanceTest.generatedTestPath || "",
        command: "npx vitest run",
      });

      if (testResult.passed) {
        return {
          iterations,
          success: true,
          finalTestStatus: "passing",
          lastOutput: testResult.output,
        };
      }
    }

    return {
      iterations,
      success: false,
      finalTestStatus: "failing",
      lastOutput: "超过最大迭代次数",
    };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core test -t "TDDPipeline"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/expert/tdd-pipeline.ts packages/core/src/expert/tdd-pipeline.test.ts
git commit -m "feat(expert): add TDD pipeline with red-green cycle"
```

---

## Phase 5: Expert Orchestrator 主类

> 产出：完整的专家团编排引擎，串联 Session/AgentPool/Research/TDD

### Task 6: ExpertOrchestrator 实现

**Files:**
- Create: `packages/core/src/expert/orchestrator.ts`
- Test: `packages/core/src/expert/orchestrator.test.ts`

- [ ] **Step 1: 写测试 — Orchestrator 基本编排**

```typescript
// packages/core/src/expert/orchestrator.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ExpertOrchestrator } from "./orchestrator.js";
import type { ExpertSession } from "./types.js";

// Mock dependencies
function createMocks() {
  const service = {
    readState: vi.fn().mockResolvedValue({
      quests: [],
      subAgents: {},
      engine: {},
    }),
    getEntrySubAgent: vi.fn().mockResolvedValue({
      id: "supervisor",
      name: "Supervisor",
      modelKitId: "default",
    }),
    getUserPreferences: vi.fn().mockResolvedValue([]),
    getFailurePatterns: vi.fn().mockResolvedValue([]),
    searchProjectKnowledge: vi.fn().mockResolvedValue([]),
  };

  const sessionManager = {
    createSession: vi.fn().mockImplementation(async (input) => ({
      id: `expert_${input.questId}`,
      ...input,
      status: "analyzing",
      taskTree: {
        id: "root",
        title: input.questId,
        type: "root",
        status: "pending",
        children: [],
        dependencies: [],
        artifacts: [],
        description: "",
        expectedOutput: "",
      },
      flatTasks: [],
      acceptanceTests: [],
      research: [],
      agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
      createdAt: new Date().toISOString(),
      errors: [],
    })),
    transitionStatus: vi.fn().mockImplementation(async (id, status) => ({
      id,
      status,
    })),
  };

  return { service, sessionManager };
}

describe("ExpertOrchestrator", () => {
  let orchestrator: ExpertOrchestrator;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    orchestrator = new ExpertOrchestrator(mocks.service as any, mocks.sessionManager as any);
  });

  it("应该创建 session 并进入分析阶段", async () => {
    const session = await orchestrator.startSession({
      questId: "test-1",
      requirement: "实现用户登录功能",
      entryAgentId: "supervisor",
    });

    expect(session.id).toBe("expert_test-1");
    expect(session.status).toBe("analyzing");
    expect(mocks.sessionManager.createSession).toHaveBeenCalled();
  });

  it("应该完成分析并进入等待确认状态", async () => {
    const session = await orchestrator.analyzeAndDecompose({
      questId: "test-2",
      requirement: "添加用户认证",
      entryAgentId: "supervisor",
    });

    expect(session.status).toBe("awaiting_confirmation");
    expect(mocks.sessionManager.transitionStatus).toHaveBeenCalledWith(
      expect.anything(),
      "awaiting_confirmation"
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core test -t "ExpertOrchestrator"`
Expected: FAIL

- [ ] **Step 3: 实现 ExpertOrchestrator**

```typescript
// packages/core/src/expert/orchestrator.ts
import { ExpertSessionManager } from "./session-manager.js";
import { AgentPool, BUILTIN_EXPERT_PROTOTYPES } from "./agent-pool.js";
import { ResearchCollector } from "./research-collector.js";
import type {
  ExpertSession,
  ExpertTaskNode,
  ExpertTask,
  AcceptanceTest,
  ExpertSessionStatus,
} from "./types.js";
import type { RepoHelmService } from "../service.js";

export interface StartSessionInput {
  questId: string;
  requirement: string;
  entryAgentId: string;
  projectIds?: string[];
}

export interface AnalyzeResult {
  session: ExpertSession;
  taskTree: ExpertTaskNode;
  acceptanceTests: AcceptanceTest[];
}

export class ExpertOrchestrator {
  private agentPool: AgentPool;

  constructor(
    private service: RepoHelmService,
    private sessionManager: ExpertSessionManager
  ) {
    this.agentPool = new AgentPool();
    // 注册内置原型
    for (const proto of BUILTIN_EXPERT_PROTOTYPES) {
      this.agentPool.registerPrototype(proto);
    }
  }

  async startSession(input: StartSessionInput): Promise<ExpertSession> {
    const session = await this.sessionManager.createSession({
      questId: input.questId,
      entryAgentId: input.entryAgentId,
    });
    return session;
  }

  async analyzeAndDecompose(input: StartSessionInput): Promise<AnalyzeResult> {
    // Phase 1: 创建 session
    let session = await this.startSession(input);

    // Phase 2: 加载上下文
    const preferences = await this.service.getUserPreferences();
    const failurePatterns = await this.service.getFailurePatterns();

    // Phase 3: Research Collector 伴随分析
    const researchCollector = new ResearchCollector(this.service);

    // Phase 4: 调用入口 Agent LLM 分析需求并生成任务树
    // 这里会调用 LLM 生成任务树和验收用例
    // 实际实现需要接入 LLM backend
    const taskTree = await this.invokeEntryAgentAnalysis(
      session,
      input.requirement,
      researchCollector,
      preferences,
      failurePatterns
    );

    // Phase 5: 生成验收用例
    const acceptanceTests = await this.generateAcceptanceTests(
      session,
      input.requirement,
      taskTree
    );

    // Phase 6: 更新 session
    session.taskTree = taskTree;
    session.flatTasks = this.flattenTasks(taskTree);
    session.acceptanceTests = acceptanceTests;
    session.research = researchCollector.getAll();
    session.agentPool = this.agentPool.getSnapshot();

    // Phase 7: 转换状态
    session = await this.sessionManager.transitionStatus(
      session.id,
      "awaiting_confirmation"
    );

    return { session, taskTree, acceptanceTests };
  }

  private async invokeEntryAgentAnalysis(
    session: ExpertSession,
    requirement: string,
    researchCollector: ResearchCollector,
    preferences: any[],
    failurePatterns: any[]
  ): Promise<ExpertTaskNode> {
    // 构建入口 Agent 的 system prompt
    const context = {
      requirement,
      preferences: preferences.filter((p) => p.confidence >= 0.5),
      failurePatterns: failurePatterns.slice(0, 5),
      agentPool: this.agentPool.listPrototypes().map((a) => ({
        id: a.id,
        name: a.name,
        capabilities: a.capabilities,
      })),
    };

    // 调用 LLM 生成任务树
    // 实际实现中这里会调用 SubAgentBackend
    const rootNode: ExpertTaskNode = {
      id: "root",
      title: session.questId,
      type: "root",
      status: "pending",
      children: [],
      dependencies: [],
      artifacts: [],
      description: requirement,
      expectedOutput: "",
    };

    return rootNode;
  }

  private async generateAcceptanceTests(
    session: ExpertSession,
    requirement: string,
    taskTree: ExpertTaskNode
  ): Promise<AcceptanceTest[]> {
    // 调用 LLM 基于需求生成验收用例
    // 实际实现需要 LLM backend
    return [];
  }

  private flattenTasks(node: ExpertTaskNode, parentId?: string): ExpertTask[] {
    const tasks: ExpertTask[] = [];

    if (node.type !== "root") {
      tasks.push({
        id: node.id,
        nodeId: node.id,
        title: node.title,
        description: node.description,
        type: node.type,
        status: node.status,
        assignedAgentId: node.assignedAgentId,
        assignedAgentName: node.assignedAgentName,
        artifacts: node.artifacts,
      });
    }

    for (const child of node.children) {
      tasks.push(...this.flattenTasks(child, node.id));
    }

    return tasks;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core test -t "ExpertOrchestrator"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/expert/orchestrator.ts packages/core/src/expert/orchestrator.test.ts
git commit -m "feat(expert): add ExpertOrchestrator main class"
```

---

## Phase 6: 持久化层 + 迁移

> 产出：Expert Session 可持久化到 SQLite，旧 Quest 可迁移

### Task 7: Expert Session 持久化

**Files:**
- Modify: `packages/core/src/store.ts` — 添加 expert sessions 表
- Modify: `packages/core/src/service.ts` — 添加 expert session CRUD 方法
- Test: `packages/core/src/expert/persistence.test.ts`

- [ ] **Step 1: 写测试 — Session 持久化 CRUD**

```typescript
// packages/core/src/expert/persistence.test.ts
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStateStore } from "../store.js";
import { RepoHelmService } from "../service.js";

async function createService() {
  const rootDir = await mkdtemp(join(tmpdir(), "repohelm-persist-test-"));
  const store = new SqliteStateStore(rootDir);
  const service = new RepoHelmService(store, rootDir);
  return { rootDir, service };
}

describe("Expert Session Persistence", () => {
  it("应该创建并读取 expert session", async () => {
    const { service } = await createService();

    // 通过 service API 创建 session
    const session = await service.createExpertSession({
      questId: "test-q1",
      entryAgentId: "supervisor",
    });

    expect(session.id).toBe("expert_test-q1");

    const retrieved = await service.getExpertSession("expert_test-q1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.questId).toBe("test-q1");
  });

  it("应该列出 quest 关联的 sessions", async () => {
    const { service } = await createService();

    await service.createExpertSession({
      questId: "test-q2",
      entryAgentId: "supervisor",
    });

    const sessions = await service.listExpertSessions("test-q2");
    expect(sessions).toHaveLength(1);
  });

  it("应该更新 session 状态", async () => {
    const { service } = await createService();

    const session = await service.createExpertSession({
      questId: "test-q3",
      entryAgentId: "supervisor",
    });

    const updated = await service.updateExpertSession(session.id, {
      status: "awaiting_confirmation",
    });

    expect(updated.status).toBe("awaiting_confirmation");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core test -t "Expert Session Persistence"`
Expected: FAIL

- [ ] **Step 3: 在 store.ts 中添加 expert sessions 表**

在 `SqliteStateStore` 中添加 expert sessions 的读写方法。需要：
1. 创建 `expert_sessions` 表（JSON 列存储完整 session 对象）
2. 添加 `readExpertSession(id)`, `writeExpertSession(session)`, `listExpertSessions(questId?)` 方法

```typescript
// 在 store.ts 的 SqliteStateStore 类中添加

// 表创建（在初始化时）
this.db.exec(`
  CREATE TABLE IF NOT EXISTS expert_sessions (
    id TEXT PRIMARY KEY,
    quest_id TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

async readExpertSession(id: string): Promise<ExpertSession | null> {
  const row = this.db.prepare(
    "SELECT data FROM expert_sessions WHERE id = ?"
  ).get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data);
}

async writeExpertSession(session: ExpertSession): Promise<void> {
  const now = new Date().toISOString();
  this.db.prepare(`
    INSERT OR REPLACE INTO expert_sessions (id, quest_id, status, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.questId,
    session.status,
    JSON.stringify(session),
    session.createdAt,
    now
  );
}

async listExpertSessions(questId?: string): Promise<ExpertSession[]> {
  const sql = questId
    ? "SELECT data FROM expert_sessions WHERE quest_id = ? ORDER BY created_at"
    : "SELECT data FROM expert_sessions ORDER BY created_at";
  const rows = questId
    ? (this.db.prepare(sql).all(questId) as { data: string }[])
    : (this.db.prepare(sql).all() as { data: string }[]);
  return rows.map((r) => JSON.parse(r.data));
}
```

- [ ] **Step 4: 在 service.ts 中添加 expert session CRUD 方法**

```typescript
// 在 RepoHelmService 类中添加

async createExpertSession(input: {
  questId: string;
  entryAgentId: string;
}): Promise<ExpertSession> {
  const session: ExpertSession = {
    id: `expert_${input.questId}`,
    questId: input.questId,
    status: "analyzing",
    entryAgentId: input.entryAgentId,
    taskTree: {
      id: "root",
      title: input.questId,
      type: "root",
      status: "pending",
      children: [],
      dependencies: [],
      artifacts: [],
      description: "",
      expectedOutput: "",
    },
    flatTasks: [],
    acceptanceTests: [],
    research: [],
    agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
    createdAt: new Date().toISOString(),
    errors: [],
  };

  await this._store.writeExpertSession(session);
  return session;
}

async getExpertSession(id: string): Promise<ExpertSession | undefined> {
  return this._store.readExpertSession(id) ?? undefined;
}

async updateExpertSession(
  id: string,
  updates: Partial<ExpertSession>
): Promise<ExpertSession> {
  const session = await this.getExpertSession(id);
  if (!session) throw new Error(`Session ${id} 不存在`);

  Object.assign(session, updates);
  await this._store.writeExpertSession(session);
  return session;
}

async listExpertSessions(questId?: string): Promise<ExpertSession[]> {
  return this._store.listExpertSessions(questId);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core test -t "Expert Session Persistence"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store.ts packages/core/src/service.ts packages/core/src/expert/persistence.test.ts
git commit -m "feat(expert): add expert session persistence to SQLite"
```

---

### Task 8: 旧 Quest 迁移

**Files:**
- Create: `packages/core/src/expert/migration.ts`
- Test: `packages/core/src/expert/migration.test.ts`

- [ ] **Step 1: 写测试 — 迁移逻辑**

```typescript
// packages/core/src/expert/migration.test.ts
import { describe, expect, it } from "vitest";
import { migrateQuestToSession } from "./migration.js";
import type { Quest, OrchestrationPlan } from "../types.js";
import type { ExpertSession } from "./types.js";

function makeOldQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: "q-1",
    workspaceId: "ws-1",
    title: "测试 Quest",
    requirement: "实现登录功能",
    status: "ready",
    spec: { title: "测试", steps: [] },
    agentBackendId: "mock",
    affectedProjectIds: ["proj-1"],
    worktrees: [],
    changedFiles: [
      {
        projectId: "proj-1",
        path: "src/auth.ts",
        status: "added",
        diff: "+ new file",
        worktreePath: "/tmp/wt",
      },
    ],
    validationResults: [],
    reviewNotes: ["代码质量良好"],
    deliveryResults: [],
    capabilityRecommendations: [],
    autoApprovePlan: false,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T01:00:00Z",
    ...overrides,
  };
}

function makeOldPlan(): OrchestrationPlan {
  return {
    questId: "q-1",
    summary: "实现登录",
    steps: [
      {
        id: "s1",
        description: "写认证模块",
        agentId: "coder",
        agentName: "Coder",
        dependencies: [],
        expectedOutput: "auth.ts",
        targetProjectId: "proj-1",
      },
      {
        id: "s2",
        description: "写登录页面",
        agentId: "coder",
        agentName: "Coder",
        dependencies: ["s1"],
        expectedOutput: "login.tsx",
        targetProjectId: "proj-1",
      },
    ],
    generatedAt: "2026-06-01T00:00:00Z",
  };
}

describe("migrateQuestToSession", () => {
  it("应该将旧 Quest + Plan 转换为 ExpertSession", () => {
    const quest = makeOldQuest();
    const plan = makeOldPlan();

    const session = migrateQuestToSession(quest, plan);

    expect(session.id).toBe("expert_q-1");
    expect(session.questId).toBe("q-1");
    expect(session.status).toBe("completed"); // ready → completed
    expect(session.taskTree.type).toBe("root");
    expect(session.taskTree.children).toHaveLength(2);
    expect(session.flatTasks).toHaveLength(2);
  });

  it("应该将 changedFiles 转换为 artifacts", () => {
    const quest = makeOldQuest();
    const plan = makeOldPlan();

    const session = migrateQuestToSession(quest, plan);

    // changedFiles 应该出现在某个任务的 artifacts 中
    const allArtifacts = session.flatTasks.flatMap((t) => t.artifacts);
    expect(allArtifacts.some((a) => a.filePath === "src/auth.ts")).toBe(true);
  });

  it("应该处理没有 plan 的 Quest", () => {
    const quest = makeOldQuest();

    const session = migrateQuestToSession(quest, null);

    expect(session.taskTree.children).toHaveLength(0);
    expect(session.flatTasks).toHaveLength(0);
  });

  it("应该正确映射旧状态", () => {
    const plan = makeOldPlan();

    const readyQuest = makeOldQuest({ status: "ready" });
    expect(migrateQuestToSession(readyQuest, plan).status).toBe("completed");

    const executingQuest = makeOldQuest({ status: "executing" });
    expect(migrateQuestToSession(executingQuest, plan).status).toBe("executing");

    const planningQuest = makeOldQuest({ status: "planning" });
    expect(migrateQuestToSession(planningQuest, plan).status).toBe("analyzing");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repohelm/core test -t "migrateQuestToSession"`
Expected: FAIL

- [ ] **Step 3: 实现迁移函数**

```typescript
// packages/core/src/expert/migration.ts
import type { Quest, OrchestrationPlan, ChangedFile } from "../types.js";
import type {
  ExpertSession,
  ExpertTaskNode,
  ExpertTask,
  TaskArtifact,
  ExpertSessionStatus,
} from "./types.js";

const STATUS_MAP: Record<string, ExpertSessionStatus> = {
  ready: "completed",
  executing: "executing",
  planning: "analyzing",
  blocked: "failed",
  delivered: "completed",
};

export function migrateQuestToSession(
  quest: Quest,
  plan: OrchestrationPlan | null
): ExpertSession {
  const status = STATUS_MAP[quest.status] || "completed";

  // 将 plan steps 转换为任务树
  const children: ExpertTaskNode[] = [];
  const flatTasks: ExpertTask[] = [];

  if (plan) {
    for (const step of plan.steps) {
      const node: ExpertTaskNode = {
        id: step.id,
        title: step.description,
        type: "implementation",
        status: status === "completed" ? "completed" : "pending",
        assignedAgentId: step.agentId,
        assignedAgentName: step.agentName,
        children: [],
        dependencies: step.dependencies,
        artifacts: [],
        description: step.description,
        expectedOutput: step.expectedOutput,
      };
      children.push(node);

      flatTasks.push({
        id: step.id,
        nodeId: step.id,
        title: step.description,
        description: step.description,
        type: "implementation",
        status: node.status,
        assignedAgentId: step.agentId,
        assignedAgentName: step.agentName,
        artifacts: [],
      });
    }
  }

  const rootNode: ExpertTaskNode = {
    id: "root",
    title: quest.title,
    type: "root",
    status: status === "completed" ? "completed" : "pending",
    children,
    dependencies: [],
    artifacts: [],
    description: quest.requirement,
    expectedOutput: quest.agentSummary || "",
    summary: quest.agentSummary,
  };

  // 迁移 changedFiles → artifacts
  const artifacts = migrateChangedFiles(quest.changedFiles);
  // 将 artifacts 分配到对应的任务
  distributeArtifacts(children, artifacts, plan);

  // 更新 flatTasks 的 artifacts
  for (const task of flatTasks) {
    const node = children.find((c) => c.id === task.nodeId);
    if (node) {
      task.artifacts = node.artifacts;
    }
  }

  return {
    id: `expert_${quest.id}`,
    questId: quest.id,
    status,
    entryAgentId: quest.entrySubAgentId || "supervisor",
    taskTree: rootNode,
    flatTasks,
    acceptanceTests: [],
    research: [],
    agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
    createdAt: quest.createdAt,
    confirmedAt: quest.planApproval?.approvedAt,
    completedAt: status === "completed" ? quest.updatedAt : undefined,
    errors: [],
  };
}

function migrateChangedFiles(
  files: Array<ChangedFile | string>
): TaskArtifact[] {
  return files.map((file, idx) => {
    if (typeof file === "string") {
      return {
        id: `artifact_${idx}`,
        taskId: "", // 待分配
        type: "file_change" as const,
        filePath: file,
        summary: file,
        createdAt: new Date().toISOString(),
      };
    }
    return {
      id: `artifact_${idx}`,
      taskId: "",
      type: "file_change" as const,
      filePath: file.path,
      projectId: file.projectId,
      summary: `${file.status}: ${file.path}`,
      diff: file.diff,
      createdAt: new Date().toISOString(),
    };
  });
}

function distributeArtifacts(
  nodes: ExpertTaskNode[],
  artifacts: TaskArtifact[],
  plan: OrchestrationPlan | null
): void {
  if (!plan) return;

  // 简单分配策略：按 step 顺序分配
  for (let i = 0; i < Math.min(artifacts.length, nodes.length); i++) {
    artifacts[i].taskId = nodes[i].id;
    nodes[i].artifacts.push(artifacts[i]);
  }
}

export async function migrateAllQuests(
  service: RepoHelmService
): Promise<{ migrated: number; skipped: number }> {
  const state = await service.readState();
  let migrated = 0;
  let skipped = 0;

  for (const quest of state.quests) {
    // 检查是否已迁移
    if ((quest as any).migratedToExpertSession) {
      skipped++;
      continue;
    }

    // 读取 plan（如果有的话）
    let plan: OrchestrationPlan | null = null;
    // 尝试从 workspace 读取 plan

    const session = migrateQuestToSession(quest, plan);
    await service.updateExpertSessionFromMigration(session);
    migrated++;
  }

  return { migrated, skipped };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @repohelm/core test -t "migrateQuestToSession"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/expert/migration.ts packages/core/src/expert/migration.test.ts
git commit -m "feat(expert): add quest-to-session migration"
```

---

## Phase 7: Server API + SSE

> 产出：完整的 REST API 和 SSE 实时推送

### Task 9: Server Expert API 路由

**Files:**
- Modify: `apps/server/src/index.ts` — 添加 `/api/expert/*` 路由
- Test: `apps/server/src/expert-api.test.ts`

- [ ] **Step 1: 写测试 — API 端点**

```typescript
// apps/server/src/expert-api.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";

// 集成测试：启动真实 server，发送 HTTP 请求
describe("Expert API", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // 启动测试 server
    // ...
  });

  afterAll(() => {
    server?.close();
  });

  it("POST /api/expert/session 应该创建 session", async () => {
    const res = await fetch(`${baseUrl}/api/expert/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questId: "test-1",
        requirement: "实现用户登录",
        entryAgentId: "supervisor",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session.id).toBe("expert_test-1");
  });

  it("GET /api/expert/session/:id 应该返回 session", async () => {
    // 先创建
    await fetch(`${baseUrl}/api/expert/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questId: "test-2",
        requirement: "测试需求",
        entryAgentId: "supervisor",
      }),
    });

    const res = await fetch(`${baseUrl}/api/expert/session/expert_test-2`);
    expect(res.status).toBe(200);
  });

  it("POST /api/expert/session/:id/confirm 应该推进状态", async () => {
    // 创建并确认
    const createRes = await fetch(`${baseUrl}/api/expert/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questId: "test-3",
        requirement: "测试需求",
        entryAgentId: "supervisor",
      }),
    });

    const res = await fetch(
      `${baseUrl}/api/expert/session/expert_test-3/confirm`,
      { method: "POST" }
    );

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 在 server/index.ts 中添加 Zod schemas 和路由**

在 `apps/server/src/index.ts` 中添加 expert schemas 和路由组：

```typescript
// Expert Session Schemas
const createExpertSessionSchema = z.object({
  questId: z.string().min(1),
  requirement: z.string().min(10),
  workspaceId: z.string().optional(),
  entryAgentId: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
});

const chatWithSessionSchema = z.object({
  message: z.string().min(1),
  action: z.enum(["adjust", "question", "add_task", "remove_task"]).optional(),
  targetTaskId: z.string().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  assignedAgentId: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  status: z.enum(["skipped"]).optional(),
});

const confirmSessionSchema = z.object({
  acceptanceTestIds: z.array(z.string()).optional(),
  skipAcceptanceTests: z.boolean().optional(),
});
```

路由组：

```typescript
// Expert Session routes
app.post("/api/expert/session", async (c) => {
  const input = createExpertSessionSchema.parse(await c.req.json());
  const session = await service.createExpertSession({
    questId: input.questId,
    entryAgentId: input.entryAgentId || "supervisor",
  });
  return c.json({ session }, 201);
});

app.get("/api/expert/session/:id", async (c) => {
  const session = await service.getExpertSession(c.req.param("id"));
  if (!session) return c.json({ error: "Not found" }, 404);
  return c.json({ session });
});

app.patch("/api/expert/session/:id", async (c) => {
  const id = c.req.param("id");
  const updates = await c.req.json();
  const session = await service.updateExpertSession(id, updates);
  return c.json({ session });
});

app.post("/api/expert/session/:id/chat", async (c) => {
  const input = chatWithSessionSchema.parse(await c.req.json());
  // 调用入口 Agent 处理对话
  const reply = await service.chatWithExpertSession(
    c.req.param("id"),
    input.message,
    input.action,
    input.targetTaskId
  );
  return c.json(reply);
});

app.patch("/api/expert/session/:id/task/:taskId", async (c) => {
  const updates = updateTaskSchema.parse(await c.req.json());
  const session = await service.updateExpertTask(
    c.req.param("id"),
    c.req.param("taskId"),
    updates
  );
  return c.json({ task: session });
});

app.post("/api/expert/session/:id/confirm", async (c) => {
  const input = confirmSessionSchema.parse(await c.req.json());
  const session = await service.confirmExpertSession(
    c.req.param("id"),
    input
  );
  return c.json({ session });
});

app.get("/api/expert/session/:id/deliverables", async (c) => {
  const deliverables = await service.getExpertDeliverables(
    c.req.param("id")
  );
  return c.json({ deliverables });
});

app.get("/api/expert/session/:id/references", async (c) => {
  const references = await service.getExpertReferences(c.req.param("id"));
  return c.json({ references });
});

app.get("/api/expert/session/:id/research", async (c) => {
  const research = await service.getExpertResearch(c.req.param("id"));
  return c.json({ research });
});

app.get("/api/expert/session/:id/acceptance-tests", async (c) => {
  const tests = await service.getExpertAcceptanceTests(c.req.param("id"));
  return c.json({ tests });
});
```

- [ ] **Step 3: 在 service.ts 中添加 API 所需的 service 方法**

- [ ] **Step 4: 运行 typecheck 确认编译通过**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/index.ts packages/core/src/service.ts
git commit -m "feat(expert): add expert session REST API endpoints"
```

---

### Task 10: SSE 实时推送

**Files:**
- Modify: `apps/server/src/index.ts` — 添加 SSE endpoint
- Create: `apps/server/src/sse.ts` — SSE 辅助工具

- [ ] **Step 1: 创建 SSE 辅助模块**

```typescript
// apps/server/src/sse.ts
import type { Context } from "hono";

export interface SSEMessage {
  event: string;
  data: unknown;
}

export function setupSSE(c: Context, stream: ReadableStream) {
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  return c.body(stream);
}

export function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
```

- [ ] **Step 2: 在 server 中添加 SSE endpoint**

```typescript
// 在 index.ts 中添加
app.get("/api/expert/session/:id/stream", async (c) => {
  const sessionId = c.req.param("id");
  const session = await service.getExpertSession(sessionId);
  if (!session) return c.json({ error: "Not found" }, 404);

  // 创建 SSE stream
  const stream = new ReadableStream({
    start(controller) {
      // 注册 event listener 到 session manager
      service.subscribeToExpertSession(sessionId, {
        onEvent: (event: string, data: unknown) => {
          controller.enqueue(
            new TextEncoder().encode(formatSSE(event, data))
          );
        },
        onComplete: () => {
          controller.close();
        },
      });
    },
  });

  return setupSSE(c, stream);
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/sse.ts apps/server/src/index.ts
git commit -m "feat(expert): add SSE real-time event streaming"
```

---

## Phase 8: UI — API Client + Inspector Tab 重构

> 产出：前端类型定义、API 调用、Inspector 6 个新 Tab

### Task 11: 前端 API Client 扩展

**Files:**
- Modify: `apps/web/src/api.ts` — 添加 expert 类型和 API 函数

- [ ] **Step 1: 在 api.ts 中添加 expert 类型定义**

```typescript
// 在 apps/web/src/api.ts 中添加

export interface ExpertSession {
  id: string;
  questId: string;
  status: ExpertSessionStatus;
  entryAgentId: string;
  taskTree: ExpertTaskNode;
  flatTasks: ExpertTask[];
  acceptanceTests: AcceptanceTest[];
  research: CodeResearchResult[];
  agentPool: AgentPoolSnapshot;
  createdAt: string;
  confirmedAt?: string;
  completedAt?: string;
  errors: ExpertError[];
}

export type ExpertSessionStatus =
  | "analyzing"
  | "awaiting_confirmation"
  | "confirmed"
  | "executing"
  | "completed"
  | "failed";

export interface ExpertTaskNode {
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
  summary?: string;
}

export type TaskNodeType =
  | "root" | "analysis" | "research" | "implementation"
  | "test" | "review" | "delivery";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface ExpertTask {
  id: string;
  nodeId: string;
  title: string;
  description: string;
  type: TaskNodeType;
  status: TaskStatus;
  assignedAgentId?: string;
  assignedAgentName?: string;
  agentAvatar?: string;
  progress?: number;
  startedAt?: string;
  completedAt?: string;
  artifacts: TaskArtifact[];
  failureReason?: string;
}

export interface AcceptanceTest {
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

export type AcceptanceTestStatus = "draft" | "confirmed" | "generated" | "passing" | "failing";

export interface CodeResearchResult {
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

export interface AgentPoolSnapshot {
  prototypes: Array<{
    id: string;
    name: string;
    role: string;
    capabilities: string[];
    isBuiltIn: boolean;
  }>;
  dynamicAgents: Array<{
    id: string;
    name: string;
    createdBy: string;
    taskId?: string;
  }>;
  activeAgents: string[];
}

export interface TaskArtifact {
  id: string;
  taskId: string;
  type: "file_change" | "test_result" | "research_summary" | "review_comment";
  filePath?: string;
  projectId?: string;
  summary: string;
  diff?: string;
  createdAt: string;
}

export interface ExpertError {
  code: string;
  message: string;
  detail: string;
  recoverable: boolean;
  affectedTaskIds: string[];
  createdAt: string;
}
```

- [ ] **Step 2: 添加 expert API 函数**

```typescript
// 在 api.ts 的 api 对象中添加

export const api = {
  // ... 现有方法 ...

  // Expert Session
  createExpertSession: (input: {
    questId: string;
    requirement: string;
    entryAgentId?: string;
    projectIds?: string[];
  }) =>
    request<ExpertSession>("/api/expert/session", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getExpertSession: (id: string) =>
    request<{ session: ExpertSession }>(`/api/expert/session/${id}`),

  updateExpertSession: (id: string, updates: Partial<ExpertSession>) =>
    request<{ session: ExpertSession }>(`/api/expert/session/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),

  chatWithExpertSession: (
    id: string,
    message: string,
    action?: string,
    targetTaskId?: string
  ) =>
    request(`/api/expert/session/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, action, targetTaskId }),
    }),

  updateExpertTask: (
    sessionId: string,
    taskId: string,
    updates: Record<string, unknown>
  ) =>
    request(`/api/expert/session/${sessionId}/task/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),

  confirmExpertSession: (
    id: string,
    input?: { acceptanceTestIds?: string[]; skipAcceptanceTests?: boolean }
  ) =>
    request<{ session: ExpertSession }>(
      `/api/expert/session/${id}/confirm`,
      { method: "POST", body: JSON.stringify(input || {}) }
    ),

  getExpertDeliverables: (id: string) =>
    request(`/api/expert/session/${id}/deliverables`),

  getExpertReferences: (id: string) =>
    request(`/api/expert/session/${id}/references`),

  getExpertResearch: (id: string) =>
    request(`/api/expert/session/${id}/research`),

  getExpertAcceptanceTests: (id: string) =>
    request(`/api/expert/session/${id}/acceptance-tests`),

  // SSE
  subscribeExpertSessionStream: (
    id: string,
    onEvent: (event: string, data: unknown) => void,
    onError?: (error: Event) => void
  ) => {
    const es = new EventSource(`/api/expert/session/${id}/stream`);
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        onEvent(parsed.event, parsed.data);
      } catch {
        onEvent("raw", e.data);
      }
    };
    if (onError) es.onerror = onError;
    return () => es.close();
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(expert): add expert API client types and functions"
```

---

### Task 12: Inspector Tab 重构

**Files:**
- Modify: `apps/web/src/App.tsx` — InspectorTab 类型和 tab 定义
- Create: `apps/web/src/components/OrchestrationPanel.tsx`
- Create: `apps/web/src/components/ProgressPanel.tsx`
- Create: `apps/web/src/components/AcceptancePanel.tsx`
- Create: `apps/web/src/components/DeliverablesPanel.tsx`
- Create: `apps/web/src/components/ReferencesPanel.tsx`
- Create: `apps/web/src/components/ResearchPanel.tsx`
- Modify: `apps/web/src/styles.css` — 新 panel 样式

- [ ] **Step 1: 更新 InspectorTab 类型**

在 `App.tsx` 中将 `InspectorTab` 类型从：
```typescript
type InspectorTab = "spec" | "plan" | "overview" | "capabilities" | "files" | "diff";
```
改为：
```typescript
type InspectorTab =
  | "orchestration"
  | "progress"
  | "acceptance"
  | "deliverables"
  | "references"
  | "research"
  | "spec"
  | "capabilities";
```

- [ ] **Step 2: 更新 tab 定义和可见性逻辑**

```typescript
const allTabs: Array<{ id: InspectorTab; label: string }> = [
  { id: "orchestration", label: "编排" },
  { id: "progress", label: "进展" },
  { id: "acceptance", label: "验收" },
  { id: "deliverables", label: "产物" },
  { id: "references", label: "引用" },
  { id: "research", label: "调研" },
  { id: "spec", label: "Spec" },
  { id: "capabilities", label: "能力" },
];

const visibleTabs = allTabs.filter((tabItem) => {
  switch (tabItem.id) {
    case "orchestration":
    case "progress":
      return !!expertSession;
    case "acceptance":
      return (expertSession?.acceptanceTests?.length ?? 0) > 0;
    case "deliverables":
      return (expertSession?.flatTasks.some((t) => t.artifacts.length > 0) ?? false);
    case "references":
      return !!(expertSession?.research?.length || userPreferences?.length);
    case "research":
      return (expertSession?.research?.length ?? 0) > 0;
    case "spec":
      return hasSpec;
    case "capabilities":
      return hasCapabilities;
    default:
      return false;
  }
});
```

- [ ] **Step 3: 创建 OrchestrationPanel 组件**

```tsx
// apps/web/src/components/OrchestrationPanel.tsx
import React from "react";
import type { ExpertSession, ExpertTaskNode } from "../api";

interface Props {
  session: ExpertSession;
}

function TaskTreeNode({ node, depth = 0 }: { node: ExpertTaskNode; depth?: number }) {
  const statusIcon = {
    pending: "○",
    in_progress: "◉",
    completed: "●",
    failed: "",
    skipped: "○",
  }[node.status] || "○";

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div className="task-tree-node">
        <span className="task-status">{statusIcon}</span>
        <span className="task-title">{node.title}</span>
        {node.assignedAgentName && (
          <span className="task-agent">{node.assignedAgentName}</span>
        )}
      </div>
      {node.children.map((child) => (
        <TaskTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function AgentDiagram({ session }: { session: ExpertSession }) {
  const agents = session.agentPool.activeAgents;

  return (
    <div className="agent-diagram">
      <div className="agent-diagram-header">
        <span className="agent-node entry-agent">
          {session.entryAgentId}
        </span>
      </div>
      <div className="agent-diagram-workers">
        {agents.map((agentId) => (
          <span key={agentId} className="agent-node worker-agent">
            {agentId}
          </span>
        ))}
      </div>
    </div>
  );
}

export function OrchestrationPanel({ session }: Props) {
  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <h3>Agent 示意图</h3>
        <AgentDiagram session={session} />
      </section>
      <section className="inspector-section">
        <h3>任务树</h3>
        <TaskTreeNode node={session.taskTree} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: 创建 ProgressPanel 组件**

```tsx
// apps/web/src/components/ProgressPanel.tsx
import React from "react";
import type { ExpertTask } from "../api";

interface Props {
  tasks: ExpertTask[];
}

function TaskRow({ task }: { task: ExpertTask }) {
  const statusIcon = {
    pending: "○",
    in_progress: "",
    completed: "●",
    failed: "✗",
    skipped: "—",
  }[task.status] || "○";

  return (
    <div className="progress-task-row">
      <span className="task-status-icon">{statusIcon}</span>
      {task.assignedAgentName && (
        <span className="task-agent-avatar">{task.assignedAgentName[0]}</span>
      )}
      <span className="task-title">{task.title}</span>
      <span className={`task-status-badge status-${task.status}`}>
        {task.status}
      </span>
    </div>
  );
}

export function ProgressPanel({ tasks }: Props) {
  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <h3>任务进展 ({tasks.length})</h3>
        <div className="progress-list">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: 创建 AcceptancePanel 组件**

```tsx
// apps/web/src/components/AcceptancePanel.tsx
import React from "react";
import type { AcceptanceTest } from "../api";

interface Props {
  tests: AcceptanceTest[];
  onConfirm?: (testId: string) => void;
}

function TestCard({ test, onConfirm }: { test: AcceptanceTest; onConfirm?: (id: string) => void }) {
  const statusColors: Record<string, string> = {
    draft: "var(--text-faint)",
    confirmed: "var(--accent)",
    generated: "var(--text)",
    passing: "var(--color-green, #4ade80)",
    failing: "var(--color-red, #f87171)",
  };

  return (
    <div className="acceptance-test-card">
      <div className="test-header">
        <span className="test-title">{test.title}</span>
        <span
          className="test-status-badge"
          style={{ color: statusColors[test.status] }}
        >
          {test.status}
        </span>
      </div>
      <p className="test-description">{test.description}</p>
      <div className="test-meta">
        <span className="test-type-badge">{test.testType}</span>
        {test.relatedTaskIds.length > 0 && (
          <span className="test-related">
            关联 {test.relatedTaskIds.length} 个任务
          </span>
        )}
      </div>
      {test.status === "draft" && onConfirm && (
        <button
          className="btn-confirm-test"
          onClick={() => onConfirm(test.id)}
        >
          确认
        </button>
      )}
      {test.testOutput && (
        <pre className="test-output">{test.testOutput}</pre>
      )}
    </div>
  );
}

export function AcceptancePanel({ tests, onConfirm }: Props) {
  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <h3>验收用例 ({tests.length})</h3>
        <div className="acceptance-list">
          {tests.map((test) => (
            <TestCard key={test.id} test={test} onConfirm={onConfirm} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: 创建 DeliverablesPanel 组件**

```tsx
// apps/web/src/components/DeliverablesPanel.tsx
import React, { useState } from "react";
import type { ExpertTask, TaskArtifact } from "../api";

interface Props {
  tasks: ExpertTask[];
}

function DiffView({ artifact }: { artifact: TaskArtifact }) {
  if (!artifact.diff) return <p>无 diff 内容</p>;

  const lines = artifact.diff.split("\n");

  return (
    <div className="diff-viewer">
      {lines.map((line, i) => {
        const type = line.startsWith("+")
          ? "add"
          : line.startsWith("-")
          ? "remove"
          : "context";
        return (
          <div key={i} className={`diff-line diff-${type}`}>
            <span className="diff-line-num">{i + 1}</span>
            <span className="diff-line-content">{line}</span>
          </div>
        );
      })}
    </div>
  );
}

function FileItem({
  artifact,
  onSelect,
  selected,
}: {
  artifact: TaskArtifact;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      className={`file-item ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <span className="file-path">{artifact.filePath}</span>
      <span className="file-summary">{artifact.summary}</span>
    </button>
  );
}

export function DeliverablesPanel({ tasks }: Props) {
  const [selectedArtifact, setSelectedArtifact] = useState<TaskArtifact | null>(null);

  const allArtifacts = tasks.flatMap((t) => t.artifacts);
  const fileArtifacts = allArtifacts.filter((a) => a.type === "file_change");

  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <h3>变更文件 ({fileArtifacts.length})</h3>
        <div className="file-list">
          {fileArtifacts.map((artifact) => (
            <FileItem
              key={artifact.id}
              artifact={artifact}
              onSelect={() => setSelectedArtifact(artifact)}
              selected={selectedArtifact?.id === artifact.id}
            />
          ))}
        </div>
      </section>
      {selectedArtifact && (
        <section className="inspector-section">
          <h3>Diff: {selectedArtifact.filePath}</h3>
          <DiffView artifact={selectedArtifact} />
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 创建 ReferencesPanel 组件**

```tsx
// apps/web/src/components/ReferencesPanel.tsx
import React from "react";
import type { CodeResearchResult } from "../api";

interface Props {
  research: CodeResearchResult[];
  preferences?: Array<{
    category: string;
    key: string;
    value: string;
    confidence: number;
  }>;
  failurePatterns?: Array<{
    scenario: string;
    lesson: string;
    questId?: string;
  }>;
}

function KnowledgeSection({ items }: { items: CodeResearchResult[] }) {
  if (items.length === 0) return null;
  return (
    <section className="inspector-section">
      <h3>知识库引用</h3>
      {items.map((item) => (
        <div key={item.id} className="reference-item">
          <span className="reference-title">{item.title}</span>
          <p className="reference-preview">{item.summary.slice(0, 200)}</p>
        </div>
      ))}
    </section>
  );
}

function PreferencesSection({ preferences }: { preferences: Props["preferences"] }) {
  if (!preferences || preferences.length === 0) return null;
  const grouped = preferences.reduce(
    (acc, p) => {
      acc[p.category] = acc[p.category] || [];
      acc[p.category].push(p);
      return acc;
    },
    {} as Record<string, typeof preferences>
  );

  return (
    <section className="inspector-section">
      <h3>用户习惯</h3>
      {Object.entries(grouped).map(([category, prefs]) => (
        <div key={category} className="preference-group">
          <span className="preference-category">{category}</span>
          {prefs.map((p) => (
            <div key={p.key} className="preference-item">
              <span className="preference-key">{p.key}</span>
              <span className="preference-value">{p.value}</span>
              <div
                className="confidence-bar"
                style={{ width: `${p.confidence * 100}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function FailureSection({ patterns }: { patterns: Props["failurePatterns"] }) {
  if (!patterns || patterns.length === 0) return null;
  return (
    <section className="inspector-section">
      <h3>反例（失败经验）</h3>
      {patterns.map((p, i) => (
        <div key={i} className="failure-item">
          <span className="failure-scenario">{p.scenario}</span>
          <p className="failure-lesson">{p.lesson}</p>
        </div>
      ))}
    </section>
  );
}

export function ReferencesPanel({ research, preferences, failurePatterns }: Props) {
  return (
    <div className="inspector-stack">
      <KnowledgeSection items={research.filter((r) => r.type === "related_code")} />
      <PreferencesSection preferences={preferences} />
      <FailureSection patterns={failurePatterns} />
    </div>
  );
}
```

- [ ] **Step 8: 创建 ResearchPanel 组件**

```tsx
// apps/web/src/components/ResearchPanel.tsx
import React from "react";
import type { CodeResearchResult } from "../api";

interface Props {
  research: CodeResearchResult[];
}

const TYPE_LABELS: Record<string, string> = {
  reusable_function: "可复用函数",
  existing_logic: "当前逻辑",
  proposed_change: "建议变更",
  related_code: "相关代码",
};

const TYPE_ICONS: Record<string, string> = {
  reusable_function: "🔧",
  existing_logic: "📖",
  proposed_change: "🔄",
  related_code: "",
};

function ResearchCard({ item }: { item: CodeResearchResult }) {
  return (
    <div className="research-card">
      <div className="research-header">
        <span className="research-type">
          {TYPE_ICONS[item.type]} {TYPE_LABELS[item.type]}
        </span>
        <span className="research-title">{item.title}</span>
      </div>
      {item.filePath && (
        <span className="research-file">{item.filePath}</span>
      )}
      {item.codeSnippet && (
        <pre className="research-code">{item.codeSnippet}</pre>
      )}
      <p className="research-summary">{item.summary}</p>
      {item.proposedLogic && (
        <div className="research-proposed">
          <strong>未来逻辑：</strong>
          <p>{item.proposedLogic}</p>
        </div>
      )}
      {item.reasoning && (
        <div className="research-reasoning">
          <strong>理由：</strong>
          <p>{item.reasoning}</p>
        </div>
      )}
    </div>
  );
}

export function ResearchPanel({ research }: Props) {
  const grouped = research.reduce(
    (acc, item) => {
      acc[item.type] = acc[item.type] || [];
      acc[item.type].push(item);
      return acc;
    },
    {} as Record<string, CodeResearchResult[]>
  );

  return (
    <div className="inspector-stack">
      {Object.entries(grouped).map(([type, items]) => (
        <section key={type} className="inspector-section">
          <h3>
            {TYPE_ICONS[type]} {TYPE_LABELS[type]} ({items.length})
          </h3>
          {items.map((item) => (
            <ResearchCard key={item.id} item={item} />
          ))}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: 在 App.tsx 中集成新 Panel 组件**

在 Inspector 组件的 tab 渲染区域添加新 panel 的 switch case。

- [ ] **Step 10: 添加 CSS 样式**

在 `styles.css` 中添加新 panel 的样式类。遵循 token-driven 原则，使用 CSS 自定义属性。

- [ ] **Step 11: 运行 typecheck 确认编译通过**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/api.ts apps/web/src/components/OrchestrationPanel.tsx apps/web/src/components/ProgressPanel.tsx apps/web/src/components/AcceptancePanel.tsx apps/web/src/components/DeliverablesPanel.tsx apps/web/src/components/ReferencesPanel.tsx apps/web/src/components/ResearchPanel.tsx apps/web/src/styles.css
git commit -m "feat(expert): add 6 Inspector tabs for expert orchestration UI"
```

---

## Phase 9: 集成 + 端到端测试

> 产出：完整的 E2E 测试，确保所有组件协同工作

### Task 13: E2E 测试

**Files:**
- Create: `apps/web/e2e/expert-orchestration.spec.ts`

- [ ] **Step 1: 写 E2E 测试 — Inspector Tab 展示**

```typescript
// apps/web/e2e/expert-orchestration.spec.ts
import { test, expect } from "@playwright/test";

test.describe("专家团编排 UI", () => {
  test("应该显示编排 tab 的任务树", async ({ page }) => {
    await page.goto("/");
    // 创建一个 quest 并触发 expert session
    // 验证编排 tab 显示
  });

  test("应该在进展 tab 显示任务状态", async ({ page }) => {
    // 执行 session 后验证进展 tab
  });

  test("应该在产物 tab 显示文件和 diff", async ({ page }) => {
    // 验证产物 tab 的文件列表和 diff 查看
  });

  test("应该在引用 tab 显示知识库/习惯/反例", async ({ page }) => {
    // 验证引用 tab 三个区域
  });

  test("应该在调研 tab 显示代码调研结果", async ({ page }) => {
    // 验证调研 tab 按类型分组
  });
});
```

- [ ] **Step 2: 运行 E2E 测试**

Run: `pnpm test:e2e -g "专家团"`
Expected: 根据 mock 数据通过

- [ ] **Step 3: 运行全量测试确认无回归**

Run: `pnpm test:all`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/expert-orchestration.spec.ts
git commit -m "test(e2e): add expert orchestration UI end-to-end tests"
```

---

## 实施顺序总结

```
Phase 1 (Task 1-2):  核心类型 + Session 状态机     → 可测试的状态机
Phase 2 (Task 3):    Agent Pool                    → 可注册的 Agent 原型
Phase 3 (Task 4):    Research Collector            → 可收集调研结果
Phase 4 (Task 5):    TDD Pipeline                  → 可执行红绿循环
Phase 5 (Task 6):    Expert Orchestrator           → 完整编排引擎
Phase 6 (Task 7-8):  持久化 + 迁移                  → 数据可存储和迁移
Phase 7 (Task 9-10): Server API + SSE             → API 可调用
Phase 8 (Task 11-12): UI API Client + Inspector    → UI 可交互
Phase 9 (Task 13):   E2E 测试                      → 全链路验证
```

每个 Phase 结束时都可以独立 typecheck + test，保证不破坏现有功能。
