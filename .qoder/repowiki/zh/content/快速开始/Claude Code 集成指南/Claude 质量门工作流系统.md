# Claude 质量门工作流系统

<cite>
**本文档引用的文件**
- [README.md](file://README.md)
- [CLAUDE.md](file://CLAUDE.md)
- [AGENTS.md](file://AGENTS.md)
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
- [apps/server/src/index.ts](file://apps/server/src/index.ts)
- [apps/web/src/App.tsx](file://apps/web/src/App.tsx)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)

## 简介

RepoHelm 是一个开源的 Quest 工作区原型，专注于验证"虚拟 workspace + 多项目 Quest + Spec 驱动 + worktree 隔离 + Agent 编排 + 知识库"的产品方向。该系统实现了 Claude 质量门工作流，通过双代理流水线确保代码质量和一致性。

系统的核心特性包括：
- 启动本地 Web UI 和 API 服务
- 自动创建工作区和项目链接
- 基于 worktree 的隔离执行环境
- 多种 Agent 后端支持（Mock、Codex、Claude、OpenCode、OpenAI兼容）
- 知识库管理和向量化检索
- 完整的交付流水线（验证→提交→PR）

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
RepoHelmService --> GitWorktreeManager : "管理"
RepoHelmService --> AgentBackendRegistry : "注册"
RepoHelmService --> KnowledgeFileStore : "知识库"
```

**图表来源**
- [packages/core/src/service.ts:79-105](file://packages/core/src/service.ts#L79-L105)
- [packages/core/src/git.ts:49-136](file://packages/core/src/git.ts#L49-L136)
- [packages/core/src/agent.ts:395-411](file://packages/core/src/agent.ts#L395-L411)
- [packages/core/src/knowledge.ts:12-81](file://packages/core/src/knowledge.ts#L12-L81)

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
end
subgraph "工具集"
Delegate[tools/delegate.ts 委派工具]
FileSystem[tools/fs.ts 文件系统工具]
end
subgraph "基础设施"
Git[git.ts Git 管理]
Knowledge[knowledge.ts 知识库]
Agent[agent.ts 代理后端]
end
subgraph "应用层"
Server[apps/server/src/index.ts API 服务]
Web[apps/web/src/App.tsx Web 应用]
end
Types --> Service
Store --> Service
Service --> Orchestrator
Service --> Planning
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

该系统为构建高质量的 AI 辅助开发工作流奠定了坚实基础，通过持续迭代和社区贡献，有望成为下一代软件开发平台的重要组成部分。