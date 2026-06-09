import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
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

/** Simple toast for sync feedback */
function useToast() {
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, type: "success" | "error" = "success") => {
    setMsg({ text, type });
    clearTimeout(timer.current ?? undefined);
    timer.current = setTimeout(() => setMsg(null), 3000);
  }, []);
  return { msg, show };
}

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

  // Track which projects have been loaded (to avoid re-fetching)
  const loadedRef = useRef(new Set<string>());
  // Track which projects are currently loading (to prevent duplicate concurrent loads)
  const loadingRef = useRef(new Set<string>());

  const toast = useToast();

  const loadView = useCallback(async (projectId: string) => {
    if (!projectId) return;
    // Use a loading ref to prevent duplicate concurrent loads
    if (loadingRef.current.has(projectId)) return;
    if (loadedRef.current.has(projectId)) return;

    loadingRef.current.add(projectId);
    setLoadingIds((ids) => [...ids, projectId]);

    try {
      const view = await api.getProjectKnowledge(projectId);
      setViews((prev) => ({ ...prev, [projectId]: view }));
      loadedRef.current.add(projectId);
    } catch (err) {
      console.error('[KnowledgeCenter] error loading:', projectId, err);
    } finally {
      loadingRef.current.delete(projectId);
      setLoadingIds((ids) => ids.filter((id) => id !== projectId));
    }
  }, []);

  // Load view for selected project on mount and when selection changes
  useEffect(() => {
    if (selectedProjectId) {
      loadView(selectedProjectId);
    }
  }, [selectedProjectId, loadView]);

  // Auto-select first page when a project's view loads
  useEffect(() => {
    if (selectedProjectId && !selectedSlug) {
      const view = views[selectedProjectId];
      if (view && view.pages.length > 0) {
        // Find first available page in SLUG_ORDER
        for (const slug of SLUG_ORDER) {
          if (view.pages.some((p) => p.slug === slug)) {
            setSelectedSlug(slug);
            break;
          }
        }
      }
    }
  }, [selectedProjectId, selectedSlug, views]);

  const activeView = selectedProjectId ? views[selectedProjectId] : undefined;
  const activePage = activeView?.pages.find((page) => page.slug === selectedSlug);
  const activeProjectName = projects.find((p) => p.id === selectedProjectId)?.name ?? "";

  function toggleProject(projectId: string) {
    setExpandedIds((ids) => {
      const willExpand = !ids.includes(projectId);
      if (willExpand) {
        setSelectedProjectId(projectId);
        setSelectedSlug(null); // Will be auto-set by effect when view loads
      }
      return willExpand ? [...ids, projectId] : ids.filter((id) => id !== projectId);
    });
    if (!loadedRef.current.has(projectId) && !loadingRef.current.has(projectId)) {
      loadView(projectId);
    }
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
      loadedRef.current.add(selectedProjectId);
      toast.show("知识库更新成功", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "同步失败";
      toast.show(msg, "error");
    } finally {
      setSyncing(false);
    }
  }

  function syncLabel() {
    if (syncing) return "索引中…";
    if (!activeView) return "建立知识库";
    if (activeView.error) return "重试";
    if (activeView.status === "empty") return "建立知识库";
    if (activeView.status === "stale" && activeView.pendingCommits > 0)
      return `有 ${activeView.pendingCommits} 个新提交,更新`;
    return "重新生成";
  }

  const currentSyncLabel = syncLabel();

  const normalizedQuery = query.trim().toLowerCase();

  // Search projects by name AND their page titles
  const filteredProjects = projects.filter((p) => {
    if (!normalizedQuery) return true;
    if (p.name.toLowerCase().includes(normalizedQuery)) return true;
    const view = views[p.id];
    if (view?.pages.some((page) => page.title.toLowerCase().includes(normalizedQuery))) return true;
    return false;
  });

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
      {/* Toast notification */}
      {toast.msg && (
        <div
          className={`knowledge-toast ${toast.msg.type === "error" ? "error" : "success"}`}
          role="alert"
        >
          {toast.msg.text}
        </div>
      )}

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
              aria-label={activeTab === "wiki" ? "搜索项目和页面" : "搜索记忆"}
              placeholder={activeTab === "wiki" ? "搜索项目和页面" : "搜索记忆"}
              type="search"
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
              const hasError = view?.error;
              const isEmpty = view && view.pages.length === 0 && !view.error;
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
                    {hasError ? (
                      <AlertCircle size={13} className="knowledge-error-icon" />
                    ) : null}
                  </button>
                  {expanded ? (
                    <div className="knowledge-page-list">
                      {loading && !view ? (
                        <p className="muted knowledge-empty">加载中…</p>
                      ) : null}
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
                      {isEmpty ? (
                        <p className="muted knowledge-empty">暂无内容,点击右上角建立。</p>
                      ) : null}
                      {hasError ? (
                        <p className="knowledge-tree-error" title={view.error}>
                          索引失败,点击右侧重试。
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="knowledge-memory-list">
            {memoryItems.length === 0 ? (
              <p className="muted knowledge-empty">
                {normalizedQuery ? "没有匹配的记忆。" : "暂无记忆。"}
              </p>
            ) : null}
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
                    <span className="knowledge-branch"> {activeView.knowledgeBranch}</span>
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
                      aria-pressed={mode === "preview"}
                      className={mode === "preview" ? "active" : ""}
                      onClick={() => setMode("preview")}
                      type="button"
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      aria-label="源码"
                      aria-pressed={mode === "code"}
                      className={mode === "code" ? "active" : ""}
                      onClick={() => setMode("code")}
                      type="button"
                    >
                      <Code2 size={15} />
                    </button>
                  </div>
                  <button
                    className={`knowledge-regenerate ${activeView?.error ? "error" : ""}`}
                    disabled={syncing}
                    onClick={handleSync}
                    type="button"
                  >
                    <RefreshCw className={syncing ? "spin" : ""} size={14} />
                    <span>{currentSyncLabel}</span>
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
                ) : activeView.error ? (
                  <div className="knowledge-placeholder">
                    索引失败,请检查仓库配置后点击右上角「重试」。
                  </div>
                ) : activeView.pages.length === 0 ? (
                  <div className="knowledge-placeholder">
                    还没有知识库内容,点击右上角「{currentSyncLabel}」建立。
                  </div>
                ) : (
                  <div className="knowledge-placeholder">从左侧选择一个页面查看。</div>
                )}
              </div>
            </>
          )
        ) : selectedMemory ? (
          <>
            <header className="knowledge-content-head">
              <div className="knowledge-content-meta">
                <strong>{selectedMemory.title}</strong>
                <span className="muted">{new Date(selectedMemory.updatedAt).toLocaleString()}</span>
              </div>
            </header>
            <div className="knowledge-content-body">
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
          </>
        ) : (
          <div className="knowledge-placeholder">
            {normalizedQuery ? "没有匹配的记忆。" : "选择左侧的记忆条目查看。"}
          </div>
        )}
      </section>
    </div>
  );
}
