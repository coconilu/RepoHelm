# RepoHelm

RepoHelm 是一个开源的 Quest 工作区原型，用来验证“虚拟 workspace + 多项目 Quest + Spec 驱动 + worktree 隔离 + Agent 编排 + 知识库”的产品方向。

当前版本是 MVP 骨架，不是完整实现。它已经可以：

- 启动本地 Web UI 和 API。
- 自动创建 demo workspace。
- 将当前 RepoHelm 仓库作为一个关联项目。
- 创建 Quest 并生成轻量 Spec。
- 运行 mock Quest 闭环。
- 展示 Agent 时间线、worktree 计划、验证结果、Review 记录、Knowledge memory 和变更文件。

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
```

## 当前实现边界

- Worktree 目前只生成计划，不自动执行 `git worktree add`。
- Agent 目前是 mock runtime，用来验证 Quest 体验和状态流转。
- 状态存储暂时使用 `.repohelm/state.json`，后续会替换为 SQLite + 文件系统知识库。
- 模型 provider、Codex CLI、Claude Code、OpenCode backend adapter 还未接入。

完整方向见：[架构文档](docs/architecture.md)。
