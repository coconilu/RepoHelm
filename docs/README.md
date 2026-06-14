# RepoHelm 文档索引

这是 RepoHelm 全部文档的统一入口。文档分为：产品方向、里程碑与计划、开发指南、设计专题、研究归档。
新增、移动或删除文档时，请同步更新本索引（见各开发指南中的「文档防漂移」约定）。

## 产品方向

| 文档 | 说明 |
| --- | --- |
| [`../README.md`](../README.md) | 项目入口：RepoHelm 是什么、当前能力清单、启动与测试、实现边界。 |
| [`architecture.md`](architecture.md) | 产品方向、核心概念、边界与非目标、MVP 与完整形态（中文，长期设计依据）。 |

## 里程碑与计划

| 文档 | 说明 |
| --- | --- |
| [`../MILESTONES.md`](../MILESTONES.md) | 里程碑状态：M0–M9 哪些 Done / Partial / Planned / Later，以及当前焦点。 |
| [`../TODO.md`](../TODO.md) | 开源项目健康事项：CI、贡献指南、安全文档、issue 模板等。 |

## 开发指南

| 文档 | 说明 |
| --- | --- |
| [`../CLAUDE.md`](../CLAUDE.md) | 面向 Claude Code 的完整开发指南：`RepoHelmService` 主轴、编排器、引擎配置、REST/Web 分层、子 agent 模型选型、命令与约定。 |
| [`../AGENTS.md`](../AGENTS.md) | 面向 AI agent 的精简向导：monorepo 结构、构建顺序、命令、E2E 注意事项、高层架构（CLAUDE.md 的伴随简版）。 |

## 设计专题

| 文档 | 说明 | 状态 |
| --- | --- | --- |
| [`model-config-plan.md`](model-config-plan.md) | 模型接入升级方案（本机 CLI + BYOK 执行模式面板的引擎配置与持久化）。 | 已实现 |
| [`../MODEL_FETCHING.md`](../MODEL_FETCHING.md) | 真实模型列表获取方案（BYOK REST `/models` 实时拉取 + CLI provider 映射），承接上一篇。 | 已实现 |
| [`ui-layout.md`](ui-layout.md) | 三栏 Quest 工作台 UI 布局设计稿（对应里程碑 M1.5）。 | 已实现（历史稿） |

## 研究归档

历史调研与测试记录，仅供回溯，不代表当前实现。

| 文档 | 说明 |
| --- | --- |
| [`research/opencode-subagent-research.md`](research/opencode-subagent-research.md) | Opencode sub-agent 架构深度调研报告。 |
| [`archive/MODELKIT_TEST_SUMMARY.md`](archive/MODELKIT_TEST_SUMMARY.md) | ModelKit 测试实施总结（过程记录）。 |
| [`archive/MODELKIT_TESTS.md`](archive/MODELKIT_TESTS.md) | ModelKit 功能测试说明（过程记录）。 |
