# RepoHelm UI Layout Proposal

状态：草案  
最后更新：2026-06-05

## 1. 目标

RepoHelm 的 UI 应该像一个任务工作台，而不是卡片堆叠的仪表盘。

本次重构参考 Qoder Quest 工作区的方向，但保持 RepoHelm 自己的产品边界：

- 不做 Editor。
- 不做插件式 IDE。
- 只围绕 Workspace、Quest、Spec、Worktree、Agent Backend、Diff Review、Knowledge 展开。

核心目标：

- 左侧负责导航和任务选择。
- 中间负责 Quest 创建、Spec、执行主流程。
- 右侧负责检查、产物、文件、Diff、知识和日志。
- 减少大面积卡片堆叠，增强“正在处理一个任务”的专注感。

## 2. 信息架构

```text
RepoHelm App
  ├─ Top Toolbar
  │   ├─ Product / Workspace
  │   ├─ Backend status
  │   └─ Run / Review actions
  ├─ Left Sidebar
  │   ├─ New Quest
  │   ├─ Workspace
  │   ├─ Projects
  │   ├─ Quests
  │   └─ Knowledge entry
  ├─ Center Quest Stage
  │   ├─ Empty composer
  │   ├─ Quest header
  │   ├─ Spec
  │   ├─ Execution timeline
  │   └─ Worktree summary
  └─ Right Inspector
      ├─ Overview
      ├─ Files
      ├─ Diff
      ├─ Knowledge
      └─ Logs
```

## 3. 空状态

当没有 Quest 或用户正在创建 Quest 时，中间区域应该专注展示 composer。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ RepoHelm                                      Backend: Mock ▾     Settings  │
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│ + New Quest   │                                      │  Overview             │
│               │                                      │ ───────────────────── │
│ Workspace     │          Quest on, hands off          │  Progress             │
│ RepoHelm      │                                      │  No task running      │
│               │   Workspace: RepoHelm ▾              │                       │
│ Projects      │   Backend: Mock ▾                    │  Artifacts            │
│ └ RepoHelm    │   Branch: main ▾                      │  No artifacts         │
│               │                                      │                       │
│ Quests        │ ┌──────────────────────────────────┐ │  References           │
│ No Quest      │ │ Describe the Quest...             │ │  No references        │
│               │ │ @context / command / requirement  │ │                       │
│               │ │                                  ↑│ │                       │
│ Knowledge     │ └──────────────────────────────────┘ │                       │
│               │                                      │                       │
└───────────────┴──────────────────────────────────────┴───────────────────────┘
```

## 4. Quest 已创建

Quest 创建后，中间区域进入任务视图。Spec 是主要内容，右侧 Inspector 展示摘要。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ RepoHelm                                      Run Quest ▶       Backend: Mock│
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│ + New Quest   │ Quest: Add worktree diff review       │  Overview             │
│               │ Status: Planning                      │ ───────────────────── │
│ Quests        │                                      │  Spec                 │
│ ● Add diff    │ ┌ Spec ─────────────────────────────┐ │  Goal                 │
│ ○ Fix tests   │ │ Goal                              │ │  Acceptance           │
│               │ │ Requirements                      │ │  Open questions       │
│ Projects      │ │ Acceptance Criteria               │ │                       │
│ RepoHelm      │ └───────────────────────────────────┘ │  Worktrees            │
│               │                                      │  Not created          │
│ Knowledge     │ ┌ Execution Plan ───────────────────┐ │                       │
│ Architecture  │ │ 1. Create worktree                │ │  Backend              │
│ Memories      │ │ 2. Run implementation backend     │ │  Mock available       │
│               │ │ 3. Read changed files             │ │                       │
│               │ └───────────────────────────────────┘ │                       │
└───────────────┴──────────────────────────────────────┴───────────────────────┘
```

## 5. Quest 已运行

Quest 运行后，主区域展示进度，右侧进入 Files/Diff 审查。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ RepoHelm                                      Ready to Review    Commit ▾    │
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│ + New Quest   │ Quest: Add worktree diff review       │  Files                │
│               │ Status: Ready                         │ ───────────────────── │
│ Quests        │                                      │  RepoHelm             │
│ ● Add diff    │ Timeline                             │  ● repohelm-output.md │
│ ○ Fix tests   │ ───────────────────────────────────  │                       │
│               │ ✓ Worktree created                   │  Diff                 │
│ Projects      │ ✓ Mock backend started               │ ┌───────────────────┐ │
│ RepoHelm      │ ✓ Implementation artifact written    │ │ + # Quest title    │ │
│               │ ✓ Diff detected                      │ │ + Requirement      │ │
│ Knowledge     │                                      │ │ + Notes            │ │
│ Architecture  │ Worktrees                            │ └───────────────────┘ │
│ Memories      │ ───────────────────────────────────  │                       │
│               │ RepoHelm                             │  Review Notes         │
│               │ branch repohelm/add-diff-xxxx        │  No risk found        │
└───────────────┴──────────────────────────────────────┴───────────────────────┘
```

## 6. Inspector Tabs

右侧 Inspector 使用 tabs，而不是继续堆卡片。

```text
┌──────────────────────────────┐
│ Overview | Files | Diff | Log │
├──────────────────────────────┤
│ Progress                     │
│ ✓ Spec generated             │
│ ✓ Worktree created           │
│ ✓ Backend completed          │
│ ✓ Diff ready                 │
│                              │
│ Artifacts                    │
│ repohelm-quest-output/*.md   │
│                              │
│ References                   │
│ Architecture memory          │
└──────────────────────────────┘
```

推荐 tabs：

- Overview：进度、backend、worktree、validation、review 摘要。
- Files：按项目展示 changed files。
- Diff：展示选中文件 diff。
- Knowledge：展示相关 knowledge memory。
- Logs：展示 Agent timeline。

## 7. 视觉规则

- 页面整体使用浅色工作台风格。
- 顶部 toolbar 轻量，不使用大块深色 hero。
- 左侧 sidebar 固定宽度，承担导航。
- 中间 stage 留白更多，强调当前 Quest。
- 右侧 inspector 固定宽度，承担审查。
- 卡片只用于内部重复项，不作为页面大结构的主要表达。
- 文字密度要适合研发工具：可扫读，但不要营销化。
- Diff 使用深色等宽区域，方便识别代码变更。

## 8. 本轮实现范围

本轮 UI 重构只调整布局和信息呈现，不改变核心 runtime：

- 保留现有 API。
- 保留 Quest 创建流程。
- 保留 Agent Backend 选择。
- 保留 worktree、changed files、diff review 数据。
- 将原来的卡片堆叠改为三栏 Quest 工作台。

不做：

- Commit / PR 真实交付。
- IDE editor。
- 外部 Agent CLI 真执行。
- 多 tab 路由持久化。
