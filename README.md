# RepoHelm

RepoHelm 是一个开源的 Agentic Quest 工作台：以生产级 harness 提供受控工具与运行环境，以动态委派 agent 在能力和成本之间做运行时分配，以测试先行验收把每次改动变成可验证、可审计的交付。

它用虚拟 workspace、多项目 Quest、Spec 驱动、worktree 隔离、Agent 编排和 repo-bound 知识库，把一个需求转化为一次可审计、可隔离、可验证、可交付的多项目研发任务。

当前版本是 MVP 骨架，不是完整实现。它已经可以：

- 启动本地 Web UI 和 API。
- 自动创建 demo workspace。
- 将当前 RepoHelm 仓库作为一个关联项目。
- 在 workspace 配置中编辑 worktree root、关联项目、项目角色、默认分支和验证命令。
- 检查项目健康状态，识别路径缺失、非 Git repo 和可用 Git repo。
- 使用本地 SQLite 保存结构化状态，并从旧 `.repohelm/state.json` 自动迁移。
- 将知识库条目写入文件系统 Markdown。
- 创建 Quest 并流式生成轻量 Spec。
- 创建 Quest 时读取相关 workspace / repo 知识。
- 用「确定性状态机 + lead agent 动态决策」编排多 sub-agent：先生成可审批的编排计划，再按依赖顺序委派执行，lead agent 动态 retry/reassign/revise，单步有硬上限保证终止。
- worker 进入 run/observe/fix 反馈闭环，配套 allowlist 门控的 `run_command`（按命令模板校验）、外科手术 `edit_file` 和 worktree 受限代码搜索。
- 解析外部 CLI 的流式与结构化输出（含 Codex `exec --json`），接入 Quest 时间线。
- 创建真实 Git worktree。
- 清理、重试和交付 Quest worktree。
- 运行交付前验证命令、按项目 commit，并生成 PR handoff。
- 使用 Capability Agent 推荐 skills、agents 和 MCP manifest。
- 使用本地安全策略控制命令 allowlist、文件/network scope、secrets 策略和 sandbox runtime。
- 查看产品 readiness、workspace 模板方向、多项目依赖地图和治理状态。
- 通过「执行模式」配置本机 CLI（探测版本、按 CLI 选模型、连通性测试）或 BYOK provider（OpenAI-compatible，实时拉取模型列表）。
- 通过环境变量配置 Codex CLI、Claude Code、OpenCode 等外部 CLI backend，并在 worktree 中真实执行。
- 维护 repo-bound Repo Wiki 知识库（每个 Project 6 篇结构化 wiki 页 + 向量检索），支持全量 bootstrap、增量更新和语义搜索。
- 将 Quest memory 写回知识库。
- 展示 Agent 时间线、worktree 状态、验证结果、Review 记录、Knowledge memory、知识搜索、变更文件和 diff review。
- 展示 Capability 推荐、来源、权限声明和确认状态。
- 展示安全执行策略和 audit log。
- 展示 M4-M8 产品 readiness、模板和 dependency map。

核心路线见：[MILESTONES.md](MILESTONES.md)。

## 开发主干

新增 feature/fix 默认先写清「现状 / 目标 / 验收标准」，再沿着 `harness 工具 -> 动态委派执行 -> 测试先行验证` 的主干交付：能复用的能力先复用，需要执行的命令走权限和审计边界，复杂任务由 entry agent 运行时委派合适 worker，交付前记录最小相关测试或验证命令。

## 启动

```bash
pnpm install
pnpm dev
```

启动后访问：

```text
http://localhost:5173/
```

API 默认运行在：

```text
http://localhost:4300/
```

## 常用命令

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm test:all
```

## Agent Backend 配置

RepoHelm 默认使用内置 mock backend。要接入真实 backend，可以在启动服务前配置：

```bash
REPOHELM_CODEX_COMMAND="your-codex-command"
REPOHELM_CLAUDE_COMMAND="claude ..."
REPOHELM_OPENCODE_COMMAND="opencode ..."
REPOHELM_OPENAI_BASE_URL="https://api.example.com/v1"
REPOHELM_OPENAI_MODEL="qwen-or-deepseek-model"
REPOHELM_OPENAI_API_KEY="..."
REPOHELM_ENABLE_GH_PR="1"
```

外部 CLI 会在 Quest worktree 中执行，并通过 `REPOHELM_AGENT_INPUT` 读取标准化输入 JSON。RepoHelm 会采集 stdout、stderr、退出状态、diff 和 artifact 事件。
交付阶段默认生成 PR handoff；如果启用 `REPOHELM_ENABLE_GH_PR=1` 且本机 `gh` 已认证，会尝试创建 PR。

## 测试

- `pnpm test`：运行核心领域逻辑测试，覆盖 workspace bootstrap、SQLite 迁移、知识文件写入、Quest 创建、Capability 推荐、安全策略、真实 worktree 创建、mock/CLI Agent 写入、diff 读取、worktree 清理、重试、交付 commit 和产品 readiness。
- `pnpm test:e2e`：运行 Playwright 浏览器测试，覆盖从 UI 创建 Quest、生成 Spec、确认 Capability 推荐、运行 Quest、搜索 knowledge、展示 worktree/review/diff、交付、清理、安全审计、产品 readiness 和 CLI backend 的主流程。
- `pnpm test:all`：依次运行类型检查、单元测试和 e2e 测试。

e2e 测试会使用 `.repohelm/e2e` 作为独立运行状态目录，不会复用本地开发状态。

## 当前实现边界

- Agent Backend 已经抽象出来，并提供 mock、Codex CLI、Claude Code、OpenCode、OpenAI-compatible provider，均已接入真实执行路径。
- Codex CLI、Claude Code、OpenCode backend 已支持通过环境变量配置真实外部 CLI 执行协议，并解析其流式 / 结构化输出。
- 模型接入支持本机 CLI 探测与 BYOK provider（OpenAI-compatible，实时拉取模型列表）；ModelKit 统一解析 baseUrl/model/apiKey。
- Capability Agent 目前只做内置 manifest 推荐，不会自动安装第三方能力。
- 安全策略目前是本地 state 中的 allowlist 和审计模型，sandbox runtime 默认仍是 local。
- 产品 readiness 是本地产品化状态页；桌面壳、standalone binary、团队同步和扩展市场仍是后续方向。
- Worktree 已接入真实 `git worktree add`、清理、重试、交付前验证、commit 和 PR handoff。
- 状态存储默认使用 `.repohelm/state.sqlite`。如果检测到旧 `.repohelm/state.json`，会迁移到 SQLite。
- 知识库为 repo-bound Repo Wiki：默认写入 `.repohelm/knowledge`，Markdown 为唯一真相，配套 chunk embeddings 向量检索（页面与向量存于同一 SQLite，WAL）。

完整方向见：[架构文档](docs/architecture.md)。

参与贡献前请阅读：[CONTRIBUTING.md](CONTRIBUTING.md)。
