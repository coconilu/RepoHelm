# RepoHelm Milestones

最后更新：2026-06-05

本文档记录 RepoHelm 当前里程碑状态：哪些已经完成和验收，哪些正在推进，哪些明确还没做。

它和 `TODO.md` 的区别：

- `MILESTONES.md` 记录产品能力路线和交付状态。
- `TODO.md` 记录开源项目建设事项，例如 CI、贡献指南、安全文档、issue template 等。
- `docs/architecture.md` 记录架构原则和长期设计依据。

## 状态说明

- Done：已实现，并已通过当前阶段验证。
- Partial：已有骨架或部分能力，但还不能作为完整产品能力使用。
- Planned：已经进入路线图，但还未开始实现。
- Later：完整形态能力，不阻塞 MVP。

## M0：方向和架构定稿

状态：Done

目标：

- 明确 RepoHelm 只做 Quest 工作区，不做 Editor，不做 IDE 插件。
- 保留 Workspace、Quest、Knowledge、Spec 驱动开发。
- Workspace 采用虚拟空间模型，可以关联多个项目，而不是一个目录等于一个 workspace。
- 明确 worktree 模式：为 Quest 涉及的项目创建隔离 worktree。
- 明确主干 Agent + sub-agent 的工作方式。
- 明确 Capability Agent 方向：根据任务分析所需 skills、agents、MCP，但默认不自动安装未审查能力。
- 明确主流模型和 agent backend 接入方向：Codex、Qwen、DeepSeek、Claude Code，并参考 OpenCode 的 provider/backend 分层。

已完成：

- `docs/architecture.md` 记录了产品边界、核心概念、MVP 范围和完整形态。
- 架构文档已切换为中文。
- 补充了技术架构方向，包括 pnpm monorepo、本地 Web UI、Hono API、React/Vite、TypeScript、未来 SQLite + 文件系统知识库等。

未做：

- ADR 目录和正式决策记录还未建立。
- 安全文档和威胁模型还未建立。

## M1：MVP 闭环

状态：Done

目标：

证明核心闭环可以跑通：

```text
创建 workspace -> 关联项目 -> 创建 Quest -> 生成 Spec -> 创建 worktree -> 运行 Agent -> Review diff -> 记录知识
```

已完成：

- pnpm monorepo。
- `apps/server` 本地 API。
- `apps/web` React/Vite Web UI。
- `packages/core` 核心领域逻辑。
- Demo workspace 自动创建。
- 当前 RepoHelm 仓库作为关联项目。
- Quest 创建。
- 轻量 Spec 生成。
- Quest 状态流转和 Agent event log。
- mock Implementation Agent。
- 真实 Git worktree 创建。
- mock Agent 在 worktree 中写入真实文件。
- changed files 和 git diff 读取。
- validation results。
- review notes。
- knowledge memory。
- UI 展示 workspace、projects、quests、Spec、timeline、worktree、review、knowledge、changed files、diff。
- Agent Backend 抽象和本机可用性检测：
  - Mock Implementation Agent。
  - Codex CLI 占位检测。
  - Claude Code 占位检测。
  - OpenCode 占位检测。
- 测试：
  - 核心单元测试。
  - Playwright e2e。
  - `pnpm test:all` 聚合校验。

已验收：

- 人工验证 MVP 通过。
- 人工验证 M1 通过。
- 自动化验证通过：
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:e2e`
  - `pnpm test:all`
  - `pnpm build`

未做：

- 外部 Agent CLI 真实执行协议。
- Codex CLI / Claude Code / OpenCode 的真实任务执行 adapter。
- Qwen / DeepSeek / OpenAI-compatible provider 配置和调用。
- Worktree 清理、重试、冲突处理、生命周期管理。
- Commit / PR 交付流程。
- SQLite 持久化。
- 文件系统知识库目录。
- 权限模型和工具审批流。

## M1.5：Quest 工作台 UI 重构

状态：Done

目标：

- 参考 Qoder Quest 工作区的空间组织方式。
- 从卡片式 dashboard 调整为三栏 Quest 工作台。
- 左侧负责 workspace 树、requests 和知识中心入口。
- 中间负责 Agent Chat。
- 右侧负责 Spec、overview、files、diff、logs 检查。

已完成：

- 新增 UI 方案文档：`docs/ui-layout.md`。
- 重构 Web UI 为三栏布局。
- 增加 Inspector tabs。
- 左栏改为 workspace 顶级树，展开后显示 requests。
- Workspace 三点菜单打开配置弹窗，并展示已关联项目。
- 中间主区域改为 Agent Chat。
- Spec 移动到右侧 Inspector，由 Agent 判断后展示。
- 左下角知识中心改为弹窗。
- 保留现有 API 和 runtime，不改变核心领域逻辑。
- e2e 测试已更新到新布局。
- 桌面和移动宽度无横向溢出。
- 桌面 App 形态限制为 `100vh`，三栏支持独立滚动。

未做：

- Quest 列表搜索、折叠和过滤。
- UI 状态路由持久化。
- 空状态和首次启动引导的进一步打磨。
- 深色模式。
- 可访问性专项检查。

## M2：Workspace 和项目配置

状态：Done

目标：

让 RepoHelm 从 demo workspace 进入真实 workspace 配置阶段。

已完成：

- Workspace 配置已进入本地状态文件 `.repohelm/state.json`，并支持旧状态自动补齐新字段。
- Workspace 支持名称、描述、worktree root 配置。
- 一个 workspace 可以关联多个本地项目。
- Project 支持 role、路径、默认分支、验证命令。
- Workspace 切换沿用左侧 workspace 树。
- 项目健康检查已接入，支持识别路径缺失、非 Git repo 和 Git repo 可用状态。
- Quest worktree 创建使用 workspace 自己的 worktree root。
- UI 支持查看、编辑、新增、移除 workspace projects。
- API 支持 workspace/project 更新、项目移除和项目健康检查。
- 单元测试和 e2e 已覆盖 M2 主流程。

暂不做：

- Team workspace 同步。
- 云端 workspace。
- 权限协作模型。

## M3：持久化和知识库

状态：Planned

目标：

替换临时 JSON state，建立可长期演进的本地数据层和知识库。

计划做：

- SQLite 状态库。
- 文件系统知识库目录。
- Quest memory 文件化。
- Project summary。
- Knowledge 搜索。
- Agent 可以读取相关 knowledge。
- Agent 可以写入 Quest memory。

暂不做：

- 向量数据库。
- 团队共享知识库。
- 自动从网络导入知识。

## M4：真实 Agent Backend

状态：Planned

目标：

让 Quest 可以调用真实 agent backend 执行任务，而不只是 mock。

计划做：

- Codex CLI backend adapter。
- Claude Code backend adapter。
- OpenCode backend adapter。
- OpenAI-compatible provider adapter，用于 Qwen、DeepSeek 等模型。
- Backend 配置页或配置文件。
- 执行日志采集。
- 超时、失败、取消和重试。
- Agent 输出 artifact 标准化。

暂不做：

- 自动选择最优模型。
- 多租户 provider 管理。
- 托管模型网关。

## M5：Worktree 生命周期和交付

状态：Planned

目标：

把 worktree 从“能创建和展示 diff”推进到“可交付变更”。

计划做：

- Worktree 列表和详情。
- Worktree 清理。
- Worktree 重试。
- 已存在 worktree/branch 冲突处理。
- Diff review 体验增强。
- 按 project commit。
- 生成 commit message。
- PR 创建能力。
- 交付前验证命令。

暂不做：

- 复杂 merge queue。
- 团队 code owner 审批。
- 云端执行环境。

## M6：Capability Agent 和扩展能力

状态：Planned

目标：

实现“根据任务分析需要哪些 skills、agents、MCP”的能力，但默认保持可审计和可控。

计划做：

- Capability Agent。
- Skills manifest。
- Agents manifest。
- MCP manifest。
- 能力推荐。
- 能力来源记录。
- 人工确认后安装或复制能力。
- 能力权限声明。

暂不做：

- 未经确认自动安装网络能力。
- 默认信任第三方 MCP。
- 自动执行未知脚本。

## M7：安全执行和权限模型

状态：Planned

目标：

让 RepoHelm 可以安全地执行本地命令、Agent 任务和 MCP 能力。

计划做：

- Tool permission model。
- 命令审批策略。
- 文件访问 scope。
- 网络访问 scope。
- secrets 访问策略。
- 执行审计日志。
- sandbox runtime 抽象。
- 评估 CubeSandbox 或其他隔离执行方案。

暂不做：

- Team policy server。
- 企业级 RBAC。
- 远程执行集群。

## M8：完整产品形态

状态：Later

目标：

在 MVP 验证后，扩展为更完整的 Quest Workspace 产品。

可能方向：

- Desktop app。
- Standalone binary。
- 多 workspace 模板。
- 多项目依赖地图。
- 团队共享 workspace。
- 更强 Spec 工作流。
- 更强 Review Agent。
- Provider marketplace。
- Skills / Agents / MCP 可信扩展市场。
- 文档站点。
- 开源治理体系。

明确不做或不优先做：

- Editor。
- IDE 插件。
- inline completion。
- 把 RepoHelm 变成通用聊天客户端。
- 把 Quest workspace 变成传统项目管理工具。

## 当前最近焦点

下一阶段优先级建议：

1. M2：真实 workspace/project 配置。
2. M3：SQLite + 文件系统知识库。
3. M4：先接入一个真实 Agent Backend，建议从 Codex CLI 或 OpenCode 开始。
4. M5：补齐 worktree 清理和交付流程。
