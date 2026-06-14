# RepoHelm Milestones

最后更新：2026-06-14

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

- Workspace 配置已进入本地状态库，并支持旧状态自动补齐新字段。
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

状态：Done

目标：

替换临时 JSON state，建立可长期演进的本地数据层和知识库。

已完成：

- 默认状态存储切换为 `.repohelm/state.sqlite`。
- 保留 legacy `.repohelm/state.json` 迁移路径。
- 文件系统知识库目录默认写入 `.repohelm/knowledge`。
- Bootstrap 阶段会写入产品方向 seed knowledge 和 Project summary。
- Project 新增或更新时会维护对应 Project summary。
- Quest 创建时会检索相关 workspace knowledge，并把引用动作写入 Agent event。
- Spec background 会体现 Agent 已参考 workspace knowledge。
- Quest 运行结束后会将 Quest memory 写入知识库 Markdown 文件。
- 知识中心弹窗支持按关键词搜索 workspace knowledge。
- API 支持 `GET /api/workspaces/:id/knowledge?q=...`。
- 启动时会为缺少 `sourcePath` 或文件丢失的知识项补写 Markdown 文件。
- 单元测试覆盖 SQLite 默认持久化、legacy JSON 迁移、知识检索和 Quest memory 文件化。
- e2e 覆盖知识中心搜索和知识文件路径展示。

暂不做：

- 团队共享知识库。
- 自动从网络导入知识。

> 后续演进：知识库已升级为 repo-bound Repo Wiki（每个 Project 6 篇结构化 wiki 页 + chunk embeddings 向量检索），详见下方 **M9**。

## M4：真实 Agent Backend

状态：Done

目标：

让 Quest 可以调用真实 agent backend 执行任务，而不只是 mock。

已完成：

- Codex CLI backend adapter 已支持通过 `REPOHELM_CODEX_COMMAND` 执行真实外部命令。
- Claude Code backend adapter 已支持通过 `REPOHELM_CLAUDE_COMMAND` 执行真实外部命令。
- OpenCode backend adapter 已支持通过 `REPOHELM_OPENCODE_COMMAND` 执行真实外部命令。
- OpenAI-compatible provider adapter 已支持 `REPOHELM_OPENAI_BASE_URL`、`REPOHELM_OPENAI_MODEL` 和 `REPOHELM_OPENAI_API_KEY` 配置，可用于 Qwen、DeepSeek 等兼容接口。
- Backend 配置入口采用环境变量，并在 UI backend 选择器中展示可用性。
- 外部 CLI 执行会写入 `.repohelm/agent-input.json`，并在 worktree 中运行配置命令。
- 执行日志已采集 stdout、stderr、失败信息和标准化事件。
- CLI backend 已支持超时，失败会进入 backend 结果和 Agent event。
- Agent 输出 artifact 通过 changed files、diff、Agent event 和 summary 标准化展示。
- 单元测试覆盖配置后的 Codex CLI backend 真实执行和 artifact 采集。
- e2e 覆盖 UI 选择 Codex CLI backend、运行外部 CLI fixture、展示产物 diff。

暂不做：

- 自动选择最优模型。
- 多租户 provider 管理。
- 托管模型网关。
- 用户手动取消正在运行的外部进程。

## M5：Worktree 生命周期和交付

状态：Done

目标：

把 worktree 从“能创建和展示 diff”推进到“可交付变更”。

已完成：

- API 支持列出 workspace/Quest worktree，并在 Inspector 概要中展示详情。
- UI 支持 Quest 级重试、清理和交付操作。
- Worktree 清理支持 `git worktree remove --force` 和本地分支删除。
- Worktree 重试会先清理既有 worktree，再重新运行 Quest。
- 已存在 worktree 会复用，已存在非 Git 目录会标记失败，避免覆盖用户文件。
- Diff review 保留交付前变更和 artifact 内容。
- 支持按 project 运行交付前验证命令。
- 支持按 project commit worktree 中的全部变更。
- Commit message 会根据 Quest 标题生成。
- 支持 PR handoff；设置 `REPOHELM_ENABLE_GH_PR=1` 后可通过 `gh pr create` 创建 PR。
- Delivery results 会记录 validation output、commit sha、PR URL 或 handoff note。
- 单元测试覆盖交付验证、commit、PR handoff、worktree 清理和重试。
- e2e 覆盖 UI 交付、delivery results 展示和 worktree 清理。

暂不做：

- 复杂 merge queue。
- 团队 code owner 审批。
- 云端执行环境。

## M6：Capability Agent 和扩展能力

状态：Done

目标：

实现“根据任务分析需要哪些 skills、agents、MCP”的能力，但默认保持可审计和可控。

已完成：

- Capability Agent 会在 Quest 创建时生成能力推荐。
- 内置 Skills manifest：Security Review Skill。
- 内置 Agents manifest：Spec Agent、Review Agent。
- 内置 MCP manifest：MCP Manifest Auditor。
- 能力推荐包含 reason、confidence、required permissions 和状态。
- 能力来源记录支持 builtin/workspace/external。
- UI Inspector 新增“能力”页，展示推荐和 manifest。
- 人工确认后能力会标记 enabled，并写入 Agent event。
- 人工忽略会记录 dismissed 状态和审计事件。
- 能力权限声明在 UI 和事件中展示。
- 单元测试覆盖推荐、权限声明和人工确认。
- e2e 覆盖 UI 能力推荐和确认启用。

暂不做：

- 未经确认自动安装网络能力。
- 默认信任第三方 MCP。
- 自动执行未知脚本。

## M7：安全执行和权限模型

状态：Done

目标：

让 RepoHelm 可以安全地执行本地命令、Agent 任务和 MCP 能力。

已完成：

- Tool permission model 已进入本地 state。
- 命令审批策略支持 allowlist 和 manual 两种模式。
- 外部 Agent backend 执行前会检查命令 allowlist。
- 交付前 validation command 执行前会检查命令 allowlist。
- 文件访问 scope 已记录 workspace、worktree、knowledge。
- 网络访问 scope 已记录 localhost。
- secrets 访问策略支持 redact-env/deny 声明。
- 执行审计日志记录 command、capability、sandbox 等事件。
- UI Inspector 新增“安全”页，展示 permission model 和 audit log。
- sandbox runtime 抽象记录 local/external，当前默认 local。
- 单元测试覆盖 deny 未授权外部命令和 audit log。
- e2e 覆盖安全页和 Codex CLI allowlist 审计。

暂不做：

- Team policy server。
- 企业级 RBAC。
- 远程执行集群。

## M8：完整产品形态

状态：Done

目标：

在 MVP 验证后，扩展为更完整的 Quest Workspace 产品。

已完成：

- Product readiness API 和 UI。
- Inspector 新增“产品”页，展示 M4-M8 readiness。
- 多 workspace 模板方向已产品化展示：Single Repo、Multi-project、Secure Agent。
- 多项目依赖地图可基于 workspace projects 和 role 生成。
- Governance readiness 展示 Roadmap、Architecture 和 Testing 状态。
- Product readiness 覆盖 Agent backend、worktree delivery、Capability Agent、安全执行和完整产品形态。
- 单元测试覆盖 readiness、模板和依赖地图。
- e2e 覆盖产品页、M8 状态、模板和治理入口。

明确不做或不优先做：

- Editor。
- IDE 插件。
- inline completion。
- 把 RepoHelm 变成通用聊天客户端。
- 把 Quest workspace 变成传统项目管理工具。
- 真正的桌面壳、standalone binary、团队同步和扩展市场仍作为后续产品化方向。

## M9：编排深化、worker 执行闭环与知识库升级

状态：Done

目标：

把 Agent 执行从「单个 mock backend 跑一步」推进到「可审批的多 agent 编排 + 可观测、可自纠的 worker 执行 + repo 级知识库」。

已完成：

- **动态编排状态机（issue #4）**：编排升级为「确定性状态机 + lead agent 动态决策」。planner 先生成可审批的 orchestration plan（用户 approve/reject 后才执行）；执行阶段按依赖顺序逐步委派，lead agent 在每步后动态决定 retry / reassign / revise，状态机对单步设硬上限（`MAX_STEP_ATTEMPTS`），保证一定终止。简单 Quest 走 `assessComplexity` 快路径生成单步计划，不调用 LLM。
- **Task contract**：planner 为每个计划步骤生成并校验 task contract，注入 worker prompt，并在 plan 审批视图展示；`plan.md` round-trip 持久化，兼容无 contract 的旧步骤。
- **Worker 反馈闭环（issue #3 系列）**：worker 进入 run / observe / fix 闭环，配套受限工具集——allowlist 门控的 `run_command`（按 argv 命令模板校验，而非仅二进制名，防命令注入）、上下文锚定的外科手术 `edit_file`、worktree 受限代码搜索；worker 执行事件传播到 Quest 时间线；削弱了 tool-capable worker 的散文 file-path 回退。
- **结构化 CLI 事件（issue #5）**：新增流式 CLI 输出 parser/runner，把外部 CLI 输出解析为结构化事件并接入时间线；解析 Codex `exec --json` 事件；命令输出截断保留头尾，避免丢失尾部失败信息。
- **命令模板授权（PR #9）**：worker 的每条 `run_command` 都对安全策略做审计，按命令模板而非二进制名门控。
- **Repo Wiki 知识库**：知识库升级为 repo-bound Repo Wiki。每个 Project 拥有 6 篇结构化 wiki 页（overview/architecture/modules/key-flows/conventions/decisions，Markdown 为唯一真相）+ chunk embeddings。支持 bootstrap（全量索引）、incremental（diff `lastIndexedSha..HEAD` 增量重写受影响页）、search（embed query → 余弦 top-k，无 embedding ModelKit 时关键词回退）。`WikiStore` 在 `wiki_pages`/`wiki_embeddings`（同一 SQLite，WAL）持久化页面与向量。
- **引擎模型接入（BYOK + 本机 CLI）**：设置「执行模式」支持本机 CLI（探测版本、按 CLI 选模型、连通性测试、重新扫描）与 BYOK（OpenAI-compatible provider 配置 + REST `/models` 实时拉取，SQLite 缓存）。ModelKit 统一解析 baseUrl/model/apiKey 供 LLM 调用。详见 `MODEL_FETCHING.md` 与 `docs/model-config-plan.md`。

暂不做：

- 用户手动取消正在运行的外部 worker 进程。
- 编排计划的跨 Quest 复用与模板化。
- 团队共享知识库与远程向量服务。

## 当前最近焦点

M0–M9 已全部实现并验收。后续方向（不阻塞当前 MVP）：

1. 真正的桌面壳与 standalone binary。
2. 团队 workspace 同步与协作权限模型。
3. 扩展能力市场与第三方 MCP 治理。
4. 编排计划模板化、worker 进程可取消等执行链路打磨。
