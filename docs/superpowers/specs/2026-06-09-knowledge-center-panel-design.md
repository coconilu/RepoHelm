# 知识中心:从模态框改为三栏全页视图

日期:2026-06-09
状态:已确认设计,待实现

## 背景与目标

当前知识库管理是一个模态框 `KnowledgeDialog`(`apps/web/src/App.tsx:3065`):一个仓库下拉框 + 同步按钮 + 6 个 wiki 页面以纯文本 `<pre>` 平铺展示。

目标:参照 Qoder RepoWiki 的形态,把它改造成**三栏全页视图** —— 左侧保留 Quests 导航,中间是仓库/页面导航树(含「Repo Wiki」「记忆」两个 tab),右侧把 wiki 页面渲染成 Markdown(含 mermaid 图),带提交信息头部、整仓库「重新生成」按钮、预览/代码切换。

## 范围

**做:**
- 三栏全页布局(替换模态框)。
- 右侧 Markdown + mermaid 渲染、预览/代码切换。
- 中间「Repo Wiki」树 + 「记忆」列表两个 tab。
- 复用现有 6 页数据模型与同步逻辑。

**不做(刻意砍掉,符合「布局+渲染」范围):**
- 多标签同时打开文档 —— 右侧一次只显示一个页面。
- 比真实 6 页更深的嵌套树 —— 后端每仓库只生成 6 个扁平页面。
- 单页重新生成 —— 重新生成是整仓库级(后端限制)。

**不动:** 后端、`apps/server`、`packages/core`,以及 `apps/web/src/api.ts` 的函数签名。复用 `getProjectKnowledge`、`syncProjectKnowledge`、`searchKnowledge`。

## 渲染栈

选定 **A**:`react-markdown` + `remark-gfm` + `mermaid`。
- `react-markdown` + `remark-gfm`:渲染 Markdown,支持 GFM 表格/列表/任务列表。
- `mermaid`:拦截 ` ```mermaid ` 代码围栏渲染成图。

(备选 B 自写迷你渲染器 / C `marked`+`dangerouslySetInnerHTML` 均放弃:B 脆弱,C 有 HTML 注入风险且与 React 契合差。)

新增依赖加入 `apps/web/package.json`。

## 架构

### 进入 / 退出
- 在 `App` 中新增 `knowledgeCenterOpen` 状态(替换现有的 `knowledgeOpen` 模态布尔)。
- 开启时,`.quest-workbench` 区域渲染:**`Sidebar`(不变)→ 左侧 resize handle → `KnowledgeCenter`**,顶替掉 `QuestStage + resize + Inspector`。
- 页脚「知识中心」按钮(`Sidebar` 的 `onKnowledgeOpen`)开启该模式。
- 退出:点击任意 Quest / Workspace 时把 `knowledgeCenterOpen` 置 false 切回 Quest 模式;同时在 `KnowledgeCenter` 顶部提供一个返回/关闭入口。
- 删除 `KnowledgeDialog` 组件及其在第 718–723 行的挂载。

### 组件结构(均在 `apps/web/src/App.tsx`,或视体量拆到同目录新文件)
- `KnowledgeCenter` —— 顶层容器,占据中+右区域,内部自分「导航子面板 | 内容子面板」两栏。
  持有状态:`activeTab`(`"wiki" | "memory"`)、`selectedProjectId`、`selectedSlug`、`selectedMemoryId`、`mode`(`"preview" | "code"`)、各项 loading/syncing。
  - `KnowledgeNav`(中间导航面板):tab 切换 + 搜索框 + 树/列表。
    - Repo Wiki:顶层列出所有已注册仓库(来源同现有下拉框 = `projects`);每个仓库可展开为 6 个页面标题。搜索框对仓库名/页面标题做前端过滤。
    - 记忆:`KnowledgeItem` 列表(workspace 级),走 `api.searchKnowledge`;点条目右侧展示。
  - `WikiPageView`(右侧内容面板,wiki 模式):
    - 头部:仓库名 + 分支(`view.knowledgeBranch`)、「更新于 {lastIndexedAt} · Commit ID {head/lastIndexedSha}」、**重新生成** 按钮、**预览/代码** 切换图标。
    - `pendingCommits > 0` 时,重新生成按钮文案提示「有 N 个新提交」(复用 `getSyncLabel` 逻辑)。
    - 正文:预览模式 → `MarkdownView`;代码模式 → 原始 Markdown(`<pre>`/代码块)。
  - `MemoryItemView`(右侧内容面板,记忆模式):展示选中 `KnowledgeItem` 的 title/body/tags/来源。
- `MarkdownView` —— 封装 `react-markdown` + `remark-gfm`;通过自定义 `code` 渲染器,识别 `language-mermaid` 交给 `MermaidDiagram`,其余代码块正常高亮/等宽显示。
- `MermaidDiagram` —— 用 `mermaid` API 把代码渲染为 SVG;按主题(dark/light)初始化;渲染失败时降级显示原始代码 + 错误提示。

### 数据流
- `KnowledgeCenter` 挂载或切换 `selectedProjectId` 时调用 `api.getProjectKnowledge(projectId)` 拿 `ProjectKnowledgeView`(含 6 个 `pages`、`knowledgeBranch`、`status`、`pendingCommits`、`head`、`lastIndexedSha`、`lastIndexedAt`、`error`)。
- 「重新生成」→ `api.syncProjectKnowledge(projectId)`,返回新的 view 覆盖。
- 记忆 tab 搜索 → `api.searchKnowledge(workspaceId, query)`。
- 选中页面由 `selectedSlug` 在 `view.pages` 里查 body 渲染。

## 样式
- token 驱动的 CSS 写进 `apps/web/src/styles.css`(必要时 `theme.css` 加 token),新增 `.knowledge-center*` 系列类。
- 不硬编码颜色,沿用现有 Linear 风格深色默认设计系统。
- mermaid 主题随应用 `theme`(dark/light)切换。

## 错误与边界
- 无已注册仓库:中间面板提示「请先在全局设置里绑定仓库」。
- `view.error` 存在:右侧内容区显示错误条。
- 仓库尚无知识库内容(`pages` 为空 / `status==="empty"`):右侧提示并引导点击「重新生成」建立。
- mermaid 渲染异常:降级为原始代码块,不让整页崩溃。
- 未配置 embedding ModelKit:记忆/检索走关键词回退(后端既有行为,前端无需特殊处理)。

## 测试
- 单元:`MermaidDiagram`、`MarkdownView`(mermaid 围栏识别、降级)若可在 jsdom 下测则补;否则以 e2e 覆盖。
- e2e(Playwright,`REPOHELM_FAKE_MODELS=1`):
  - 点页脚「知识中心」→ 主区切换为三栏知识中心,Quests 导航仍在。
  - 选仓库 → 中间树展开 6 页;点页面 → 右侧渲染。
  - 预览/代码切换生效。
  - 点 Quest → 退出知识中心回到 Quest 模式。
  - 记忆 tab 列表展示。

## 不在本次范围
后端结构、嵌套页面树、多标签、单页重新生成。
