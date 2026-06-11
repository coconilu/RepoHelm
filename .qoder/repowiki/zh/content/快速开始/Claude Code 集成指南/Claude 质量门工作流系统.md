# Claude 质量门工作流系统

<cite>
**本文档引用的文件**
- [README.md](file://README.md)
- [CLAUDE.md](file://CLAUDE.md)
- [AGENTS.md](file://AGENTS.md)
- [opencode-subagent-research.md](file://opencode-subagent-research.md)
- [MODEL_FETCHING.md](file://MODEL_FETCHING.md)
- [docs/model-config-plan.md](file://docs/model-config-plan.md)
- [packages/core/src/index.ts](file://packages/core/src/index.ts)
- [packages/core/src/orchestrator.ts](file://packages/core/src/orchestrator.ts)
- [packages/core/src/agent.ts](file://packages/core/src/agent.ts)
- [packages/core/src/service.ts](file://packages/core/src/service.ts)
- [packages/core/src/types.ts](file://packages/core/src/types.ts)
- [packages/core/src/store.ts](file://packages/core/src/store.ts)
- [packages/core/src/git.ts](file://packages/core/src/git.ts)
- [packages/core/src/knowledge.ts](file://packages/core/src/knowledge.ts)
- [packages/core/src/planning.ts](file://packages/core/src/planning.ts)
- [packages/core/src/tools/delegate.ts](file://packages/core/src/tools/delegate.ts)
- [packages/core/src/tools/fs.ts](file://packages/core/src/tools/fs.ts)
- [packages/core/src/cli.ts](file://packages/core/src/cli.ts)
- [packages/core/src/providers.ts](file://packages/core/src/providers.ts)
- [apps/server/src/index.ts](file://apps/server/src/index.ts)
- [apps/web/src/App.tsx](file://apps/web/src/App.tsx)
</cite>

## 更新摘要
**变更内容**
- 新增子代理模型选择指南章节，包含 Claude Sonnet 和 Opus 模型使用策略表格
- 更新模型配置架构说明，反映最新的模型选择机制
- 增强子代理编排器的模型绑定能力描述

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [子代理模型选择指南](#子代理模型选择指南)
7. [依赖关系分析](#依赖关系分析)
8. [性能考虑](#性能考虑)
9. [故障排除指南](#故障排除指南)
10. [结论](#结论)

## 简介

RepoHelm 是一个开源的 Quest 工作区原型，专注于验证"虚拟 workspace + 多项目 Quest + Spec 驱动 + worktree 隔离 + Agent 编排 + 知识库"的产品方向。该系统实现了 Claude 质量门工作流，通过双代理流水线确保代码质量和一致性。

系统的核心特性包括：
- 启动本地 Web UI 和 API 服务
- 自动创建工作区和项目链接
- 基于 worktree 的隔离执行环境
- 多种 Agent 后端支持（Mock、Codex、Claude、OpenCode、OpenAI兼容）
- 知识库管理和向量化检索
- 完整的交付流水线（验证→提交→PR）
- **新增**：智能子代理模型选择机制，支持 Claude Sonnet 和 Opus 模型的精细化任务分配

## 项目结构

RepoHelm 采用 pnpm workspace 架构，包含三个主要包：

```mermaid
graph TB
subgraph "根目录"
Root[RepoHelm 根目录]
Docs[文档目录]
Scripts[脚本目录]
Worktrees[工作树目录]
end
subgraph "核心包 (@repohelm/core)"
CoreSrc[packages/core/src/]
CoreIndex[index.ts 导出]
CoreTypes[types.ts 类型定义]
CoreService[service.ts 核心服务]
CoreOrchestrator[orchestrator.ts 编排器]
CoreAgent[agent.ts 代理后端]
CoreProviders[providers.ts 模型提供商]
CoreCli[Cli 模型选择]
end
subgraph "服务器 (@repohelm/server)"
ServerSrc[apps/server/src/]
ServerApi[REST API 路由]
ServerHono[Hono 框架]
end
subgraph "Web 应用 (@repohelm/web)"
WebSrc[apps/web/src/]
WebApp[App.tsx 主应用]
WebComponents[组件库]
WebApi[API 客户端]
end
Root --> CoreSrc
Root --> ServerSrc
Root --> WebSrc
CoreSrc --> CoreIndex
CoreSrc --> CoreTypes
CoreSrc --> CoreService
CoreSrc --> CoreOrchestrator
CoreSrc --> CoreAgent
CoreSrc --> CoreProviders
CoreSrc --> CoreCli
ServerSrc --> ServerApi
ServerSrc --> ServerHono
WebSrc --> WebApp
WebSrc --> WebComponents
WebSrc --> WebApi
```

**图表来源**
- [packages/core/src/index.ts:1-15](file://packages/core/src/index.ts#L1-L15)
- [packages/core/src/service.ts:79-105](file://packages/core/src/service.ts#L79-L105)
- [apps/server/src/index.ts:1-50](file://apps/server/src/index.ts#L1-L50)

**章节来源**
- [README.md:1-100](file://README.md#L1-L100)
- [CLAUDE.md:18-35](file://CLAUDE.md#L18-L35)

## 核心组件

### RepoHelmService - 中央枢纽

RepoHelmService 是整个系统的核心，承担着所有领域操作的协调职责：

```mermaid
classDiagram
class RepoHelmService {
-GitWorktreeManager gitWorktreeManager
-AgentBackendRegistry agentBackendRegistry
-ProviderRegistry providerRegistry
-LocalCliRegistry cliRegistry
-KnowledgeFileStore knowledgeFileStore
-QuestWorkspaceManager questWorkspaceManager
-WikiStore wikiStore
-RepoWikiManager repoWiki
-StateStore store
-string rootDir
-Promise~void~ _mutationQueue
+bootstrap() RepoHelmState
+ensureBuiltInSubAgents() void
+getState() RepoHelmState
+createWorkspace(input) Workspace
+createProject(input) Project
+createQuest(input) Quest
+runQuest(id) Quest
+deliverQuest(id) Quest
+listAgentBackends() AgentBackendAvailability[]
+getEngine() EngineConfig
+updateEngine(input) EngineConfig
+createModelKit(input) ModelKit
+updateModelKit(id, input) ModelKit
+deleteModelKit(id) void
+getProjectKnowledge(projectId) ProjectKnowledgeView
+syncProjectKnowledge(projectId) ProjectKnowledgeView
+searchProjectKnowledge(projectIds, query) RepoWikiPage[]
}
class GitWorktreeManager {
+createWorktree(input) CreateWorktreeResult
+removeWorktree(repoPath, worktreePath, branchName) GitOperationResult
+runValidation(worktreePath, command) GitOperationResult
+commitAll(worktreePath, message) GitOperationResult
+createPullRequest(worktreePath, title, body) GitOperationResult
}
class AgentBackendRegistry {
-AgentBackend[] backends
+get(id) AgentBackend
+listAvailability() AgentBackendAvailability[]
}
class KnowledgeFileStore {
-string rootDir
+writeWikiPage(page) string
+writeKnowledgeItem(item) string
}
class ProviderRegistry {
+list() ProviderDef[]
+get(id) ProviderDef
+resolve(id, baseUrl) ProviderDef
+envKey(def) string
+probe(def, options) Promise
+fetchModels(def, options) Promise
}
class LocalCliRegistry {
+list() CliDefinition[]
+get(id) CliDefinition
+detect(def, options) Promise
+detectAll(options) Promise
+test(def, options) Promise
}
RepoHelmService --> GitWorktreeManager : "管理"
RepoHelmService --> AgentBackendRegistry : "注册"
RepoHelmService --> KnowledgeFileStore : "知识库"
RepoHelmService --> ProviderRegistry : "模型提供商"
RepoHelmService --> LocalCliRegistry : "CLI 模型"
```

**图表来源**
- [packages/core/src/service.ts:79-105](file://packages/core/src/service.ts#L79-L105)
- [packages/core/src/git.ts:49-136](file://packages/core/src/git.ts#L49-L136)
- [packages/core/src/agent.ts:395-411](file://packages/core/src/agent.ts#L395-L411)
- [packages/core/src/knowledge.ts:12-81](file://packages/core/src/knowledge.ts#L12-L81)
- [packages/core/src/providers.ts:163-303](file://packages/core/src/providers.ts#L163-303)
- [packages/core/src/cli.ts:124-385](file://packages/core/src/cli.ts#L124-385)

### SubAgentOrchestrator - 子代理编排器

编排器负责将复杂的 Quest 分解为可执行的步骤，并通过代理池协作完成任务：

```mermaid
sequenceDiagram
participant User as 用户
participant Service as RepoHelmService
participant Orchestrator as SubAgentOrchestrator
participant Planner as Planning
participant AgentPool as 代理池
participant Worker as 工作代理
User->>Service : 创建 Quest
Service->>Planner : 评估复杂度
Planner-->>Service : 简单/复杂判断
Service->>Orchestrator : 生成计划
Orchestrator->>AgentPool : 获取可用代理
Orchestrator->>Planner : 生成执行计划
Planner-->>Orchestrator : 结构化计划
loop 逐个执行步骤
Orchestrator->>Worker : 委派任务
Worker->>Worker : 执行具体工作
Worker-->>Orchestrator : 返回结果
Orchestrator->>Orchestrator : 记录执行状态
end
Orchestrator-->>Service : 完成结果
Service-->>User : 返回最终产物
```

**图表来源**
- [packages/core/src/orchestrator.ts:58-94](file://packages/core/src/orchestrator.ts#L58-L94)
- [packages/core/src/planning.ts:74-105](file://packages/core/src/planning.ts#L74-L105)
- [packages/core/src/orchestrator.ts:131-236](file://packages/core/src/orchestrator.ts#L131-L236)

**章节来源**
- [packages/core/src/service.ts:79-105](file://packages/core/src/service.ts#L79-L105)
- [packages/core/src/orchestrator.ts:58-236](file://packages/core/src/orchestrator.ts#L58-L236)
- [packages/core/src/planning.ts:14-196](file://packages/core/src/planning.ts#L14-L196)

## 架构总览

RepoHelm 采用分层架构设计，清晰分离了表现层、业务逻辑层和基础设施层：

```mermaid
graph TB
subgraph "表现层"
WebUI[Web UI 应用]
WebApp[React 组件]
WebAPI[API 客户端]
end
subgraph "应用层"
ServerAPI[REST API 服务]
Hono[Hono 框架]
Zod[Zod 参数校验]
end
subgraph "业务逻辑层"
CoreService[RepoHelmService]
Orchestrator[SubAgentOrchestrator]
Planning[规划器]
Tools[工具集]
end
subgraph "基础设施层"
StateStore[状态存储]
GitManager[Git 管理器]
AgentBackends[代理后端]
KnowledgeStore[知识库]
ProviderRegistry[模型提供商]
LocalCliRegistry[CLI 模型注册表]
end
subgraph "外部系统"
CLIBackends[CLI 后端]
Providers[模型提供商]
GitHub[GitHub API]
end
WebUI --> WebAPI
WebAPI --> ServerAPI
ServerAPI --> CoreService
CoreService --> Orchestrator
CoreService --> Planning
CoreService --> Tools
CoreService --> StateStore
CoreService --> GitManager
CoreService --> AgentBackends
CoreService --> KnowledgeStore
AgentBackends --> CLIBackends
AgentBackends --> Providers
KnowledgeStore --> GitHub
ProviderRegistry --> Providers
LocalCliRegistry --> ProviderRegistry
```

**图表来源**
- [apps/web/src/App.tsx:95-762](file://apps/web/src/App.tsx#L95-L762)
- [apps/server/src/index.ts:43-782](file://apps/server/src/index.ts#L43-L782)
- [packages/core/src/service.ts:79-105](file://packages/core/src/service.ts#L79-L105)

## 详细组件分析

### 质量门双代理流水线

RepoHelm 实现了 Claude 质量门工作流，要求在任何重大变更上并行运行两个子代理：

```mermaid
flowchart TD
Start([开始质量门流程]) --> CheckType{"是否为重大变更?"}
CheckType --> |否| SkipPipeline["跳过质量门"]
CheckType --> |是| StartDualPipeline["启动双代理流水线"]
StartDualPipeline --> ParallelExec["并行执行两个代理"]
ParallelExec --> TestAgent["repohelm-test-agent<br/>测试驱动开发"]
ParallelExec --> Reviewer["code-reviewer<br/>代码审查"]
TestAgent --> TestResult{"测试结果"}
Reviewer --> ReviewResult{"审查结果"}
TestResult --> |通过| ContinueReview["继续审查"]
TestResult --> |失败| BlockCommit["阻止提交"]
ContinueReview --> ReviewVerdict{"审查结论"}
ReviewVerdict --> |允许| ApproveCommit["批准提交"]
ReviewVerdict --> |阻止| BlockCommit
SkipPipeline --> End([结束])
BlockCommit --> End
ApproveCommit --> End
```

**图表来源**
- [AGENTS.md:44-54](file://AGENTS.md#L44-L54)

### Agent 后端系统

系统支持多种代理后端，每种都有其特定的适用场景：

```mermaid
classDiagram
class AgentBackend {
<<interface>>
+id AgentBackendId
+name string
+getAvailability() Promise~AgentBackendAvailability~
+run(input) Promise~AgentBackendRunResult~
}
class MockAgentBackend {
+id "mock"
+name "Mock Implementation Agent"
+getAvailability() AgentBackendAvailability
+run(input) AgentBackendRunResult
}
class ExternalCliAgentBackend {
+id AgentBackendId
+name string
+binary string
+commandEnv string
+getAvailability() AgentBackendAvailability
+run(input) AgentBackendRunResult
}
class OpenAICompatibleAgentBackend {
+id "openai-compatible"
+name "OpenAI-compatible Provider"
+getAvailability() AgentBackendAvailability
+run(input) AgentBackendRunResult
}
AgentBackend <|.. MockAgentBackend
AgentBackend <|.. ExternalCliAgentBackend
AgentBackend <|.. OpenAICompatibleAgentBackend
class AgentBackendRegistry {
-AgentBackend[] backends
+get(id) AgentBackend
+listAvailability() AgentBackendAvailability[]
}
AgentBackendRegistry --> AgentBackend : "管理"
```

**图表来源**
- [packages/core/src/agent.ts:41-411](file://packages/core/src/agent.ts#L41-L411)

**章节来源**
- [packages/core/src/agent.ts:48-259](file://packages/core/src/agent.ts#L48-L259)
- [packages/core/src/agent.ts:395-411](file://packages/core/src/agent.ts#L395-L411)

### 知识库管理系统

RepoHelm 实现了完整的知识库系统，支持结构化知识存储和向量化检索：

```mermaid
erDiagram
PROJECT {
string id PK
string name
string path
string role
string defaultBranch
string validationCommand
}
WIKI_PAGE {
string id PK
string projectId FK
string slug
string title
string body
string sourcePath
datetime updatedAt
}
WIKI_EMBEDDING {
string id PK
string projectId FK
string pageId FK
string slug
string chunkText
float_vector vector
string model
datetime createdAt
}
KNOWLEDGE_ITEM {
string id PK
string workspaceId
string projectId
string questId
string type
string title
string body
string[] tags
string sourcePath
datetime createdAt
datetime updatedAt
}
PROJECT ||--o{ WIKI_PAGE : "拥有"
WIKI_PAGE ||--o{ WIKI_EMBEDDING : "包含"
KNOWLEDGE_ITEM ||--|| PROJECT : "关联"
```

**图表来源**
- [packages/core/src/types.ts:240-287](file://packages/core/src/types.ts#L240-L287)
- [packages/core/src/knowledge.ts:12-81](file://packages/core/src/knowledge.ts#L12-L81)

**章节来源**
- [packages/core/src/knowledge.ts:12-81](file://packages/core/src/knowledge.ts#L12-L81)
- [packages/core/src/types.ts:257-287](file://packages/core/src/types.ts#L257-L287)

### 工作树管理系统

系统通过 Git worktree 实现任务隔离，确保每个 Quest 在独立的工作环境中执行：

```mermaid
sequenceDiagram
participant Quest as Quest
participant GitMgr as GitWorktreeManager
participant Repo as Git 仓库
participant Worktree as Worktree 目录
Quest->>GitMgr : 创建工作树
GitMgr->>Repo : git worktree add
Repo-->>GitMgr : 返回新分支和路径
GitMgr->>Worktree : 初始化工作树目录
Worktree-->>GitMgr : 工作树就绪
Note over Worktree : 隔离的执行环境
Note over Worktree : 独立的 Git 状态
Note over Worktree : 独立的文件系统
Quest->>Worktree : 执行任务
Worktree-->>Quest : 产出变更
Quest->>GitMgr : 验证变更
GitMgr->>Worktree : 运行验证命令
Worktree-->>GitMgr : 验证结果
Quest->>GitMgr : 提交变更
GitMgr->>Worktree : git add/commit
Worktree-->>GitMgr : 提交完成
Quest->>GitMgr : 清理工作树
GitMgr->>Worktree : 删除工作树
GitMgr->>Repo : 删除分支
```

**图表来源**
- [packages/core/src/git.ts:95-136](file://packages/core/src/git.ts#L95-L136)
- [packages/core/src/git.ts:175-203](file://packages/core/src/git.ts#L175-L203)
- [packages/core/src/git.ts:205-236](file://packages/core/src/git.ts#L205-L236)

**章节来源**
- [packages/core/src/git.ts:49-402](file://packages/core/src/git.ts#L49-L402)

## 子代理模型选择指南

RepoHelm 实现了智能化的子代理模型选择机制，基于任务类型和复杂度自动分配最适合的 Claude 模型。该机制确保每个子代理都能获得最佳的性能和准确性平衡。

### 模型选择策略

系统采用基于任务类型的精细模型分配策略，主要分为两大类模型：

#### Claude Sonnet 模型
适用于需要快速执行和精确实现的任务，具有以下特征：
- **执行效率高**：适合机械性的代码实现和文件操作
- **准确性强**：在代码编写和文件读取方面表现优异
- **成本效益**：相比 Opus 更经济实惠

#### Claude Opus 模型  
适用于需要深度思考和综合分析的任务，具有以下特征：
- **思维深度**：适合复杂的规划和架构设计
- **分析能力**：在代码审查和一致性检查方面表现卓越
- **创意能力**：擅长架构设计和权衡分析

### 详细使用策略表格

| 任务类型 | 模型选择 | 典型示例 | 选择理由 |
|---------|---------|---------|---------|
| 信息收集/搜索/资料搜集 | `sonnet` | 探索代理、文件读取、代码搜索 | 快速准确的信息提取和文件操作 |
| 机械实现（按计划执行） | `sonnet` | 按规格编写代码/测试、文件修改 | 精确的代码实现和文件操作 |
| 计划撰写/任务分解/依赖判断 | `opus` | 规划生成、任务分解、依赖分析 | 深度思考和综合分析能力 |
| 架构设计/权衡分析 | `opus` | 架构设计、方案比较、技术选型 | 创造性思维和系统性分析 |
| 代码审查/规范审核/一致性检查 | `opus` | Bug 发现、类型一致性验证、规范检查 | 深度分析和细节把控能力 |
| 复杂问题解决/多步骤推理 | `opus` | 多文件协调、复杂逻辑实现、系统集成 | 综合分析和复杂问题处理 |

### 模型选择决策流程

```mermaid
flowchart TD
TaskType{任务类型识别} --> CheckComplexity{"复杂度评估"}
CheckComplexity --> SimpleTasks["简单任务"]
CheckComplexity --> ComplexTasks["复杂任务"]
SimpleTasks --> SonnetChoice["选择 Sonnet"]
ComplexTasks --> OpusChoice["选择 Opus"]
SonnetChoice --> InfoCollection["信息收集/文件读取"]
SonnetChoice --> Implementation["代码实现/文件修改"]
OpusChoice --> Planning["规划制定/任务分解"]
OpusChoice --> Architecture["架构设计/权衡分析"]
OpusChoice --> Review["代码审查/一致性检查"]
InfoCollection --> ExecuteSonnet["执行 Sonnet 任务"]
Implementation --> ExecuteSonnet
Planning --> ExecuteOpus["执行 Opus 任务"]
Architecture --> ExecuteOpus
Review --> ExecuteOpus
```

### 模型绑定机制

RepoHelm 支持每子代理级别的模型绑定，实现精细化的资源分配：

```mermaid
classDiagram
class SubAgent {
+id : string
+name : string
+role : string
+capabilities : string[]
+modelKitId : string
+mode : "entry" | "worker" | "system"
+systemRole : "knowledge" | "habits" | "failure-experience"
+permissions : SubAgentPermissions
+promptTemplate : string
+metadata : SubAgentMetadata
}
class ModelKit {
+id : string
+providerId : string
+modelId : string
+baseUrl : string
+apiKey : string
+createdAt : string
+updatedAt : string
}
class ProviderRegistry {
+list() : ProviderDef[]
+get(id) : ProviderDef
+resolve(id, baseUrl) : ProviderDef
+envKey(def) : string
+fetchModels(def, options) : Promise
}
SubAgent --> ModelKit : "绑定"
ModelKit --> ProviderRegistry : "使用"
```

**图表来源**
- [packages/core/src/types.ts:399-413](file://packages/core/src/types.ts#L399-L413)
- [packages/core/src/providers.ts:163-303](file://packages/core/src/providers.ts#L163-303)

### 实际应用场景

#### 质量门工作流中的模型选择
在质量门流程中，系统会根据任务的性质自动选择最合适的模型：

```mermaid
sequenceDiagram
participant QualityGate as 质量门
participant TaskAnalyzer as 任务分析器
participant ModelSelector as 模型选择器
participant SonnetAgent as Sonnet 代理
participant OpusAgent as Opus 代理
QualityGate->>TaskAnalyzer : 分析任务类型
TaskAnalyzer->>ModelSelector : 评估复杂度
ModelSelector->>SonnetAgent : 信息收集/实现任务
ModelSelector->>OpusAgent : 规划/审查任务
SonnetAgent-->>QualityGate : 执行结果
OpusAgent-->>QualityGate : 审查结果
QualityGate->>QualityGate : 综合评估
```

#### 动态模型切换
系统支持在运行时根据任务需求动态切换模型：

```mermaid
flowchart LR
DynamicSelection["动态模型选择"] --> TaskAnalysis["任务分析"]
TaskAnalysis --> ModelEvaluation["模型评估"]
ModelEvaluation --> CostAnalysis["成本分析"]
ModelEvaluation --> PerformanceAnalysis["性能分析"]
CostAnalysis --> ModelSelection["模型选择"]
PerformanceAnalysis --> ModelSelection
ModelSelection --> Execution["执行任务"]
Execution --> Result["返回结果"]
```

**章节来源**
- [CLAUDE.md:81-93](file://CLAUDE.md#L81-L93)
- [MODEL_FETCHING.md:42-49](file://MODEL_FETCHING.md#L42-L49)
- [packages/core/src/providers.ts:79-161](file://packages/core/src/providers.ts#L79-L161)

## 依赖关系分析

系统采用模块化设计，各组件间依赖关系清晰：

```mermaid
graph TB
subgraph "核心依赖"
Types[types.ts 类型定义]
Store[store.ts 状态存储]
Service[service.ts 核心服务]
Orchestrator[orchestrator.ts 编排器]
Planning[planning.ts 规划器]
Providers[providers.ts 模型提供商]
Cli[Cli 模型选择]
End
subgraph "工具集"
Delegate[tools/delegate.ts 委派工具]
FileSystem[tools/fs.ts 文件系统工具]
End
subgraph "基础设施"
Git[git.ts Git 管理]
Knowledge[knowledge.ts 知识库]
Agent[agent.ts 代理后端]
End
subgraph "应用层"
Server[apps/server/src/index.ts API 服务]
Web[apps/web/src/App.tsx Web 应用]
End
Types --> Service
Store --> Service
Service --> Orchestrator
Service --> Planning
Service --> Providers
Service --> Cli
Service --> Git
Service --> Knowledge
Service --> Agent
Orchestrator --> Delegate
Orchestrator --> FileSystem
Server --> Service
Web --> Server
```

**图表来源**
- [packages/core/src/index.ts:1-15](file://packages/core/src/index.ts#L1-L15)
- [apps/server/src/index.ts:1-12](file://apps/server/src/index.ts#L1-L12)

**章节来源**
- [packages/core/src/index.ts:1-15](file://packages/core/src/index.ts#L1-L15)
- [apps/server/src/index.ts:1-50](file://apps/server/src/index.ts#L1-L50)

## 性能考虑

RepoHelm 在设计时充分考虑了性能优化：

### 状态存储优化
- 使用 SQLite 替代 JSON 文件，提供更好的并发性能
- 实现状态变更队列，防止并发写入冲突
- 支持自动迁移，平滑升级数据格式

### 编排性能
- 复杂度评估机制，简单任务直接执行，避免不必要的规划
- 代理池缓存，减少重复初始化开销
- 工具调用循环限制，防止无限循环

### 知识库性能
- 向量化检索与关键字检索双重机制
- 增量索引更新，避免全量重建
- 嵌入向量缓存，提升查询速度

### 模型选择性能
- **智能缓存机制**：模型配置和选择策略的缓存，减少重复计算
- **动态资源分配**：根据任务类型和复杂度动态调整模型资源
- **成本优化**：通过合理的模型选择策略降低推理成本

## 故障排除指南

### 常见问题诊断

**代理后端不可用**
- 检查环境变量配置：`REPOHELM_CODEX_COMMAND`、`REPOHELM_CLAUDE_COMMAND`、`REPOHELM_OPENCODE_COMMAND`
- 验证 CLI 工具是否正确安装
- 使用 `listLocalClis()` 检查检测结果

**工作树创建失败**
- 检查工作树根目录权限
- 验证 Git 仓库状态
- 确认目标路径不存在冲突

**知识库索引错误**
- 检查嵌入模型配置
- 验证网络连接
- 清理缓存后重试

**模型选择异常**
- 检查模型提供商配置
- 验证 API 密钥有效性
- 确认模型列表获取正常

**章节来源**
- [packages/core/src/agent.ts:125-182](file://packages/core/src/agent.ts#L125-L182)
- [packages/core/src/git.ts:95-136](file://packages/core/src/git.ts#L95-L136)
- [packages/core/src/service.ts:220-243](file://packages/core/src/service.ts#L220-L243)

## 结论

RepoHelm 通过 Claude 质量门工作流系统，为多项目 Quest 开发提供了完整的解决方案。系统的核心优势包括：

1. **质量保证**：双代理流水线确保代码质量和一致性
2. **隔离执行**：基于 worktree 的隔离环境，保证任务独立性
3. **灵活扩展**：多后端支持，适应不同开发需求
4. **知识管理**：完整的知识库系统，支持智能检索
5. **可观测性**：全面的事件记录和审计日志
6. **智能模型选择**：基于任务类型的精细化模型分配机制，优化性能和成本

**新增的子代理模型选择指南**为开发者提供了明确的决策依据，通过 Claude Sonnet 和 Opus 模型的差异化使用策略，确保每个子代理都能在最适合的模型上执行，从而提升整体系统的效率和质量。

该系统为构建高质量的 AI 辅助开发工作流奠定了坚实基础，通过持续迭代和社区贡献，有望成为下一代软件开发平台的重要组成部分。