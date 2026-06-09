# 知识中心三栏视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把知识库管理从模态框 `KnowledgeDialog` 改造成占据主内容区的三栏全页「知识中心」视图,右侧用 Markdown + mermaid 渲染 wiki 页面。

**Architecture:** 纯前端改动(`apps/web`)。在 `App` 里把现有 `knowledgeOpen` 布尔从「开模态框」改为「主区切换为知识中心模式」;`.quest-workbench` grid 在该模式下渲染 `Sidebar + 左 resize handle + KnowledgeCenter`(后者用 `grid-column: 3 / 6` 横跨原 stage+inspector 三列)。`KnowledgeCenter` 内部再分「导航面板 | 内容面板」两栏。新增 `MarkdownView`/`MermaidDiagram` 两个渲染组件。复用现有 `api.getProjectKnowledge`/`syncProjectKnowledge`,不动后端与 `api.ts` 签名。

**Tech Stack:** React 19 + Vite 7 + Tailwind 4(token 驱动 CSS)、lucide-react 图标、新增 `react-markdown` + `remark-gfm` + `mermaid`。

---

## 重要约定(实现前必读)

- **本地模块 import 不带 `.js` 扩展名**。`apps/web` 用 Vite bundler 解析,现有代码全是 `from "./api"`、`from "./components/Select"`。CLAUDE.md 里「import 带 `.js`」的规则只针对 `@repohelm/core`(NodeNext),**不适用于 web**。照抄 web 现有风格。
- 样式只用 `theme.css` 里已存在的 CSS 变量(本计划用到的全部已核对存在):`--surface` `--surface-2` `--sidebar` `--border` `--border-strong` `--text` `--text-muted` `--accent` `--accent-soft` `--danger` `--font-mono`。`.spin` 与 `@keyframes spin` 已在 `styles.css` 定义,直接复用。**不要硬编码颜色**。
- 每个任务结束跑 `pnpm --filter @repohelm/web typecheck` 作为快速反馈(web 没有组件单测 runner,功能验证靠最后的 Playwright e2e)。
- 提交风格:祈使句、无 scope 前缀。

## File Structure

- **Create** `apps/web/src/components/MermaidDiagram.tsx` —— 把一段 mermaid 源码渲染成 SVG,失败时降级显示源码。
- **Create** `apps/web/src/components/MarkdownView.tsx` —— react-markdown + remark-gfm 渲染 Markdown,拦截 `language-mermaid` 围栏交给 `MermaidDiagram`。
- **Create** `apps/web/src/components/KnowledgeCenter.tsx` —— 三栏视图的中+右两栏(导航树/记忆列表 + 内容渲染)。
- **Modify** `apps/web/package.json` —— 新增三个依赖。
- **Modify** `apps/web/src/App.tsx` —— import `KnowledgeCenter`;在 `.quest-workbench` 里按 `knowledgeOpen` 切换渲染;选 Quest/Workspace 时关闭知识中心;删除 `KnowledgeDialog` 组件及其挂载。
- **Modify** `apps/web/src/styles.css` —— 新增 `.knowledge-center*` 与 `.markdown-body*` / `.mermaid-*` 样式。
- **Create** `e2e/knowledge-center.spec.ts` —— UI 流程 e2e。

---

### Task 1: 新增渲染依赖

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: 安装依赖**

在仓库根目录运行(pnpm workspace,`--filter` 指定 web 包):

Run:
```bash
pnpm --filter @repohelm/web add react-markdown remark-gfm mermaid
```
Expected: `apps/web/package.json` 的 `dependencies` 多出 `react-markdown`、`remark-gfm`、`mermaid` 三项,`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 验证类型可解析**

Run:
```bash
pnpm --filter @repohelm/web typecheck
```
Expected: PASS(此时还没用到这些包,只确认安装没破坏现有类型)。`react-markdown`/`remark-gfm`/`mermaid` 自带类型声明,无需 `@types/*`。

- [ ] **Step 3: 提交**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "Add react-markdown, remark-gfm, mermaid to web"
```

---

### Task 2: MermaidDiagram 组件

把一段 mermaid 源码异步渲染为 SVG;切换主题重渲染;渲染失败降级显示源码,不让整页崩。

**Files:**
- Create: `apps/web/src/components/MermaidDiagram.tsx`

- [ ] **Step 1: 写组件**

创建 `apps/web/src/components/MermaidDiagram.tsx`,完整内容:

```tsx
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let diagramCounter = 0;

export function MermaidDiagram({ code, theme }: { code: string; theme: "light" | "dark" }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const idRef = useRef(`mermaid-${(diagramCounter += 1)}`);

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
      securityLevel: "strict"
    });
    mermaid
      .render(idRef.current, code)
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSvg("");
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) {
    return (
      <div className="mermaid-fallback">
        <p className="mermaid-error">图表渲染失败:{error}</p>
        <pre>{code}</pre>
      </div>
    );
  }
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @repohelm/web typecheck`
Expected: PASS。（mermaid v11 的 `render(id, text)` 返回 `Promise<{ svg, bindFunctions }>`。）

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/MermaidDiagram.tsx
git commit -m "Add MermaidDiagram render component"
```

---

### Task 3: MarkdownView 组件

react-markdown + remark-gfm 渲染 Markdown;`code` 渲染器识别 `language-mermaid` 交给 `MermaidDiagram`,其余代码块正常显示。

**Files:**
- Create: `apps/web/src/components/MarkdownView.tsx`

- [ ] **Step 1: 写组件**

创建 `apps/web/src/components/MarkdownView.tsx`,完整内容:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./MermaidDiagram";

export function MarkdownView({ body, theme }: { body: string; theme: "light" | "dark" }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const text = String(children ?? "").replace(/\n$/, "");
            if (/\blanguage-mermaid\b/.test(className ?? "")) {
              return <MermaidDiagram code={text} theme={theme} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
```

说明:react-markdown v9 的围栏代码块会渲染成 `<pre><code class="language-mermaid">`,我们的 `code` 覆盖返回 `MermaidDiagram`(一个 `<div>`)会落在 `<pre>` 里。浏览器与 React 19 能正常渲染,Task 5 的 CSS 会给「含 `.mermaid-diagram` 的 pre」去掉内边距/背景,视觉无碍。

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @repohelm/web typecheck`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/MarkdownView.tsx
git commit -m "Add MarkdownView with mermaid fence handling"
```

---

### Task 4: KnowledgeCenter 组件

三栏视图的中+右两栏:左导航(Repo Wiki 树 / 记忆列表 + 搜索 + tab),右内容(wiki 页面渲染 / 记忆条目)。

**Files:**
- Create: `apps/web/src/components/KnowledgeCenter.tsx`

- [ ] **Step 1: 写组件**

创建 `apps/web/src/components/KnowledgeCenter.tsx`,完整内容:

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  FileText,
  RefreshCw,
  Search
} from "lucide-react";
import { api, KnowledgeItem, Project, ProjectKnowledgeView, RepoWikiPage } from "../api";
import { MarkdownView } from "./MarkdownView";

type KnowledgeTab = "wiki" | "memory";

const SLUG_ORDER: RepoWikiPage["slug"][] = [
  "overview",
  "architecture",
  "modules",
  "key-flows",
  "conventions",
  "decisions"
];

export function KnowledgeCenter({
  projects,
  knowledge,
  theme,
  onClose
}: {
  projects: Project[];
  knowledge: KnowledgeItem[];
  theme: "light" | "dark";
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<KnowledgeTab>("wiki");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<string[]>(projects[0] ? [projects[0].id] : []);
  const [views, setViews] = useState<Record<string, ProjectKnowledgeView>>({});
  const [loadingIds, setLoadingIds] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const [selectedSlug, setSelectedSlug] = useState<RepoWikiPage["slug"] | null>(null);
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [syncing, setSyncing] = useState(false);
  const [selectedMemoryId, setSelectedMemoryId] = useState(knowledge[0]?.id ?? "");

  const loadView = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setLoadingIds((ids) => (ids.includes(projectId) ? ids : [...ids, projectId]));
    try {
      const view = await api.getProjectKnowledge(projectId);
      setViews((prev) => ({ ...prev, [projectId]: view }));
    } finally {
      setLoadingIds((ids) => ids.filter((id) => id !== projectId));
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId && !views[selectedProjectId] && !loadingIds.includes(selectedProjectId)) {
      loadView(selectedProjectId);
    }
  }, [selectedProjectId, views, loadingIds, loadView]);

  const activeView = selectedProjectId ? views[selectedProjectId] : undefined;
  const activePage = activeView?.pages.find((page) => page.slug === selectedSlug);
  const activeProjectName = projects.find((p) => p.id === selectedProjectId)?.name ?? "";

  function toggleProject(projectId: string) {
    setExpandedIds((ids) =>
      ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId]
    );
    if (!views[projectId]) loadView(projectId);
  }

  function selectPage(projectId: string, slug: RepoWikiPage["slug"]) {
    setSelectedProjectId(projectId);
    setSelectedSlug(slug);
  }

  async function handleSync() {
    if (!selectedProjectId) return;
    setSyncing(true);
    try {
      const view = await api.syncProjectKnowledge(selectedProjectId);
      setViews((prev) => ({ ...prev, [selectedProjectId]: view }));
    } finally {
      setSyncing(false);
    }
  }

  function syncLabel() {
    if (syncing) return "索引中…";
    if (!activeView || activeView.status === "empty") return "建立知识库";
    if (activeView.status === "stale" && activeView.pendingCommits > 0)
      return `有 ${activeView.pendingCommits} 个新提交,更新`;
    return "重新生成";
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredProjects = projects.filter((p) => p.name.toLowerCase().includes(normalizedQuery));
  const memoryItems = knowledge.filter((item) => {
    if (!normalizedQuery) return true;
    return (
      item.title.toLowerCase().includes(normalizedQuery) ||
      item.body.toLowerCase().includes(normalizedQuery)
    );
  });
  const selectedMemory = knowledge.find((item) => item.id === selectedMemoryId);

  return (
    <div className="knowledge-center" style={{ gridColumn: "3 / 6" }}>
      <nav className="knowledge-nav">
        <header className="knowledge-nav-head">
          <button className="knowledge-back" onClick={onClose} type="button">
            <ArrowLeft size={15} />
            <span>返回</span>
          </button>
          <div className="knowledge-tabs">
            <button
              className={activeTab === "wiki" ? "knowledge-tab active" : "knowledge-tab"}
              onClick={() => setActiveTab("wiki")}
              type="button"
            >
              Repo Wiki
            </button>
            <button
              className={activeTab === "memory" ? "knowledge-tab active" : "knowledge-tab"}
              onClick={() => setActiveTab("memory")}
              type="button"
            >
              记忆
            </button>
          </div>
          <div className="knowledge-search">
            <Search size={14} />
            <input
              aria-label={activeTab === "wiki" ? "搜索 Repo Wiki" : "搜索记忆"}
              placeholder={activeTab === "wiki" ? "搜索 Repo Wiki" : "搜索记忆"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </header>

        {activeTab === "wiki" ? (
          <div className="knowledge-tree">
            {projects.length === 0 ? (
              <p className="muted knowledge-empty">请先在全局设置里绑定仓库。</p>
            ) : null}
            {filteredProjects.map((project) => {
              const expanded = expandedIds.includes(project.id);
              const view = views[project.id];
              const loading = loadingIds.includes(project.id);
              return (
                <div className="knowledge-tree-node" key={project.id}>
                  <button
                    className="knowledge-repo-row"
                    onClick={() => toggleProject(project.id)}
                    type="button"
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Boxes size={14} />
                    <span>{project.name}</span>
                  </button>
                  {expanded ? (
                    <div className="knowledge-page-list">
                      {loading && !view ? <p className="muted knowledge-empty">加载中…</p> : null}
                      {view
                        ? SLUG_ORDER.map((slug) => {
                            const page = view.pages.find((p) => p.slug === slug);
                            if (!page) return null;
                            const active =
                              selectedProjectId === project.id && selectedSlug === slug;
                            return (
                              <button
                                className={
                                  active ? "knowledge-page-row active" : "knowledge-page-row"
                                }
                                key={slug}
                                onClick={() => selectPage(project.id, slug)}
                                type="button"
                              >
                                <FileText size={13} />
                                <span>{page.title}</span>
                              </button>
                            );
                          })
                        : null}
                      {view && view.pages.length === 0 ? (
                        <p className="muted knowledge-empty">暂无内容,点右侧重新生成。</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="knowledge-memory-list">
            {memoryItems.length === 0 ? <p className="muted knowledge-empty">暂无记忆。</p> : null}
            {memoryItems.map((item) => (
              <button
                className={
                  item.id === selectedMemoryId ? "knowledge-memory-row active" : "knowledge-memory-row"
                }
                key={item.id}
                onClick={() => setSelectedMemoryId(item.id)}
                type="button"
              >
                <strong>{item.title}</strong>
                <span>{item.body.slice(0, 60)}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      <section className="knowledge-content">
        {activeTab === "wiki" ? (
          selectedProjectId === "" ? (
            <div className="knowledge-placeholder">选择左侧的仓库与页面以查看。</div>
          ) : (
            <>
              <header className="knowledge-content-head">
                <div className="knowledge-content-meta">
                  <strong>{activeProjectName}</strong>
                  {activeView ? (
                    <span className="knowledge-branch">⌥ {activeView.knowledgeBranch}</span>
                  ) : null}
                  {activeView?.lastIndexedAt ? (
                    <span className="muted">
                      更新于 {new Date(activeView.lastIndexedAt).toLocaleString()}
                      {activeView.lastIndexedSha
                        ? ` · Commit ID ${activeView.lastIndexedSha.slice(0, 12)}`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <div className="knowledge-content-actions">
                  <div className="knowledge-mode-toggle">
                    <button
                      aria-label="预览"
                      className={mode === "preview" ? "active" : ""}
                      onClick={() => setMode("preview")}
                      type="button"
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      aria-label="源码"
                      className={mode === "code" ? "active" : ""}
                      onClick={() => setMode("code")}
                      type="button"
                    >
                      <Code2 size={15} />
                    </button>
                  </div>
                  <button
                    className="knowledge-regenerate"
                    disabled={syncing}
                    onClick={handleSync}
                    type="button"
                  >
                    <RefreshCw className={syncing ? "spin" : ""} size={14} />
                    <span>{syncLabel()}</span>
                  </button>
                </div>
              </header>
              {activeView?.error ? (
                <p className="knowledge-error-banner">{activeView.error}</p>
              ) : null}
              <div className="knowledge-content-body">
                {!activeView ? (
                  <p className="muted">加载中…</p>
                ) : activePage ? (
                  mode === "preview" ? (
                    <MarkdownView body={activePage.body} theme={theme} />
                  ) : (
                    <pre className="knowledge-source">{activePage.body}</pre>
                  )
                ) : activeView.pages.length === 0 ? (
                  <div className="knowledge-placeholder">
                    还没有知识库内容,点击右上角「{syncLabel()}」建立。
                  </div>
                ) : (
                  <div className="knowledge-placeholder">从左侧选择一个页面查看。</div>
                )}
              </div>
            </>
          )
        ) : selectedMemory ? (
          <div className="knowledge-content-body">
            <header className="knowledge-content-head">
              <div className="knowledge-content-meta">
                <strong>{selectedMemory.title}</strong>
                <span className="muted">{new Date(selectedMemory.updatedAt).toLocaleString()}</span>
              </div>
            </header>
            <MarkdownView body={selectedMemory.body} theme={theme} />
            {selectedMemory.tags.length > 0 ? (
              <div className="knowledge-tags">
                {selectedMemory.tags.map((tag) => (
                  <span className="knowledge-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="knowledge-placeholder">选择左侧的记忆条目查看。</div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @repohelm/web typecheck`
Expected: PASS。（`Project`、`KnowledgeItem`、`ProjectKnowledgeView`、`RepoWikiPage` 均从 `../api` 导出,已在 `api.ts:225-262` 定义。）

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/KnowledgeCenter.tsx
git commit -m "Add KnowledgeCenter three-column view component"
```

---

### Task 5: 知识中心样式

**Files:**
- Modify: `apps/web/src/styles.css`(在文件末尾追加)

- [ ] **Step 1: 追加 CSS**

把以下内容追加到 `apps/web/src/styles.css` 末尾:

```css
/* ===== Knowledge Center ===== */
.knowledge-center {
  background: var(--surface);
  display: grid;
  grid-template-columns: 320px 1fr;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.knowledge-nav {
  background: var(--sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.knowledge-nav-head {
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.knowledge-back {
  align-items: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  font-size: 13px;
  gap: 6px;
  padding: 0;
  width: fit-content;
}
.knowledge-back:hover {
  color: var(--text);
}

.knowledge-tabs {
  display: flex;
  gap: 18px;
}
.knowledge-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  padding: 0 0 6px;
}
.knowledge-tab.active {
  border-bottom-color: var(--accent);
  color: var(--text);
}

.knowledge-search {
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  display: flex;
  gap: 8px;
  padding: 7px 10px;
}
.knowledge-search input {
  background: none;
  border: none;
  color: var(--text);
  flex: 1;
  font-size: 13px;
  outline: none;
}

.knowledge-tree,
.knowledge-memory-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}
.knowledge-empty {
  padding: 8px 10px;
}

.knowledge-repo-row,
.knowledge-page-row,
.knowledge-memory-row {
  align-items: center;
  background: none;
  border: none;
  border-radius: 7px;
  color: var(--text);
  cursor: pointer;
  display: flex;
  gap: 8px;
  padding: 7px 8px;
  text-align: left;
  width: 100%;
}
.knowledge-repo-row {
  font-weight: 600;
}
.knowledge-repo-row:hover,
.knowledge-page-row:hover,
.knowledge-memory-row:hover {
  background: var(--surface-2);
}
.knowledge-page-list {
  padding-left: 18px;
}
.knowledge-page-row.active,
.knowledge-memory-row.active {
  background: var(--accent-soft);
  color: var(--text);
}
.knowledge-page-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knowledge-memory-row {
  align-items: flex-start;
  flex-direction: column;
  gap: 2px;
}
.knowledge-memory-row strong {
  font-size: 13px;
}
.knowledge-memory-row span {
  color: var(--text-muted);
  font-size: 12px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.knowledge-content-head {
  align-items: flex-start;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 18px 28px;
}
.knowledge-content-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.knowledge-content-meta strong {
  font-size: 16px;
}
.knowledge-content-meta .knowledge-branch {
  color: var(--text-muted);
  font-size: 12px;
}
.knowledge-content-actions {
  align-items: center;
  display: flex;
  gap: 10px;
}
.knowledge-mode-toggle {
  border: 1px solid var(--border);
  border-radius: 8px;
  display: inline-flex;
  overflow: hidden;
}
.knowledge-mode-toggle button {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  padding: 6px 9px;
}
.knowledge-mode-toggle button.active {
  background: var(--surface-2);
  color: var(--text);
}
.knowledge-regenerate {
  align-items: center;
  background: var(--text);
  border: none;
  border-radius: 8px;
  color: var(--surface);
  cursor: pointer;
  display: inline-flex;
  font-size: 13px;
  font-weight: 600;
  gap: 6px;
  padding: 7px 12px;
}
.knowledge-regenerate:disabled {
  cursor: default;
  opacity: 0.6;
}
.knowledge-error-banner {
  color: var(--danger);
  padding: 10px 28px;
}
.knowledge-content-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px 28px 60px;
}
.knowledge-placeholder {
  color: var(--text-muted);
  padding: 40px 28px;
}
.knowledge-source {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.knowledge-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
}
.knowledge-tag {
  background: var(--surface-2);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 12px;
  padding: 3px 10px;
}

/* ===== Markdown body ===== */
.markdown-body {
  color: var(--text);
  font-size: 14px;
  line-height: 1.7;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  font-weight: 700;
  line-height: 1.3;
  margin: 1.4em 0 0.6em;
}
.markdown-body h1 {
  font-size: 22px;
}
.markdown-body h2 {
  font-size: 18px;
}
.markdown-body h3 {
  font-size: 15px;
}
.markdown-body p {
  margin: 0.7em 0;
}
.markdown-body ul,
.markdown-body ol {
  margin: 0.6em 0;
  padding-left: 1.4em;
}
.markdown-body li {
  margin: 0.3em 0;
}
.markdown-body code {
  background: var(--surface-2);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 1px 5px;
}
.markdown-body pre {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  margin: 1em 0;
  overflow: auto;
  padding: 14px 16px;
}
.markdown-body pre code {
  background: none;
  padding: 0;
}
.markdown-body pre:has(.mermaid-diagram) {
  background: none;
  border: none;
  padding: 0;
}
.markdown-body a {
  color: var(--accent);
}
.markdown-body table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}
.markdown-body blockquote {
  border-left: 3px solid var(--border-strong);
  color: var(--text-muted);
  margin: 1em 0;
  padding-left: 14px;
}

.mermaid-diagram {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  justify-content: center;
  margin: 1em 0;
  overflow: auto;
  padding: 18px;
}
.mermaid-diagram svg {
  height: auto;
  max-width: 100%;
}
.mermaid-fallback {
  margin: 1em 0;
}
.mermaid-error {
  color: var(--danger);
  font-size: 12px;
  margin-bottom: 6px;
}
```

- [ ] **Step 2: 提交**(样式无法单独 typecheck,留到 Task 6 整体验证)

```bash
git add apps/web/src/styles.css
git commit -m "Add knowledge center and markdown styles"
```

---

### Task 6: 接入 App,移除旧模态框

把 `knowledgeOpen` 从「开模态框」改为「主区切换知识中心」;选 Quest/Workspace 时退出;删除 `KnowledgeDialog`。

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: import KnowledgeCenter**

在 `App.tsx` 顶部 import 区(`import { Select } from "./components/Select";` 之后,约 60 行)加一行:

```tsx
import { KnowledgeCenter } from "./components/KnowledgeCenter";
```

- [ ] **Step 2: 在 workbench 里按模式切换渲染**

在 `App` 的 return 中找到 `.quest-workbench` 段(约 569–672 行):`<Sidebar .../>` 后面紧跟「左 resize handle → QuestStage → 右 resize handle → Inspector」。把从**左 resize handle 之后**的 `QuestStage`、右 resize handle、`Inspector` 用 `knowledgeOpen` 条件包裹。

具体改法:保留 `<Sidebar .../>` 和它后面的左 resize handle(`resize-handle-left`)不动。把现有的 `<QuestStage .../>`、`resize-handle-right` 的 `<div .../>`、`<Inspector .../>` 三段整体替换为下面这个三元表达式(`...` 处保留各组件原有的全部 props,不要改 props):

```tsx
        {knowledgeOpen ? (
          <KnowledgeCenter
            projects={state.projects}
            knowledge={knowledge}
            theme={theme}
            onClose={() => setKnowledgeOpen(false)}
          />
        ) : (
          <>
            <QuestStage
              /* ...保留原有全部 props... */
            />
            <div
              aria-label="调整右侧栏宽度"
              className="resize-handle resize-handle-right"
              onPointerDown={(event) => startColumnResize("inspector", event)}
              role="separator"
            />
            <Inspector
              /* ...保留原有全部 props... */
            />
          </>
        )}
```

注意:`KnowledgeCenter` 自带 `style={{ gridColumn: "3 / 6" }}`,会横跨原 stage(列3)+ 右 handle(列4)+ inspector(列5)三列。`state` 与 `knowledge` 在此作用域已存在(`knowledge` 定义于 `App.tsx:208`,`state` 已在 `App.tsx:524` 的守卫后非空)。

- [ ] **Step 3: 选 Quest/Workspace 时退出知识中心**

在 `<Sidebar .../>` 的三个回调里各加一行 `setKnowledgeOpen(false);`:

`onNewQuest`(约 592 行,函数体第一行):
```tsx
          onNewQuest={(workspaceId) => {
            setKnowledgeOpen(false);
            setSelectedWorkspaceId(workspaceId);
```

`onSelectQuest`(约 600 行):
```tsx
          onSelectQuest={(questId) => {
            setKnowledgeOpen(false);
            setSelectedQuestId(questId);
```

`onSelectWorkspace`(约 605 行):
```tsx
          onSelectWorkspace={(workspaceId) => {
            setKnowledgeOpen(false);
            setSelectedWorkspaceId(workspaceId);
```

- [ ] **Step 4: 删除旧 KnowledgeDialog 挂载**

删除 return 中这一段(约 718–723 行):

```tsx
      {knowledgeOpen ? (
        <KnowledgeDialog
          projects={state?.projects ?? []}
          onClose={() => setKnowledgeOpen(false)}
        />
      ) : null}
```

- [ ] **Step 5: 删除 KnowledgeDialog 组件定义**

删除整个 `function KnowledgeDialog({ ... }) { ... }`(约 3065–3185 行,从 `function KnowledgeDialog({` 到对应结束的 `}`,即下一个 `function InspectorSection` 之前)。

- [ ] **Step 6: 清理无用 import / state(若有)**

检查 `KnowledgeDialog` 删除后是否有仅它使用的符号变成未用:
- `ProjectKnowledgeView`(`api` import,约 46 行)——现在只 `KnowledgeCenter` 用,App.tsx 内可能不再引用。若 typecheck 报未用,删掉该 import 行里的 `ProjectKnowledgeView,`。
- `knowledgeOpen` / `setKnowledgeOpen` 仍在用(切换模式),**保留**。

- [ ] **Step 7: 类型检查 + 构建**

Run:
```bash
pnpm --filter @repohelm/web typecheck && pnpm --filter @repohelm/web build
```
Expected: 两者都 PASS,无未用变量报错。若报 `ProjectKnowledgeView` 未用,按 Step 6 删除后重跑。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/App.tsx
git commit -m "Replace knowledge modal with inline knowledge center"
```

---

### Task 7: e2e 流程测试 + 最终验证

**Files:**
- Create: `e2e/knowledge-center.spec.ts`

- [ ] **Step 1: 写 e2e**

创建 `e2e/knowledge-center.spec.ts`,完整内容(参照 `e2e/quest-workspace.spec.ts` 的 `page.goto("/")` 风格;e2e 固定 fixture 里有名为 `RepoHelm Demo Workspace` 的 workspace 与已绑定仓库):

```ts
import { expect, test } from "@playwright/test";

test("opens knowledge center, renders a wiki page, and exits", async ({ page }) => {
  await page.goto("/");

  // 等工作区加载
  await expect(
    page.locator(".workspace-title-button").filter({ hasText: "RepoHelm Demo Workspace" })
  ).toBeVisible();

  // 进入知识中心
  await page.getByRole("button", { name: "知识中心" }).click();
  await expect(page.locator(".knowledge-center")).toBeVisible();
  await expect(page.getByRole("button", { name: "Repo Wiki" })).toBeVisible();
  await expect(page.getByRole("button", { name: "记忆" })).toBeVisible();

  // 展开第一个仓库,点开首个页面
  const firstRepo = page.locator(".knowledge-repo-row").first();
  await firstRepo.click();
  const firstPage = page.locator(".knowledge-page-row").first();
  // fixture 仓库若已建库则有页面;否则跳过页面断言
  if (await firstPage.count()) {
    await firstPage.click();
    await expect(page.locator(".knowledge-content-body")).toBeVisible();
    // 切到源码模式
    await page.getByRole("button", { name: "源码" }).click();
    await expect(page.locator(".knowledge-source")).toBeVisible();
  }

  // 切到记忆 tab
  await page.getByRole("button", { name: "记忆" }).click();
  await expect(page.locator(".knowledge-search input")).toHaveAttribute("placeholder", "搜索记忆");

  // 返回退出知识中心,回到 Quest 模式
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page.locator(".knowledge-center")).toHaveCount(0);
  await expect(page.locator(".quest-stage, .chat-stage")).toBeVisible();
});
```

- [ ] **Step 2: 跑这条 e2e**

Run:
```bash
pnpm test:e2e -g "opens knowledge center"
```
Expected: PASS。（Playwright 会自动起 dev server;若本地端口占用先 `pnpm dev` 关掉。）
排错:若 `知识中心` 按钮点不到,确认 Sidebar footer 文案仍是「知识中心」(`App.tsx:886`)。

- [ ] **Step 3: 全量验证**

Run:
```bash
pnpm typecheck && pnpm --filter @repohelm/web build
```
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add e2e/knowledge-center.spec.ts
git commit -m "Add knowledge center e2e flow test"
```

---

## Self-Review(已执行)

- **Spec 覆盖**:进入/退出(Task 6)、中间 Repo Wiki 树 + 记忆 tab + 搜索(Task 4)、右侧 Markdown/mermaid + 预览/代码切换 + 重新生成 + 提交信息头(Task 4 + Task 2/3)、token 样式(Task 5)、不动后端(全程复用 `api`)、错误/空态边界(Task 4 的 placeholder/error 分支)、测试(Task 7)。砍掉项(多标签/嵌套树/单页重生成)未实现,符合 spec。✅
- **占位符**:无 TBD/TODO,代码均为完整可粘贴内容。✅
- **类型一致**:`ProjectKnowledgeView`/`RepoWikiPage`/`Project`/`KnowledgeItem` 字段名与 `api.ts:225-262` 一致;`slug` 联合类型与 `SLUG_ORDER` 一致;`api.getProjectKnowledge`/`syncProjectKnowledge` 签名与 `api.ts:489-492` 一致;`MermaidDiagram`/`MarkdownView` props 在调用处匹配。✅
- **Task 6 props 保留**:替换 stage/inspector 时强调「保留原有全部 props」,避免漏传。✅
```
