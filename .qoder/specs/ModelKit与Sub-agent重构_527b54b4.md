# ModelKit 与 Sub-agent 架构重构计划

## 一、现状分析总结

### 1.1 RepoHelm 当前架构 (基于 Alex 的调研)

**执行模式配置现状**:
- UI 位置: [apps/web/src/App.tsx](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/web/src/App.tsx) 第 1724-1913 行 (`AppSettingsDialog` 组件)
- 两种模式: CLI 模式(本地工具) 和 BYOK 模式(直接调用 Provider API)
- 状态存储: SQLite (`packages/core/src/store.ts`) + JSON 兼容层
- 类型定义: [packages/core/src/types.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/packages/core/src/types.ts) 第 262-269 行

**关键问题**:
1. **类型不一致**: `types.ts` 使用 `byokProviders`(复数),但 `api.ts` 仍用旧字段 `byok`(单数)
2. **Sub-agent 仅是概念**: 事件日志中标注了 "Spec Agent", "Implementation Agent" 等,但实际只调用一次 `backend.run()`
3. **缺少真正的编排**: [packages/core/src/service.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/packages/core/src/service.ts) 的 `runQuest` 方法硬编码单次调用

### 1.2 Opencode Sub-agent 架构 (基于 Sam 的调研 + 补充分析)

**核心设计理念**:
- **基于文件的 Agent 定义**: `.opencode/agent/*.md` 文件,YAML frontmatter + Markdown prompt
- **Mode 分类**: `primary`(入口), `subagent`(子任务), `all`(两者皆可)
- **动态加载**: [packages/opencode/src/config/agent.ts](file:///Users/chenmeili/Documents/GitHub/opencode/packages/opencode/src/config/agent.ts) 扫描文件系统自动注册
- **权限控制**: 每个 agent 可配置工具白名单/黑名单
- **模型绑定**: 每个 agent 可指定专属 model (如 `model: opencode/gpt-5.4-nano`)

**示例配置** ([.opencode/agent/triage.md](file:///Users/chenmeili/Documents/GitHub/opencode/.opencode/agent/triage.md)):
```markdown
---
mode: primary
hidden: true
model: opencode/gpt-5.4-nano
color: "#44BA81"
tools:
  "*": false
  "github-triage": true
---

You are a triage agent responsible for triaging github issues.
...
```

**数据流**:
1. 启动时扫描 `{agent,agents}/**/*.md` 文件
2. 解析 YAML frontmatter 得到 `ConfigAgentV1.Info`
3. 存入内存 Map (`packages/core/src/agent.ts` 的 `Service`)
4. Session 执行时通过 `Agent.resolve(id)` 获取配置
5. 根据 `mode` 决定是否在 UI 中显示

**可借鉴的模式**:
- ✅ 文件即配置:便于版本控制和人工编辑
- ✅ Mode 分离:明确区分入口 agent 和子 agent
- ✅ 权限细粒度控制:每个 agent 独立工具集
- ❌ 不适合 RepoHelm: RepoHelm 需要 UI 配置界面,而非纯文件配置

---

## 二、重构目标

### 2.1 全局配置重构: 执行模式 → 模型管理

**新板块名称**: "模型管理" (Model Management)

**功能保留与优化**:
1. **CLI 测试**: 保留对 Codex CLI, Claude Code, OpenCode, Gemini CLI 的检测和测试
2. **BYOK 测试**: 保留对 6 个 Provider (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, OpenAI-compatible) 的配置和测试
3. **新增操作**: 为每个测试通过的配置添加 "保存为 ModelKit" 按钮

**ModelKit 定义**:
```typescript
interface ModelKit {
  id: string;                    // 唯一标识,如 "claude-code-fast"
  name: string;                  // 用户友好名称,如 "Claude Code (快速响应)"
  type: "cli" | "byok";         // 来源类型
  backendId?: string;            // CLI 后端 ID (当 type="cli")
  providerId?: string;           // Provider ID (当 type="byok")
  model: string;                 // 模型名称
  config: CliBackendConfig | ByokConfig; // 完整配置
  metadata: {
    createdAt: string;
    testedAt: string;
    lastUsedAt?: string;
    costTier: "free" | "low" | "medium" | "high"; // 成本分级
    performanceProfile: "fast" | "balanced" | "accurate"; // 性能特征
  };
}
```

**持久化策略**: 集成到现有 SQLite 状态存储 (`state.engine.modelKits`)

### 2.2 Sub-agent 管理模块

**核心功能**:
1. **Sub-agent 列表**: 展示所有已创建的 Sub-agents 及其绑定的 ModelKit
2. **创建向导**: 引导式流程定义角色、能力描述,强制绑定 ModelKit
3. **入口 Sub-agent 设置**: 从所有 Sub-agents 中指定一个作为 Entry Point
4. **Sub-agent First 原则**: 通过编排多个绑定特定高性价比 ModelKit 的 Sub-agents 最大化效能

**Sub-agent 数据结构**:
```typescript
interface SubAgent {
  id: string;                    // 唯一标识,如 "spec-agent"
  name: string;                  // 显示名称,如 "Spec 编写专家"
  role: string;                  // 角色描述,如 "负责需求澄清和 Spec 生成"
  capabilities: string[];        // 能力标签,如 ["requirements", "specification"]
  modelKitId: string;            // 绑定的 ModelKit ID (一对一关系)
  mode: "entry" | "worker";     // entry=入口, worker=工作节点
  permissions: {
    allowedTools: string[];      // 允许的工具,如 ["read", "write", "git"]
    deniedTools: string[];       // 禁止的工具
    maxSteps?: number;           // 最大执行步数
  };
  promptTemplate?: string;       // 可选的系统提示模板
  metadata: {
    createdAt: string;
    updatedAt: string;
    usageCount: number;          // 使用次数统计
  };
}
```

**分层协作机制**:
```
用户请求
  ↓
Entry Sub-agent (接收初始请求)
  ├─ 分析任务性质
  ├─ 决定是否需要分解
  └─ 路由到合适的 Worker Sub-agents
  
Worker Sub-agents (并行/串行执行)
  ├─ Spec Agent: 生成详细规格
  ├─ Implementation Agent: 代码实现
  ├─ Review Agent: 代码审查
  └─ Test Agent: 验证测试
  
结果聚合
  ↓
返回给用户
```

### 2.3 Opencode 调研报告

**输出文件**: `/Users/chenmeili/Documents/GitHub/RepoHelm/opencode-subagent-research.md`

**报告结构**:
1. Opencode 项目概述
2. Sub-agent 架构设计
3. 配置文件格式与加载机制
4. 路由与编排逻辑
5. 权限控制系统
6. 与 RepoHelm 的对比分析
7. 可借鉴的设计模式
8. 实施建议

---

## 三、实施步骤

### Phase 0: 修复类型不一致 (P0 - 立即)

**任务 0.1**: 统一 EngineConfig 类型定义
- **文件**: [apps/web/src/api.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/web/src/api.ts)
- **修改**: 删除旧的 `byok: ByokConfig` 字段,改为 `byokProviders` 和 `activeByokProviderId`
- **影响**: 确保前后端字段名一致

**任务 0.2**: 更新 Server Zod Schema
- **文件**: [apps/server/src/index.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/server/src/index.ts) 第 73-89 行
- **验证**: 确认 schema 已使用 `byokProviders`,无需修改

### Phase 1: ModelKit 基础设施 (P1 - 核心基础)

**任务 1.1**: 扩展类型定义
- **文件**: [packages/core/src/types.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/packages/core/src/types.ts)
- **新增**:
  ```typescript
  export interface ModelKit {
    id: string;
    name: string;
    type: "cli" | "byok";
    backendId?: string;
    providerId?: string;
    model: string;
    config: CliBackendConfig | ByokConfig;
    metadata: ModelKitMetadata;
  }
  
  export interface ModelKitMetadata {
    createdAt: string;
    testedAt: string;
    lastUsedAt?: string;
    costTier: "free" | "low" | "medium" | "high";
    performanceProfile: "fast" | "balanced" | "accurate";
  }
  
  export interface EngineConfig {
    mode: "cli" | "byok";
    cliId: string;
    cliModels: Record<string, string>;
    byokProviders: Record<string, ByokConfig>;
    activeByokProviderId: string;
    modelKits: Record<string, ModelKit>; // 新增
    updatedAt: string;
  }
  ```

**任务 1.2**: 扩展 Service 层 API
- **文件**: [packages/core/src/service.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/packages/core/src/service.ts)
- **新增方法**:
  ```typescript
  async createModelKit(input: CreateModelKitInput): Promise<ModelKit>
  async updateModelKit(id: string, input: UpdateModelKitInput): Promise<ModelKit>
  async deleteModelKit(id: string): Promise<void>
  async listModelKits(): Promise<ModelKit[]>
  async testAndSaveModelKit(testInput: TestModelInput): Promise<ModelKit>
  ```
- **实现逻辑**: 
  - `testAndSaveModelKit`: 先执行测试(调用现有的 CLI/Provider 测试逻辑),成功后保存到 `state.engine.modelKits`

**任务 1.3**: 扩展 Server API
- **文件**: [apps/server/src/index.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/server/src/index.ts)
- **新增端点**:
  ```typescript
  POST   /api/model-kits              // 创建 ModelKit
  PATCH  /api/model-kits/:id          // 更新 ModelKit
  DELETE /api/model-kits/:id          // 删除 ModelKit
  GET    /api/model-kits              // 列出所有 ModelKits
  POST   /api/model-kits/test-and-save // 测试并保存
  ```

### Phase 2: UI 重构 - 执行模式 → 模型管理 (P1 - 用户体验)

**任务 2.1**: 重构 AppSettingsDialog
- **文件**: [apps/web/src/App.tsx](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/web/src/App.tsx) 第 1724-1913 行
- **修改**:
  1. 将标签页标题从 "执行模式" 改为 "模型管理"
  2. 保留现有的 CLI/BYOK 配置和测试功能
  3. 在每个测试通过的配置卡片上添加 "保存为 ModelKit" 按钮
  4. 点击后弹出对话框,让用户输入 ModelKit 名称和元数据(costTier, performanceProfile)
  5. 调用 `POST /api/model-kits/test-and-save`

**任务 2.2**: 新增 ModelKit 管理界面
- **文件**: [apps/web/src/App.tsx](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/web/src/App.tsx)
- **新增组件**: `ModelKitManager`
- **功能**:
  - 表格展示所有 ModelKits (名称,类型,模型,成本等级,性能特征,创建时间)
  - 支持编辑和删除
  - 支持复制已有配置快速创建新 ModelKit

### Phase 3: Sub-agent 基础设施 (P1 - 核心功能)

**任务 3.1**: 定义 Sub-agent 类型
- **文件**: [packages/core/src/types.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/packages/core/src/types.ts)
- **新增**:
  ```typescript
  export interface SubAgent {
    id: string;
    name: string;
    role: string;
    capabilities: string[];
    modelKitId: string;
    mode: "entry" | "worker";
    permissions: SubAgentPermissions;
    promptTemplate?: string;
    metadata: SubAgentMetadata;
  }
  
  export interface SubAgentPermissions {
    allowedTools: string[];
    deniedTools: string[];
    maxSteps?: number;
  }
  
  export interface SubAgentMetadata {
    createdAt: string;
    updatedAt: string;
    usageCount: number;
  }
  
  export interface RepoHelmState {
    // ... 现有字段
    subAgents: Record<string, SubAgent>; // 新增
    entrySubAgentId?: string;            // 新增: 入口 Sub-agent ID
  }
  ```

**任务 3.2**: 扩展 Service 层 API
- **文件**: [packages/core/src/service.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/packages/core/src/service.ts)
- **新增方法**:
  ```typescript
  async createSubAgent(input: CreateSubAgentInput): Promise<SubAgent>
  async updateSubAgent(id: string, input: UpdateSubAgentInput): Promise<SubAgent>
  async deleteSubAgent(id: string): Promise<void>
  async listSubAgents(): Promise<SubAgent[]>
  async setEntrySubAgent(id: string): Promise<void>
  async getEntrySubAgent(): Promise<SubAgent | undefined>
  ```
- **验证逻辑**: 
  - 创建时必须验证 `modelKitId` 存在
  - 设置入口 agent 时必须验证该 agent 存在且 `mode !== "worker"`

**任务 3.3**: 扩展 Server API
- **文件**: [apps/server/src/index.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/server/src/index.ts)
- **新增端点**:
  ```typescript
  POST   /api/sub-agents              // 创建 Sub-agent
  PATCH  /api/sub-agents/:id          // 更新 Sub-agent
  DELETE /api/sub-agents/:id          // 删除 Sub-agent
  GET    /api/sub-agents              // 列出所有 Sub-agents
  POST   /api/sub-agents/set-entry    // 设置入口 Sub-agent
  GET    /api/sub-agents/entry        // 获取入口 Sub-agent
  ```

### Phase 4: Sub-agent 管理 UI (P1 - 用户体验)

**任务 4.1**: 创建 Sub-agent 管理界面
- **文件**: [apps/web/src/App.tsx](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/web/src/App.tsx)
- **新增组件**: `SubAgentManager`
- **布局**:
  - 左侧: Sub-agent 列表 (卡片式,显示名称,角色,绑定的 ModelKit,模式)
  - 右侧: 详情面板 (编辑表单或创建向导)
- **功能**:
  1. **列表视图**: 
     - 显示所有 Sub-agents
     - 标记入口 Sub-agent (特殊图标)
     - 点击卡片进入编辑模式
  2. **创建向导**:
     - Step 1: 基本信息 (名称,角色描述,能力标签)
     - Step 2: 选择 ModelKit (下拉框,只显示已有的 ModelKits)
     - Step 3: 配置权限 (工具白名单/黑名单,最大步数)
     - Step 4: 选择模式 (entry/worker)
     - Step 5: 可选的系统提示模板
  3. **入口设置**: 
     - 在每个 Sub-agent 卡片上添加 "设为入口" 按钮
     - 点击后调用 `POST /api/sub-agents/set-entry`

**任务 4.2**: 集成到主应用导航
- **文件**: [apps/web/src/App.tsx](file:///Users/chenmeili/Documents/GitHub/RepoHelm/apps/web/src/App.tsx)
- **修改**: 在侧边栏或顶部导航添加 "Sub-agent 管理" 入口

### Phase 5: Sub-agent 编排引擎 (P2 - 高级功能)

**任务 5.1**: 创建 Orchestrator 模块
- **文件**: 新建 `packages/core/src/orchestrator.ts`
- **核心类**:
  ```typescript
  class SubAgentOrchestrator {
    constructor(private service: RepoHelmService) {}
    
    async executeQuest(questId: string): Promise<QuestExecutionResult> {
      // 1. 获取入口 Sub-agent
      const entryAgent = await this.service.getEntrySubAgent();
      if (!entryAgent) throw new Error("No entry sub-agent configured");
      
      // 2. 入口 agent 分析任务
      const analysis = await this.invokeSubAgent(entryAgent, {
        task: quest.requirement,
        context: quest.context
      });
      
      // 3. 根据分析结果路由到 worker agents
      const workerTasks = this.routeToWorkers(analysis, entryAgent);
      
      // 4. 并行/串行执行 worker agents
      const results = await Promise.all(
        workerTasks.map(task => this.invokeSubAgent(task.agent, task.input))
      );
      
      // 5. 聚合结果
      return this.aggregateResults(results);
    }
    
    private async invokeSubAgent(agent: SubAgent, input: SubAgentInput): Promise<SubAgentOutput> {
      // 1. 获取绑定的 ModelKit
      const modelKit = await this.service.getModelKit(agent.modelKitId);
      
      // 2. 构建 AgentBackend
      const backend = this.createBackendFromModelKit(modelKit);
      
      // 3. 应用权限限制
      const restrictedBackend = this.applyPermissions(backend, agent.permissions);
      
      // 4. 执行
      const result = await restrictedBackend.run({
        systemPrompt: agent.promptTemplate,
        messages: input.messages,
        tools: this.filterTools(agent.permissions)
      });
      
      // 5. 更新使用统计
      await this.service.updateSubAgentUsage(agent.id);
      
      return result;
    }
  }
  ```

**任务 5.2**: 集成到 Quest 执行流程
- **文件**: [packages/core/src/service.ts](file:///Users/chenmeili/Documents/GitHub/RepoHelm/packages/core/src/service.ts)
- **修改**: `runQuest` 方法
  ```typescript
  async runQuest(questId: string): Promise<Quest> {
    const orchestrator = new SubAgentOrchestrator(this);
    
    // 检查是否配置了 Sub-agents
    const entryAgent = await this.getEntrySubAgent();
    if (entryAgent) {
      // 使用新的编排引擎
      return orchestrator.executeQuest(questId);
    } else {
      // 回退到现有的单次 backend.run() 逻辑
      return this.runQuestLegacy(questId);
    }
  }
  ```

**任务 5.3**: 实现路由逻辑
- **文件**: `packages/core/src/orchestrator.ts`
- **简单版本**: 基于关键词匹配
  ```typescript
  private routeToWorkers(analysis: TaskAnalysis, entryAgent: SubAgent): WorkerTask[] {
    const workers = await this.listSubAgents().filter(a => a.mode === "worker");
    
    const tasks: WorkerTask[] = [];
    
    // 如果分析结果包含 "spec" 相关关键词,路由到 Spec Agent
    if (analysis.needs.includes("specification")) {
      const specAgent = workers.find(w => w.capabilities.includes("specification"));
      if (specAgent) tasks.push({ agent: specAgent, input: {...} });
    }
    
    // 如果分析结果包含 "implementation" 相关关键词,路由到 Implementation Agent
    if (analysis.needs.includes("implementation")) {
      const implAgent = workers.find(w => w.capabilities.includes("implementation"));
      if (implAgent) tasks.push({ agent: implAgent, input: {...} });
    }
    
    return tasks;
  }
  ```

### Phase 6: Opencode 调研报告 (P1 - 知识沉淀)

**任务 6.1**: 撰写调研报告
- **文件**: `/Users/chenmeili/Documents/GitHub/RepoHelm/opencode-subagent-research.md`
- **内容大纲**:
  ```markdown
  # Opencode Sub-agent 架构调研报告
  
  ## 1. 项目概述
  - Opencode 是什么
  - 核心设计理念
  
  ## 2. Sub-agent 架构设计
  ### 2.1 数据模型
  - Agent Info 结构 (mode, model, permissions, prompt)
  - V1 vs V2 版本差异
  
  ### 2.2 配置管理
  - 基于文件的配置 (.opencode/agent/*.md)
  - YAML frontmatter + Markdown prompt
  - 动态加载机制 (Glob 扫描)
  
  ### 2.3 路由与编排
  - Mode 分类 (primary, subagent, all)
  - Session 执行时的 agent 选择逻辑
  - 父子 session 关系 (parentID)
  
  ### 2.4 权限控制
  - 工具白名单/黑名单
  - Permission ruleset
  
  ## 3. 与 RepoHelm 的对比
  ### 3.1 相似点
  - 都支持多 agent 协作
  - 都有权限控制机制
  - 都绑定特定模型
  
  ### 3.2 差异点
  - Opencode: 文件配置, RepoHelm: UI 配置
  - Opencode: 隐式路由 (基于 mode), RepoHelm: 显式路由 (基于编排器)
  - Opencode: 轻量级, RepoHelm: 企业级 (需要审计,知识库)
  
  ## 4. 可借鉴的设计模式
  1. Mode 分离: 明确区分入口和子任务 agent
  2. 权限细粒度控制: 每个 agent 独立工具集
  3. 模型绑定: agent 与高性价比模型一对一关联
  4. 文件即配置: 便于版本控制 (可作为 RepoHelm 的导出格式)
  
  ## 5. 实施建议
  - 采用 Opencode 的 mode 分类思想
  - 保留 RepoHelm 的 UI 配置优势
  - 增加 ModelKit 抽象层,解耦 agent 与具体配置
  - 实现显式编排器,支持复杂路由逻辑
  ```

---

## 四、技术风险与缓解措施

### 4.1 向后兼容性

**风险**: 现有用户可能没有配置 Sub-agents,直接切换到编排引擎会导致失败

**缓解**:
- 在 `runQuest` 中检测是否配置了入口 Sub-agent
- 如果没有,回退到现有的 `runQuestLegacy` 逻辑
- 在 UI 中显示提示:"检测到未配置 Sub-agents,使用传统执行模式"

### 4.2 性能开销

**风险**: 多次调用不同 Sub-agents 可能导致延迟增加

**缓解**:
- 支持并行执行 worker agents (使用 `Promise.all`)
- 缓存 ModelKit 配置,避免重复查询
- 添加超时控制,单个 agent 执行不超过设定阈值

### 4.3 复杂度增加

**风险**: 引入 Orchestrator, Sub-agent, ModelKit 多层抽象,增加理解成本

**缓解**:
- 提供清晰的文档和示例
- 在 UI 中使用引导式向导,降低配置难度
- 默认提供预设的 Sub-agent 模板 (Spec Agent, Implementation Agent 等)

---

## 五、验收标准

### 5.1 功能验收

1. **ModelKit 管理**:
   - ✅ 可以在 UI 中将测试通过的 CLI/BYOK 配置保存为 ModelKit
   - ✅ 可以查看,编辑,删除 ModelKits
   - ✅ ModelKits 持久化到 SQLite

2. **Sub-agent 管理**:
   - ✅ 可以创建 Sub-agent 并绑定 ModelKit
   - ✅ 可以设置入口 Sub-agent
   - ✅ 可以查看 Sub-agent 列表和使用统计

3. **编排执行**:
   - ✅ 配置入口 Sub-agent 后,Quest 执行使用新的编排引擎
   - ✅ 未配置时回退到传统模式
   - ✅ 事件日志中记录每个 Sub-agent 的执行情况

4. **调研报告**:
   - ✅ `opencode-subagent-research.md` 文件存在于项目根目录
   - ✅ 报告涵盖架构设计,配置管理,路由逻辑,权限控制
   - ✅ 包含与 RepoHelm 的对比分析和实施建议

### 5.2 质量验收

1. **类型安全**: 所有新增代码通过 TypeScript 类型检查 (`pnpm typecheck`)
2. **单元测试**: 新增 Service 方法有对应的单元测试 (`pnpm test`)
3. **端到端测试**: 关键用户流程有 E2E 测试覆盖 (`pnpm test:e2e`)
4. **代码审查**: 所有 PR 经过 CodeReview agent 审查

---

## 六、依赖关系与执行顺序

```
Phase 0 (类型修复)
  └─ 任务 0.1, 0.2 (可并行)

Phase 1 (ModelKit 基础)
  ├─ 任务 1.1 (类型定义)
  ├─ 任务 1.2 (Service API) ← 依赖 1.1
  ├─ 任务 1.3 (Server API) ← 依赖 1.1
  └─ 任务 2.1, 2.2 (UI 重构) ← 依赖 1.2, 1.3

Phase 3 (Sub-agent 基础)
  ├─ 任务 3.1 (类型定义)
  ├─ 任务 3.2 (Service API) ← 依赖 3.1
  ├─ 任务 3.3 (Server API) ← 依赖 3.1
  └─ 任务 4.1, 4.2 (UI) ← 依赖 3.2, 3.3

Phase 5 (编排引擎)
  ├─ 任务 5.1 (Orchestrator) ← 依赖 Phase 1, Phase 3
  ├─ 任务 5.2 (集成到 runQuest) ← 依赖 5.1
  └─ 任务 5.3 (路由逻辑) ← 依赖 5.1

Phase 6 (调研报告)
  └─ 任务 6.1 (可独立进行,与 Phase 1-5 并行)
```

**推荐执行顺序**:
1. Phase 0 (立即修复,1天)
2. Phase 1 + Phase 6 (并行,3-4天)
3. Phase 3 (3天)
4. Phase 2 + Phase 4 (UI 工作,并行,3天)
5. Phase 5 (编排引擎,5-7天)

**总工期**: 约 15-18 个工作日

---

## 七、关键文件清单

| 阶段 | 文件路径 | 操作 | 说明 |
|------|---------|------|------|
| Phase 0 | `apps/web/src/api.ts` | 修改 | 统一 EngineConfig 类型 |
| Phase 1 | `packages/core/src/types.ts` | 新增 | ModelKit 类型定义 |
| Phase 1 | `packages/core/src/service.ts` | 新增 | ModelKit CRUD 方法 |
| Phase 1 | `apps/server/src/index.ts` | 新增 | ModelKit API 端点 |
| Phase 2 | `apps/web/src/App.tsx` | 修改 | 重构执行模式 UI |
| Phase 3 | `packages/core/src/types.ts` | 新增 | Sub-agent 类型定义 |
| Phase 3 | `packages/core/src/service.ts` | 新增 | Sub-agent CRUD 方法 |
| Phase 3 | `apps/server/src/index.ts` | 新增 | Sub-agent API 端点 |
| Phase 4 | `apps/web/src/App.tsx` | 新增 | Sub-agent 管理 UI |
| Phase 5 | `packages/core/src/orchestrator.ts` | 新建 | 编排引擎核心逻辑 |
| Phase 5 | `packages/core/src/service.ts` | 修改 | 集成到 runQuest |
| Phase 6 | `opencode-subagent-research.md` | 新建 | 调研报告 |

---

## 八、后续优化方向 (P3+)

1. **智能路由**: 基于历史数据学习哪个 Sub-agent 最适合某类任务
2. **成本优化**: 自动选择性价比最高的 ModelKit,考虑 token 成本和响应时间
3. **A/B 测试**: 对比不同 Sub-agent 配置的效果
4. **可视化编排**: Drag-and-drop 界面设计 Sub-agent 工作流
5. **向量检索**: 增强知识库搜索,支持语义匹配
6. **Sandbox Runtime**: 集成 CubeSandbox,隔离不可信命令执行
