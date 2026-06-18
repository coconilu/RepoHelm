# RepoHelm 贡献指南

RepoHelm 是一个开源的 Quest 工作区原型，用来验证 Spec 驱动、过程可审计、worktree 隔离和 Agent 编排的软件研发任务流。欢迎贡献能加强这个方向的改进。

## 开始之前

建议先阅读：

- [README.md](README.md)
- [docs/architecture.md](docs/architecture.md)
- [TODO.md](TODO.md)
- [AGENTS.md](AGENTS.md)

## 本地开发

环境要求：

- 与仓库工具链兼容的 Node.js。
- `pnpm@10.33.4`。
- Git。

安装并启动：

```bash
pnpm install
pnpm dev
```

API 默认运行在 `http://localhost:4300/`。Web UI 默认运行在 `http://localhost:5173/`。

## 常用命令

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm test:all
```

`@repohelm/core` 必须先于 server 和 web 的包级命令构建。根目录脚本已经自动处理这个顺序；如果手动跑 package 命令，先执行：

```bash
pnpm --filter @repohelm/core build
```

## 复用优先 Feature 流程

RepoHelm 的工程默认策略是先复用，再封装，最后才自建。一个 feature 如果需要新的能力，不应该直接进入自定义实现。

标准流程：

1. 定义能力缺口。
2. 调研成熟社区方案：开源库、组件库、skills、MCP servers、CLI、协议或现成服务。
3. 评估契合度、维护活跃度、许可证、安全和权限面、集成成本、长期维护成本。
4. 决定复用、封装或自建。
5. 在 issue 中记录结论；对长期架构有影响的结论，还应沉淀到 Repo Wiki 的 `decisions` 页或 [docs/architecture.md](docs/architecture.md)。

只有在社区方案契合度低、维护停滞、许可证不兼容、存在不可接受的安全风险，或该能力属于 RepoHelm 的核心护城河时，才优先自建。RepoHelm 的核心护城河是编排、治理、worktree 隔离、过程审计和知识沉淀。

第一个已走通案例是 Agent 执行层。RepoHelm 需要 coding-agent 执行能力时，选择通过 adapter 复用 Codex CLI、Claude Code 和 OpenCode，而不是自建新的 agent 内核；RepoHelm 自己负责这些工具之上的编排和治理层。

## Issue 要求

新 feature 或新能力请使用 feature request 模板。非平凡 feature 必须填写 `社区方案调研` 和 `选型结论`。

小 bug、文档修正或普通依赖维护不需要完整能力调研；但如果变更引入新的工具、服务、runtime 或架构依赖，仍然需要走复用优先流程。

## Pull Request 流程

提交 PR 前：

1. 保持变更聚焦于一个问题。
2. 行为变化需要补充测试。
3. 产品行为、架构或贡献流程变化需要同步更新文档。
4. 先运行最小相关验证命令；影响面较大时运行 `pnpm test:all`。
5. 关联 issue；如果引入新能力或新依赖，摘要中说明复用选型结论。

提交信息使用简洁祈使句，不加 scope 前缀，例如：

```text
Add feature request template
Fix worktree cleanup
Update architecture guidance
```

## 当前欢迎的贡献方向

- Quest 工作流体验。
- Spec、验证、Review 和交付关卡。
- Worktree 隔离和安全执行。
- 知识沉淀和 Repo Wiki 质量。
- Agent 编排和能力治理。
- 测试、fixture、文档和贡献者体验。

## 当前非目标

除非新的架构决策改变方向，否则 RepoHelm 不做通用代码编辑器、IDE 插件或 inline completion 产品。
