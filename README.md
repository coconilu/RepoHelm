# RepoHelm

RepoHelm 是一个开源的 Quest 工作区原型，用来验证“虚拟 workspace + 多项目 Quest + Spec 驱动 + worktree 隔离 + Agent 编排 + 知识库”的产品方向。

当前版本是 MVP 骨架，不是完整实现。它已经可以：

- 启动本地 Web UI 和 API。
- 自动创建 demo workspace。
- 将当前 RepoHelm 仓库作为一个关联项目。
- 在 workspace 配置中编辑 worktree root、关联项目、项目角色、默认分支和验证命令。
- 检查项目健康状态，识别路径缺失、非 Git repo 和可用 Git repo。
- 创建 Quest 并生成轻量 Spec。
- 运行 Quest 闭环。
- 创建真实 Git worktree。
- 选择 Agent Backend。
- 由 mock Implementation Agent 在 worktree 中写入真实文件变更。
- 展示 Agent 时间线、worktree 状态、验证结果、Review 记录、Knowledge memory、变更文件和 diff review。

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

## 测试

- `pnpm test`：运行核心领域逻辑测试，覆盖 workspace bootstrap、Quest 创建、真实 worktree 创建、mock Agent 写入和 diff 读取。
- `pnpm test:e2e`：运行 Playwright 浏览器测试，覆盖从 UI 创建 Quest、生成 Spec、运行 Quest、展示 worktree/review/knowledge/diff 的主流程。
- `pnpm test:all`：依次运行类型检查、单元测试和 e2e 测试。

e2e 测试会使用 `.repohelm/e2e` 作为独立运行状态目录，不会复用本地开发状态。

## 当前实现边界

- Agent 目前是 mock runtime，用来验证 Quest 体验、状态流转和 diff review。
- Agent Backend 已经抽象出来，并提供 mock、Codex CLI、Claude Code、OpenCode 的检测入口。
- Codex CLI、Claude Code、OpenCode backend 目前只做本机命令检测和配置提示，还没有启用真实外部 CLI 执行协议。
- Worktree 已接入真实 `git worktree add`，但还没有完整的清理、重试、commit 和 PR 流程。
- 状态存储暂时使用 `.repohelm/state.json`，已支持 workspace/project 配置，后续会替换为 SQLite + 文件系统知识库。
- 模型 provider、Codex CLI、Claude Code、OpenCode backend adapter 还未接入。

完整方向见：[架构文档](docs/architecture.md)。
