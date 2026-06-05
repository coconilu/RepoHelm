# RepoHelm

RepoHelm 是一个开源的 Quest 工作区原型，用来验证“虚拟 workspace + 多项目 Quest + Spec 驱动 + worktree 隔离 + Agent 编排 + 知识库”的产品方向。

当前版本是 MVP 骨架，不是完整实现。它已经可以：

- 启动本地 Web UI 和 API。
- 自动创建 demo workspace。
- 将当前 RepoHelm 仓库作为一个关联项目。
- 在 workspace 配置中编辑 worktree root、关联项目、项目角色、默认分支和验证命令。
- 检查项目健康状态，识别路径缺失、非 Git repo 和可用 Git repo。
- 使用本地 SQLite 保存结构化状态，并从旧 `.repohelm/state.json` 自动迁移。
- 将知识库条目写入文件系统 Markdown。
- 创建 Quest 并生成轻量 Spec。
- 创建 Quest 时读取相关 workspace knowledge。
- 运行 Quest 闭环。
- 创建真实 Git worktree。
- 选择 Agent Backend。
- 通过环境变量配置 Codex CLI、Claude Code、OpenCode 等外部 CLI backend，并在 worktree 中真实执行。
- 配置 OpenAI-compatible provider，用于 Qwen、DeepSeek 等兼容接口。
- 由 mock Implementation Agent 在 worktree 中写入真实文件变更。
- 将 Quest memory 写回知识库。
- 展示 Agent 时间线、worktree 状态、验证结果、Review 记录、Knowledge memory、知识搜索、变更文件和 diff review。

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
```

外部 CLI 会在 Quest worktree 中执行，并通过 `REPOHELM_AGENT_INPUT` 读取标准化输入 JSON。RepoHelm 会采集 stdout、stderr、退出状态、diff 和 artifact 事件。

## 测试

- `pnpm test`：运行核心领域逻辑测试，覆盖 workspace bootstrap、SQLite 迁移、知识文件写入、Quest 创建、真实 worktree 创建、mock Agent 写入和 diff 读取。
- `pnpm test:e2e`：运行 Playwright 浏览器测试，覆盖从 UI 创建 Quest、生成 Spec、运行 Quest、搜索 knowledge、展示 worktree/review/diff 的主流程。
- `pnpm test:all`：依次运行类型检查、单元测试和 e2e 测试。

e2e 测试会使用 `.repohelm/e2e` 作为独立运行状态目录，不会复用本地开发状态。

## 当前实现边界

- Agent Backend 已经抽象出来，并提供 mock、Codex CLI、Claude Code、OpenCode、OpenAI-compatible provider。
- Codex CLI、Claude Code、OpenCode backend 已支持通过环境变量配置真实外部 CLI 执行协议。
- Worktree 已接入真实 `git worktree add`，但还没有完整的清理、重试、commit 和 PR 流程。
- 状态存储默认使用 `.repohelm/state.sqlite`。如果检测到旧 `.repohelm/state.json`，会迁移到 SQLite。
- 知识库文件默认写入 `.repohelm/knowledge`，当前采用 Markdown 文件 + SQLite metadata 的第一版方案。
- 模型 provider、Codex CLI、Claude Code、OpenCode backend adapter 还未接入。

完整方向见：[架构文档](docs/architecture.md)。
