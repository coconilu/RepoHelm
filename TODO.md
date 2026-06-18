# RepoHelm 开源项目建设 TODO

本文档记录 RepoHelm 需要借鉴的优秀开源项目亮点，并将它们整理成可执行 TODO。

## P0：尽快补齐

- [ ] 升级 README 第一屏
  - [ ] 用一句话讲清楚 RepoHelm 是什么。
  - [ ] 说明 RepoHelm 不做 Editor、不做 IDE 插件、不做 inline completion。
  - [ ] 补一张截图或 GIF，展示 Quest 工作区。
  - [ ] 增加 5 分钟 Quickstart。
  - [ ] 明确当前 MVP 能力和实现边界。
  - [ ] 链接架构文档、测试说明和 roadmap。

- [ ] 增加 GitHub Actions CI
  - [ ] 使用 pnpm 安装依赖。
  - [ ] 运行 `pnpm typecheck`。
  - [ ] 运行 `pnpm test`。
  - [ ] 运行 `pnpm test:e2e`。
  - [ ] 运行 `pnpm build`。
  - [ ] 缓存 pnpm store。
  - [ ] 设置最小 GitHub token 权限。

- [x] 增加 `CONTRIBUTING.md`
  - [x] 写清本地开发环境要求。
  - [x] 写清如何安装、启动、测试和构建。
  - [x] 写清 PR 提交流程。
  - [x] 写清推荐先阅读的文档。
  - [x] 写清哪些贡献类型当前最欢迎。
  - [x] 写清哪些方向不在项目范围内。

- [ ] 增加 `SECURITY.md`
  - [ ] 写清漏洞报告方式。
  - [ ] 写清 Agent、shell command、worktree、MCP、skills 的安全边界。
  - [ ] 写清默认不自动执行下载能力。
  - [ ] 写清敏感信息和 API key 的处理原则。
  - [ ] 写清安全问题响应预期。

- [ ] 增加初版威胁模型文档
  - [ ] 说明 RepoHelm 的主要安全风险。
  - [ ] 覆盖命令执行风险。
  - [ ] 覆盖 MCP server 风险。
  - [ ] 覆盖从网络导入 skills/agents 的供应链风险。
  - [ ] 覆盖 worktree 和本地文件访问风险。
  - [ ] 记录 MVP 阶段已做和未做的安全控制。

## P1：MVP 稳定后补齐

- [ ] 增加 `ROADMAP.md`
  - [ ] 记录 MVP 阶段目标。
  - [ ] 记录真实 worktree 执行阶段。
  - [ ] 记录 SQLite + 文件系统知识库阶段。
  - [ ] 记录模型 provider adapter 阶段。
  - [ ] 记录 Codex CLI、Claude Code、OpenCode backend adapter 阶段。
  - [ ] 记录 Capability Agent 阶段。
  - [ ] 记录 MCP、skills、agents 可信扩展阶段。

- [ ] 建立 `docs/adr/`
  - [ ] 为重大技术决策创建 ADR 模板。
  - [ ] 记录为什么选择 pnpm。
  - [ ] 记录为什么先使用本地 Web UI 而不是桌面壳。
  - [ ] 记录为什么先用 JSON state，后续再切 SQLite。
  - [ ] 记录模型 provider 和 agent backend 分层设计。

- [ ] 增加 `examples/`
  - [ ] `examples/workspaces/single-repo.workspace.yaml`
  - [ ] `examples/workspaces/multi-project.workspace.yaml`
  - [ ] `examples/quests/add-feature.quest.md`
  - [ ] `examples/quests/fix-ci.quest.md`
  - [ ] `examples/agents/spec-agent.yaml`
  - [ ] `examples/agents/review-agent.yaml`
  - [ ] `examples/capabilities/README.md`

- [ ] 增加 GitHub issue templates
  - [x] Bug report。
  - [x] Feature request。
  - [ ] Provider integration proposal。
  - [ ] Agent backend integration proposal。
  - [ ] MCP/skill proposal。

- [x] 增加 PR template
  - [x] 变更摘要。
  - [x] 关联 issue。
  - [x] 测试结果。
  - [x] 安全影响。
  - [x] 文档影响。
  - [x] 现状 / 目标 / 验收标准。

- [ ] 建立标签体系
  - [ ] `good first issue`
  - [ ] `help wanted`
  - [ ] `area:workspace`
  - [ ] `area:quest`
  - [ ] `area:agent`
  - [ ] `area:knowledge`
  - [ ] `area:provider`
  - [ ] `area:security`

## P2：有早期用户后推进

- [ ] 增加 `GOVERNANCE.md`
  - [ ] 说明 maintainer 角色。
  - [ ] 说明决策流程。
  - [ ] 说明 roadmap 如何调整。
  - [ ] 说明重大架构变化如何通过 ADR 记录。

- [ ] 建立文档站点
  - [ ] 评估 VitePress 或 Docusaurus。
  - [ ] 将架构文档、Quickstart、Roadmap、Security、Examples 整理成站点。
  - [ ] 增加截图和任务流说明。

- [ ] 对齐 OpenSSF Scorecard
  - [ ] 检查 security policy。
  - [ ] 检查 CI。
  - [ ] 检查 token permissions。
  - [ ] 检查 dependency update。
  - [ ] 检查 branch protection。
  - [ ] 检查 SAST。

- [ ] 增加依赖和安全自动化
  - [ ] Dependabot 或 Renovate。
  - [ ] CodeQL。
  - [ ] secret scanning 说明。
  - [ ] npm/pnpm audit 策略。

- [ ] 建立贡献者体验
  - [ ] 标记适合新贡献者的 issue。
  - [ ] 增加本地开发常见问题。
  - [ ] 增加架构导览。
  - [ ] 增加测试数据和 demo workspace。

## 长期亮点方向

- [ ] 让项目“可看懂”
  - [ ] README 清楚。
  - [ ] 架构清楚。
  - [ ] Roadmap 清楚。
  - [ ] 决策记录清楚。

- [ ] 让项目“可运行”
  - [ ] 一条命令启动。
  - [ ] 一条命令测试。
  - [ ] 稳定 demo workspace。
  - [ ] 可复制 examples。

- [ ] 让项目“可审计”
  - [ ] Agent event log。
  - [ ] Tool permission log。
  - [ ] Worktree diff review。
  - [ ] 安全边界文档。

- [ ] 让项目“可扩展”
  - [ ] Provider adapter。
  - [ ] Agent backend adapter。
  - [ ] Skills manifest。
  - [ ] Agents manifest。
  - [ ] MCP manifest。

- [ ] 让项目“可信任”
  - [ ] CI。
  - [ ] 测试。
  - [ ] 安全策略。
  - [ ] 威胁模型。
  - [ ] 清晰治理。
