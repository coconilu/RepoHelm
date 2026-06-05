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

- 左侧负责 workspace 树、request 列表和知识中心入口。
- 中间负责和 Agent 对话，用户把 request 交给 Agent。
- 右侧负责 Agent 判断后生成的 Spec、进展、产物、文件、Diff 和日志。
- 减少大面积卡片堆叠，增强“正在处理一个任务”的专注感。

## 2. 信息架构

```text
RepoHelm App
  ├─ Top Toolbar
  │   ├─ Product / Workspace
  │   ├─ Backend status
  │   └─ Run / Review actions
  ├─ Left Sidebar
  │   ├─ New Request
  │   ├─ Workspace tree
  │   │   ├─ Workspace config menu
  │   │   └─ Requests
  │   └─ Knowledge entry opens modal
  ├─ Center Agent Chat
  │   ├─ Request conversation
  │   ├─ Agent events as messages
  │   └─ Message composer with tools
  └─ Right Inspector
      ├─ Spec
      ├─ Overview
      ├─ Files
      ├─ Diff
      └─ Logs
```

## 3. 空状态

当没有 Quest 或用户正在创建 Quest 时，中间区域应该专注展示 Agent chat 和 composer。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ RepoHelm                                      Backend: Mock ▾     Settings  │
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│ + New Request │                                      │  Spec                 │
│               │                                      │ ───────────────────── │
│ Workspaces    │          Agent Chat                   │  Agent decides if     │
│ ▾ RepoHelm ⋯  │                                      │  Spec is needed       │
│               │   Workspace: RepoHelm ▾              │                       │
│               │   Backend: Mock ▾                    │  Artifacts            │
│               │                                      │  No artifacts         │
│               │                                      │                       │
│ Requests      │ ┌──────────────────────────────────┐ │  References           │
│ No Request    │ │ Tell Agent what to do...          │ │  No references        │
│               │ │ @context / command / requirement  │ │                       │
│               │ │                                  ↑│ │                       │
│ Knowledge     │ └──────────────────────────────────┘ │                       │
│               │                                      │                       │
└───────────────┴──────────────────────────────────────┴───────────────────────┘
```

## 4. Quest 已创建

Quest 创建后，中间区域进入 Agent 会话。Spec 不固定占据中间主区域，而是由 Agent 判断是否创建，并在右侧 Inspector 中展示。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ RepoHelm                                      Run Quest ▶       Backend: Mock│
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│ + New Request │ Agent Chat                            │  Spec                 │
│               │ Status: Planning                      │ ───────────────────── │
│ Workspaces    │                                      │  Goal                 │
│ ▾ RepoHelm ⋯  │ User: Add diff review                │  Requirements         │
│   ● Add diff  │ Agent: Spec created on the right     │  Acceptance           │
│   ○ Fix tests │ Agent: Worktree can be prepared      │                       │
│               │                                      │  Worktrees            │
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
│ Spec | Overview | Files | Diff │
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

- Spec：Agent 判断后生成的目标、需求和验收标准。
- Overview：进度、backend、worktree、validation、review 摘要。
- Files：按项目展示 changed files。
- Diff：展示选中文件 diff。
- Logs：展示 Agent timeline。

## 7. 视觉规则

- 页面整体使用浅色工作台风格。
- 桌面 App 形态下，整体高度限制为 `100vh`。
- 顶部 toolbar 轻量，不使用大块深色 hero。
- 左侧 sidebar 固定宽度，承担导航。
- 左侧 workspace 是顶级列表，展开后显示 request；workspace 右侧三点进入配置弹窗。
- 中间 stage 是 Agent 会话，不放 Spec 正文。
- Composer 不展示单独标题输入框；request 标题由首行内容自动派生。
- Composer 底部只放工具栏：智能体选择、执行模式、上下文清单、智能增强、发送。
- 顶部或全局区域展示真实 backend 状态，composer 中使用短标签避免拥挤。
- 右侧 inspector 固定宽度，承担审查。
- Spec 放在右侧 inspector，由 Agent 自行判断是否创建。
- 知识中心放在左下角，点击后使用弹窗展示。
- 左侧 sidebar、中间 stage、右侧 inspector 应各自独立滚动，不让整个页面滚动。
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
- 中间主区域改为 Agent Chat。
- Spec 从中间移动到右侧 Inspector。
- Composer 参考 Agent 输入框形态，不使用表单式标题/模型字段。
- Workspace 配置和知识中心使用弹窗承载。
- 桌面工作台使用固定 `100vh` 高度，三栏独立滚动。

不做：

- Commit / PR 真实交付。
- IDE editor。
- 外部 Agent CLI 真执行。
- 多 tab 路由持久化。
