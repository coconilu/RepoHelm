import {
  BookOpen,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  GitPullRequest,
  ListChecks,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AgentBackendId,
  AgentBackendInfo,
  AgentEvent,
  api,
  AuditLogEntry,
  ChangedFile,
  CapabilityDefinition,
  KnowledgeItem,
  Project,
  ProductReadiness,
  Quest,
  RepoHelmState,
  SecurityPolicy,
  Workspace
} from "./api";

const statusLabel: Record<string, string> = {
  draft: "草稿",
  specifying: "Spec",
  planning: "规划中",
  preparing: "准备中",
  executing: "执行中",
  validating: "验证中",
  reviewing: "Review",
  ready: "待交付",
  delivered: "已交付",
  blocked: "阻塞",
  cancelled: "取消"
};

const statusClass: Record<string, string> = {
  planning: "badge blue",
  ready: "badge green",
  draft: "badge",
  blocked: "badge red"
};

type InspectorTab = "spec" | "overview" | "capabilities" | "security" | "product" | "files" | "diff" | "logs";
type ResizeDivider = "sidebar" | "inspector";

const defaultColumnWidths = {
  sidebar: 280,
  inspector: 440
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function App() {
  const [state, setState] = useState<RepoHelmState | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [selectedQuestId, setSelectedQuestId] = useState<string>("");
  const [questRequirement, setQuestRequirement] = useState("");
  const [draftWorkspaceId, setDraftWorkspaceId] = useState("");
  const [agentBackendId, setAgentBackendId] = useState<AgentBackendId>("mock");
  const [agentBackends, setAgentBackends] = useState<AgentBackendInfo[]>([]);
  const [productReadiness, setProductReadiness] = useState<ProductReadiness | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("spec");
  const [selectedChangedFileKey, setSelectedChangedFileKey] = useState("");
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<string[]>([]);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceConfigOpen, setWorkspaceConfigOpen] = useState(false);
  const [workspaceConfigId, setWorkspaceConfigId] = useState("");
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState(() => {
    try {
      const saved = window.localStorage.getItem("repohelm:column-widths");
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<typeof defaultColumnWidths>;
        return {
          sidebar: clamp(parsed.sidebar ?? defaultColumnWidths.sidebar, 220, 380),
          inspector: clamp(parsed.inspector ?? defaultColumnWidths.inspector, 360, 560)
        };
      }
    } catch {
      // Ignore malformed local UI preferences.
    }
    return defaultColumnWidths;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resizeStartRef = useRef<{
    divider: ResizeDivider;
    pointerX: number;
    sidebar: number;
    inspector: number;
  } | null>(null);

  const load = async () => {
    const [nextState, nextBackends, nextReadiness] = await Promise.all([
      api.state(),
      api.agentBackends(),
      api.productReadiness()
    ]);
    setState(nextState);
    setAgentBackends(nextBackends);
    setProductReadiness(nextReadiness);
    setSelectedWorkspaceId((current) => current || nextState.workspaces[0]?.id || "");
    setSelectedQuestId((current) => current || nextState.quests[0]?.id || "");
    setExpandedWorkspaceIds((current) => (current.length > 0 ? current : nextState.workspaces[0] ? [nextState.workspaces[0].id] : []));
  };

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("repohelm:column-widths", JSON.stringify(columnWidths));
  }, [columnWidths]);

  const workspace = useMemo(
    () => state?.workspaces.find((item) => item.id === selectedWorkspaceId) ?? state?.workspaces[0],
    [selectedWorkspaceId, state?.workspaces]
  );
  const configWorkspace = useMemo(
    () => state?.workspaces.find((item) => item.id === workspaceConfigId) ?? workspace,
    [state?.workspaces, workspace, workspaceConfigId]
  );
  const projects = useMemo(
    () => state?.projects.filter((project) => project.workspaceId === workspace?.id) ?? [],
    [state?.projects, workspace?.id]
  );
  const configProjects = useMemo(
    () => state?.projects.filter((project) => project.workspaceId === configWorkspace?.id) ?? [],
    [configWorkspace?.id, state?.projects]
  );
  const quests = useMemo(
    () => state?.quests.filter((quest) => quest.workspaceId === workspace?.id) ?? [],
    [state?.quests, workspace?.id]
  );
  const selectedQuest = draftWorkspaceId === workspace?.id ? undefined : quests.find((quest) => quest.id === selectedQuestId) ?? quests[0];
  const questEvents = state?.events.filter((event) => event.questId === selectedQuest?.id) ?? [];
  const knowledge = state?.knowledge.filter((item) => item.workspaceId === workspace?.id) ?? [];
  const changedFiles = selectedQuest?.changedFiles.map((file) => normalizeChangedFile(file)) ?? [];
  const selectedChangedFile =
    changedFiles.find((file) => changedFileKey(file) === selectedChangedFileKey) ?? changedFiles[0];
  const activeBackend = agentBackends.find((backend) => backend.id === agentBackendId);

  useEffect(() => {
    if (draftWorkspaceId === workspace?.id) {
      return;
    }
    if (!selectedQuestId && quests[0]) {
      setSelectedQuestId(quests[0].id);
    }
  }, [draftWorkspaceId, quests, selectedQuestId, workspace?.id]);

  useEffect(() => {
    if (changedFiles.length > 0 && !changedFiles.some((file) => changedFileKey(file) === selectedChangedFileKey)) {
      setSelectedChangedFileKey(changedFileKey(changedFiles[0]));
    }
  }, [changedFiles, selectedChangedFileKey]);

  async function createQuest(event: FormEvent) {
    event.preventDefault();
    if (!workspace) {
      return;
    }
    const trimmedRequirement = questRequirement.trim();
    if (!trimmedRequirement) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const quest = await api.createQuest({
        workspaceId: workspace.id,
        title: deriveRequestTitle(trimmedRequirement),
        requirement: trimmedRequirement,
        agentBackendId,
        affectedProjectIds: projects.map((project) => project.id)
      });
      await load();
      setSelectedQuestId(quest.id);
      setDraftWorkspaceId("");
      setQuestRequirement("");
      setInspectorTab("spec");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runQuest() {
    if (!selectedQuest) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.runQuest(selectedQuest.id);
      await load();
      setInspectorTab("files");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function retryQuest() {
    if (!selectedQuest) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.retryQuest(selectedQuest.id);
      await load();
      setInspectorTab("files");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cleanupQuest() {
    if (!selectedQuest) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.cleanupQuest(selectedQuest.id);
      await load();
      setInspectorTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deliverQuest() {
    if (!selectedQuest) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.deliverQuest(selectedQuest.id);
      await load();
      setInspectorTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function acceptCapability(capabilityId: string) {
    if (!selectedQuest) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.acceptCapability(selectedQuest.id, capabilityId);
      await load();
      setInspectorTab("capabilities");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function dismissCapability(capabilityId: string) {
    if (!selectedQuest) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.dismissCapability(selectedQuest.id, capabilityId);
      await load();
      setInspectorTab("capabilities");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startColumnResize(divider: ResizeDivider, event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeStartRef.current = {
      divider,
      pointerX: event.clientX,
      sidebar: columnWidths.sidebar,
      inspector: columnWidths.inspector
    };
    document.body.classList.add("is-resizing-columns");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }
      const delta = moveEvent.clientX - start.pointerX;
      setColumnWidths({
        sidebar: start.divider === "sidebar" ? clamp(start.sidebar + delta, 220, 380) : start.sidebar,
        inspector: start.divider === "inspector" ? clamp(start.inspector - delta, 360, 560) : start.inspector
      });
    };

    const stopResize = () => {
      resizeStartRef.current = null;
      document.body.classList.remove("is-resizing-columns");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  async function saveWorkspaceConfig(input: { name: string; description: string; worktreeRoot: string }) {
    if (!configWorkspace) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.updateWorkspace(configWorkspace.id, input);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace(input: { name: string; description: string; worktreeRoot: string }) {
    setBusy(true);
    setError("");
    try {
      const workspace = await api.createWorkspace({
        name: input.name,
        description: input.description,
        worktreeRoot: input.worktreeRoot || undefined
      });
      await load();
      setSelectedWorkspaceId(workspace.id);
      setSelectedQuestId("");
      setDraftWorkspaceId(workspace.id);
      setQuestRequirement("");
      setExpandedWorkspaceIds((current) => [...new Set([workspace.id, ...current])]);
      setWorkspaceCreateOpen(false);
      setInspectorTab("spec");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addProject(input: {
    name: string;
    path: string;
    role: string;
    defaultBranch: string;
    validationCommand: string;
  }) {
    if (!configWorkspace) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.createProject({ workspaceId: configWorkspace.id, ...input });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateProject(projectId: string, input: {
    name: string;
    path: string;
    role: string;
    defaultBranch: string;
    validationCommand: string;
  }) {
    setBusy(true);
    setError("");
    try {
      await api.updateProject(projectId, input);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(projectId: string) {
    setBusy(true);
    setError("");
    try {
      await api.removeProject(projectId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function checkProject(projectId: string) {
    setBusy(true);
    setError("");
    try {
      await api.checkProject(projectId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state || !workspace) {
    return (
      <main className="loading">
        <RefreshCw className="spin" size={22} />
        <span>正在启动 RepoHelm 工作区</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-toolbar">
        <div className="brand">
          <div className="brand-mark">
            <Route size={18} />
          </div>
          <div>
            <strong>RepoHelm</strong>
            <span>Quest Workspace</span>
          </div>
        </div>
        <div className="toolbar-controls">
          <span className={activeBackend?.available ? "backend-pill available" : "backend-pill"}>
            <Bot size={14} />
            {activeBackend?.name ?? "Backend"}
          </span>
          <button className="toolbar-action secondary" disabled={busy || !selectedQuest} onClick={retryQuest} type="button">
            <RefreshCw size={15} />
            <span>重试</span>
          </button>
          <button className="toolbar-action secondary" disabled={busy || !selectedQuest} onClick={cleanupQuest} type="button">
            <Trash2 size={15} />
            <span>清理</span>
          </button>
          <button className="toolbar-action delivery" disabled={busy || !selectedQuest} onClick={deliverQuest} type="button">
            <GitPullRequest size={15} />
            <span>交付</span>
          </button>
          <button className="toolbar-action" disabled={busy || !selectedQuest} onClick={runQuest} type="button">
            <Play size={15} />
            <span>{selectedQuest?.status === "ready" ? "重新运行" : "运行 Request"}</span>
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section
        className="quest-workbench"
        style={
          {
            "--sidebar-width": `${columnWidths.sidebar}px`,
            "--inspector-width": `${columnWidths.inspector}px`
          } as React.CSSProperties
        }
      >
        <Sidebar
          knowledgeCount={knowledge.length}
          quests={quests}
          draftWorkspaceId={draftWorkspaceId}
          selectedQuest={selectedQuest}
          selectedWorkspaceId={workspace.id}
          workspaces={state.workspaces}
          expandedWorkspaceIds={expandedWorkspaceIds}
          onConfigWorkspace={(workspaceId) => {
            setWorkspaceConfigId(workspaceId);
            setWorkspaceConfigOpen(true);
          }}
          onCreateWorkspace={() => setWorkspaceCreateOpen(true)}
          onKnowledgeOpen={() => setKnowledgeOpen(true)}
          onNewQuest={(workspaceId) => {
            setSelectedWorkspaceId(workspaceId);
            setSelectedQuestId("");
            setDraftWorkspaceId(workspaceId);
            setQuestRequirement("");
            setExpandedWorkspaceIds((current) => (current.includes(workspaceId) ? current : [...current, workspaceId]));
            setInspectorTab("spec");
          }}
          onSelectQuest={(questId) => {
            setSelectedQuestId(questId);
            setDraftWorkspaceId("");
            setInspectorTab("spec");
          }}
          onSelectWorkspace={(workspaceId) => {
            setSelectedWorkspaceId(workspaceId);
            setSelectedQuestId("");
            setDraftWorkspaceId("");
            setQuestRequirement("");
            setInspectorTab("spec");
          }}
          onToggleWorkspace={(workspaceId) => {
            setExpandedWorkspaceIds((current) =>
              current.includes(workspaceId) ? current.filter((id) => id !== workspaceId) : [...current, workspaceId]
            );
          }}
        />
        <div
          aria-label="调整左侧栏宽度"
          className="resize-handle resize-handle-left"
          onPointerDown={(event) => startColumnResize("sidebar", event)}
          role="separator"
        />
        <QuestStage
          agentBackendId={agentBackendId}
          agentBackends={agentBackends}
          busy={busy}
          events={questEvents}
          projects={projects}
          quest={selectedQuest}
          questRequirement={questRequirement}
          workspace={workspace}
          onBackendChange={setAgentBackendId}
          onCreateQuest={createQuest}
          onRequirementChange={setQuestRequirement}
        />
        <div
          aria-label="调整右侧栏宽度"
          className="resize-handle resize-handle-right"
          onPointerDown={(event) => startColumnResize("inspector", event)}
          role="separator"
        />
        <Inspector
          auditLog={state.auditLog}
          capabilities={state.capabilities}
          changedFiles={changedFiles}
          events={questEvents}
          projects={projects}
          productReadiness={productReadiness}
          quest={selectedQuest}
          securityPolicy={state.securityPolicy}
          selectedChangedFile={selectedChangedFile}
          tab={inspectorTab}
          onAcceptCapability={acceptCapability}
          onDismissCapability={dismissCapability}
          onFileSelect={(file) => {
            setSelectedChangedFileKey(changedFileKey(file));
            setInspectorTab("diff");
          }}
          onTabChange={setInspectorTab}
        />
      </section>

      {workspaceCreateOpen ? (
        <WorkspaceCreateDialog
          busy={busy}
          onClose={() => setWorkspaceCreateOpen(false)}
          onCreateWorkspace={createWorkspace}
        />
      ) : null}

      {workspaceConfigOpen && configWorkspace ? (
        <WorkspaceConfigDialog
          busy={busy}
          projects={configProjects}
          workspace={configWorkspace}
          onAddProject={addProject}
          onCheckProject={checkProject}
          onClose={() => setWorkspaceConfigOpen(false)}
          onRemoveProject={removeProject}
          onSaveWorkspace={saveWorkspaceConfig}
          onUpdateProject={updateProject}
        />
      ) : null}

      {knowledgeOpen ? (
        <KnowledgeDialog
          knowledge={knowledge}
          workspace={workspace}
          onClose={() => setKnowledgeOpen(false)}
        />
      ) : null}
    </main>
  );
}

function Sidebar({
  draftWorkspaceId,
  expandedWorkspaceIds,
  knowledgeCount,
  quests,
  selectedQuest,
  selectedWorkspaceId,
  workspaces,
  onConfigWorkspace,
  onCreateWorkspace,
  onKnowledgeOpen,
  onNewQuest,
  onSelectQuest,
  onSelectWorkspace,
  onToggleWorkspace
}: {
  draftWorkspaceId: string;
  expandedWorkspaceIds: string[];
  knowledgeCount: number;
  quests: Quest[];
  selectedQuest?: Quest;
  selectedWorkspaceId: string;
  workspaces: Workspace[];
  onConfigWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onKnowledgeOpen: () => void;
  onNewQuest: (workspaceId: string) => void;
  onSelectQuest: (questId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleWorkspace: (workspaceId: string) => void;
}) {
  return (
    <aside className="sidebar">
      <button className="new-quest-button" onClick={onCreateWorkspace} type="button">
        <Plus size={16} />
        <span>创建 Workspace</span>
      </button>

      <section className="sidebar-section grow">
        <span className="section-label">Workspaces</span>
        <div className="workspace-tree">
          {workspaces.map((item) => {
            const expanded = expandedWorkspaceIds.includes(item.id);
            const itemQuests = quests.filter((quest) => quest.workspaceId === item.id);
            const hasDraftRequest = item.id === draftWorkspaceId;
            return (
              <div className="workspace-node" key={item.id}>
                <div className={`workspace-row ${item.id === selectedWorkspaceId ? "active" : ""}`}>
                  <button
                    aria-label={expanded ? "收起 workspace" : "展开 workspace"}
                    className="icon-button"
                    onClick={() => onToggleWorkspace(item.id)}
                    type="button"
                  >
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <button className="workspace-title-button" onClick={() => onSelectWorkspace(item.id)} type="button">
                    <Boxes size={15} />
                    <span>{item.name}</span>
                  </button>
                  <button
                    aria-label={`为 ${item.name} 创建 Request`}
                    className="icon-button"
                    onClick={() => onNewQuest(item.id)}
                    type="button"
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    aria-label={`配置 ${item.name}`}
                    className="icon-button"
                    onClick={() => onConfigWorkspace(item.id)}
                    type="button"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>

                {expanded ? (
                  <div className="request-list">
                    {itemQuests.length === 0 && !hasDraftRequest ? <p className="muted request-empty">暂无 Request</p> : null}
                    {hasDraftRequest ? (
                      <button
                        aria-label="新 Request 草稿"
                        className="quest-row draft active"
                        onClick={() => onNewQuest(item.id)}
                        type="button"
                      >
                        <Plus size={12} />
                        <span>新 Request</span>
                        <em className="badge">草稿</em>
                      </button>
                    ) : null}
                    {itemQuests.map((quest) => (
                      <button
                        className={`quest-row ${quest.id === selectedQuest?.id ? "active" : ""}`}
                        key={quest.id}
                        onClick={() => onSelectQuest(quest.id)}
                        type="button"
                      >
                        <Circle size={10} />
                        <span>{quest.title}</span>
                        <em className={statusClass[quest.status] ?? "badge"}>{statusLabel[quest.status]}</em>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <button className="sidebar-footer" onClick={onKnowledgeOpen} type="button">
        <BookOpen size={15} />
        <span>知识中心</span>
        <em>{knowledgeCount}</em>
      </button>
    </aside>
  );
}

function QuestStage({
  agentBackendId,
  agentBackends,
  busy,
  events,
  projects,
  quest,
  questRequirement,
  workspace,
  onBackendChange,
  onCreateQuest,
  onRequirementChange
}: {
  agentBackendId: AgentBackendId;
  agentBackends: AgentBackendInfo[];
  busy: boolean;
  events: AgentEvent[];
  projects: Project[];
  quest?: Quest;
  questRequirement: string;
  workspace: Workspace;
  onBackendChange: (backend: AgentBackendId) => void;
  onCreateQuest: (event: FormEvent) => void;
  onRequirementChange: (value: string) => void;
}) {
  const questBackend = agentBackends.find((backend) => backend.id === quest?.agentBackendId);
  const backend = questBackend ?? agentBackends.find((item) => item.id === agentBackendId);
  const chatThreadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const chatThread = chatThreadRef.current;
    if (!chatThread) {
      return;
    }
    chatThread.scrollTop = chatThread.scrollHeight;
  }, [events.length, quest?.id]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    const nextHeight = clamp(textarea.scrollHeight, 56, 180);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 180 ? "auto" : "hidden";
  }, [questRequirement]);

  return (
    <section className="quest-stage chat-stage">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Agent Chat</p>
          <h1>{quest ? quest.title : "把需求交给 Agent"}</h1>
          <div className="run-context">
            <span>{workspace.name}</span>
            <ChevronDown size={14} />
            <span>{backend?.name ?? "Mock"}</span>
            <ChevronDown size={14} />
            <span>{projects.length} project{projects.length === 1 ? "" : "s"}</span>
          </div>
        </div>
      </header>

      <div className="chat-thread" ref={chatThreadRef}>
        {!quest ? (
          <article className="chat-message assistant">
            <div className="chat-avatar">
              <Sparkles size={16} />
            </div>
            <div className="chat-bubble">
              <strong>RepoHelm Agent</strong>
              <p>描述你要完成的 request。Agent 会判断是否需要创建 Spec、worktree、执行计划和 review。</p>
            </div>
          </article>
        ) : (
          <>
            <article className="chat-message user">
              <div className="chat-bubble">
                <strong>你</strong>
                <p>{quest.requirement}</p>
              </div>
            </article>
            <article className="chat-message assistant">
              <div className="chat-avatar">
                <Bot size={16} />
              </div>
              <div className="chat-bubble">
                <strong>{backend?.name ?? "RepoHelm Agent"}</strong>
                <p>
                  Request 已进入工作流。右侧会展示 Agent 判断后生成的 Spec、执行进展、产物和 diff。
                </p>
              </div>
            </article>
            {events.map((event) => (
              <article className="chat-message assistant compact" key={event.id}>
                <div className="chat-avatar">
                  <CheckCircle2 size={15} />
                </div>
                <div className="chat-bubble">
                  <strong>{event.title}</strong>
                  <span>{event.agent}</span>
                  <p>{event.detail}</p>
                </div>
              </article>
            ))}
          </>
        )}
      </div>

      <form className="quest-composer" onSubmit={onCreateQuest}>
        <textarea
          aria-label="需求"
          placeholder="描述计划，@ 引用上下文，/ 使用命令"
          ref={textareaRef}
          value={questRequirement}
          onChange={(event) => onRequirementChange(event.target.value)}
        />
        <div className="composer-footer">
          <div className="composer-tools">
            <label className="composer-select">
              <Bot size={15} />
              <select
                aria-label="Agent Backend"
                value={agentBackendId}
                onChange={(event) => onBackendChange(event.target.value as AgentBackendId)}
              >
                {agentBackends.map((backend) => (
                  <option key={backend.id} value={backend.id}>
                    {composerBackendLabel(backend)}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="composer-select mode-select">
              <select aria-label="执行模式" defaultValue="auto">
                <option value="auto">Auto</option>
                <option value="plan">Plan</option>
                <option value="review">Review</option>
              </select>
              <ChevronDown size={14} />
            </label>
            <button aria-label="上下文清单" className="composer-icon-button" type="button">
              <ListChecks size={16} />
            </button>
          </div>
          <div className="composer-actions">
            <button aria-label="智能增强" className="spark-action" type="button">
              <Sparkles size={17} />
            </button>
            <button
              aria-label="发送给 Agent"
              className="send-button icon-send"
              disabled={busy || !questRequirement.trim()}
              type="submit"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function Inspector({
  auditLog,
  capabilities,
  changedFiles,
  events,
  projects,
  productReadiness,
  quest,
  securityPolicy,
  selectedChangedFile,
  tab,
  onAcceptCapability,
  onDismissCapability,
  onFileSelect,
  onTabChange
}: {
  auditLog: AuditLogEntry[];
  capabilities: CapabilityDefinition[];
  changedFiles: ChangedFile[];
  events: AgentEvent[];
  projects: Project[];
  productReadiness: ProductReadiness | null;
  quest?: Quest;
  securityPolicy: SecurityPolicy;
  selectedChangedFile?: ChangedFile;
  tab: InspectorTab;
  onAcceptCapability: (capabilityId: string) => void;
  onDismissCapability: (capabilityId: string) => void;
  onFileSelect: (file: ChangedFile) => void;
  onTabChange: (tab: InspectorTab) => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: "spec", label: "Spec" },
    { id: "overview", label: "概要" },
    { id: "capabilities", label: "能力" },
    { id: "security", label: "安全" },
    { id: "product", label: "产品" },
    { id: "files", label: "文件" },
    { id: "diff", label: "Diff" },
    { id: "logs", label: "日志" }
  ];

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        {tabs.map((item) => (
          <button
            className={item.id === tab ? "active" : ""}
            key={item.id}
            onClick={() => onTabChange(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        {tab === "spec" ? <SpecPanel quest={quest} /> : null}
        {tab === "overview" ? (
          <OverviewPanel changedFiles={changedFiles} events={events} projects={projects} quest={quest} />
        ) : null}
        {tab === "capabilities" ? (
          <CapabilitiesPanel
            capabilities={capabilities}
            quest={quest}
            onAcceptCapability={onAcceptCapability}
            onDismissCapability={onDismissCapability}
          />
        ) : null}
        {tab === "security" ? <SecurityPanel auditLog={auditLog} policy={securityPolicy} /> : null}
        {tab === "product" ? <ProductPanel readiness={productReadiness} /> : null}
        {tab === "files" ? (
          <FilesPanel changedFiles={changedFiles} projectById={projectById} onFileSelect={onFileSelect} />
        ) : null}
        {tab === "diff" ? <DiffPanel file={selectedChangedFile} projectById={projectById} /> : null}
        {tab === "logs" ? <Timeline events={events} /> : null}
      </div>
    </aside>
  );
}

function SpecPanel({ quest }: { quest?: Quest }) {
  if (!quest) {
    return (
      <div className="inspector-empty">
        <ShieldCheck size={18} />
        <p>Agent 会根据 request 判断是否需要创建 Spec。创建后会在这里展示。</p>
      </div>
    );
  }

  return (
    <div className="inspector-stack">
      <InspectorSection title="Agent Spec">
        <SpecBlock title="用户目标" items={[quest.spec.userGoal]} />
        <SpecBlock title="功能需求" items={quest.spec.functionalRequirements} />
        <SpecBlock title="非功能需求" items={quest.spec.nonFunctionalRequirements} />
        <SpecBlock title="验收标准" items={quest.spec.acceptanceCriteria} />
        <SpecBlock title="暂不做" items={quest.spec.outOfScope} />
      </InspectorSection>
    </div>
  );
}

function OverviewPanel({
  changedFiles,
  events,
  projects,
  quest
}: {
  changedFiles: ChangedFile[];
  events: AgentEvent[];
  projects: Project[];
  quest?: Quest;
}) {
  return (
    <div className="inspector-stack">
      <InspectorSection title="进展">
        {events.length === 0 ? <p className="muted">生成任务后会在此展示进展。</p> : null}
        {events.slice(0, 6).map((event) => (
          <div className="progress-row" key={event.id}>
            <CheckCircle2 size={14} />
            <span>{event.title}</span>
          </div>
        ))}
      </InspectorSection>
      <InspectorSection title="Worktrees">
        {quest?.worktrees.length ? (
          quest.worktrees.map((worktree) => (
            <div className="worktree-row" key={`${worktree.projectId}-${worktree.worktreePath}`}>
              <div className="worktree-title">
                <strong>{projects.find((project) => project.id === worktree.projectId)?.name ?? worktree.projectId}</strong>
                <em className={worktree.status === "created" ? "badge green" : "badge"}>{worktree.status}</em>
              </div>
              <code>{worktree.branchName}</code>
              <span>{worktree.worktreePath}</span>
            </div>
          ))
        ) : (
          <p className="muted">暂无 worktree。</p>
        )}
      </InspectorSection>
      <InspectorSection title="产物">
        {changedFiles.length === 0 ? <p className="muted">暂无产物。</p> : null}
        {changedFiles.map((file) => (
          <code key={changedFileKey(file)}>{file.path}</code>
        ))}
      </InspectorSection>
      <InspectorSection title="Review">
        <SpecBlock title="验证" items={quest?.validationResults ?? []} empty="暂无验证结果。" />
        <SpecBlock title="风险" items={quest?.reviewNotes ?? []} empty="暂无 Review 记录。" />
      </InspectorSection>
      <InspectorSection title="Delivery">
        {quest?.deliveryResults?.length ? (
          quest.deliveryResults.map((delivery) => (
            <div className="delivery-row" key={`${delivery.projectId}-${delivery.createdAt}`}>
              <div className="worktree-title">
                <strong>{projects.find((project) => project.id === delivery.projectId)?.name ?? delivery.projectId}</strong>
                <em className={delivery.status === "failed" ? "badge red" : "badge green"}>{delivery.status}</em>
              </div>
              <code>{delivery.commitMessage}</code>
              {delivery.commitSha ? <span>commit {delivery.commitSha.slice(0, 12)}</span> : null}
              {delivery.prUrl ? <span>{delivery.prUrl}</span> : null}
              <p>{delivery.note}</p>
            </div>
          ))
        ) : (
          <p className="muted">暂无交付记录。</p>
        )}
      </InspectorSection>
    </div>
  );
}

function CapabilitiesPanel({
  capabilities,
  quest,
  onAcceptCapability,
  onDismissCapability
}: {
  capabilities: CapabilityDefinition[];
  quest?: Quest;
  onAcceptCapability: (capabilityId: string) => void;
  onDismissCapability: (capabilityId: string) => void;
}) {
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const recommendations = quest?.capabilityRecommendations ?? [];

  return (
    <div className="inspector-stack">
      <InspectorSection title="Capability Agent">
        {recommendations.length === 0 ? <p className="muted">当前 Quest 暂无能力推荐。</p> : null}
        {recommendations.map((recommendation) => {
          const capability = capabilityById.get(recommendation.capabilityId);
          if (!capability) {
            return null;
          }
          return (
            <article className="capability-row" key={recommendation.capabilityId}>
              <div className="worktree-title">
                <strong>{capability.name}</strong>
                <em className={recommendation.status === "pending" ? "badge blue" : "badge green"}>
                  {recommendation.status}
                </em>
              </div>
              <p>{capability.description}</p>
              <span>{recommendation.reason}</span>
              <code>{capability.kind} · {capability.source} · confidence {Math.round(recommendation.confidence * 100)}%</code>
              <div className="capability-permissions">
                {recommendation.requiredPermissions.map((permission) => (
                  <em key={permission}>{permission}</em>
                ))}
              </div>
              {recommendation.status === "pending" ? (
                <div className="capability-actions">
                  <button className="secondary-action" onClick={() => onAcceptCapability(capability.id)} type="button">
                    确认启用
                  </button>
                  <button className="ghost-action" onClick={() => onDismissCapability(capability.id)} type="button">
                    忽略
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </InspectorSection>
      <InspectorSection title="Manifest">
        {capabilities.map((capability) => (
          <div className="manifest-row" key={capability.id}>
            <strong>{capability.name}</strong>
            <span>{capability.kind} · {capability.source}</span>
            <em className={capability.installed ? "badge green" : "badge"}>{capability.installed ? "enabled" : "available"}</em>
          </div>
        ))}
      </InspectorSection>
    </div>
  );
}

function SecurityPanel({ auditLog, policy }: { auditLog: AuditLogEntry[]; policy: SecurityPolicy }) {
  return (
    <div className="inspector-stack">
      <InspectorSection title="Permission Model">
        <div className="security-policy-grid">
          <div>
            <span>Command approval</span>
            <strong>{policy.commandApprovalMode}</strong>
          </div>
          <div>
            <span>Secrets</span>
            <strong>{policy.secretsPolicy}</strong>
          </div>
          <div>
            <span>Sandbox runtime</span>
            <strong>{policy.sandboxRuntime}</strong>
          </div>
        </div>
        <SpecBlock title="命令 allowlist" items={policy.allowedCommands} />
        <SpecBlock title="文件 scope" items={policy.fileScopes} />
        <SpecBlock title="网络 scope" items={policy.networkScopes} />
      </InspectorSection>
      <InspectorSection title="Audit Log">
        {auditLog.length === 0 ? <p className="muted">暂无审计日志。</p> : null}
        {auditLog.slice(0, 12).map((entry) => (
          <article className="audit-row" key={entry.id}>
            <div className="worktree-title">
              <strong>{entry.subject}</strong>
              <em className={entry.decision === "denied" ? "badge red" : "badge green"}>{entry.decision}</em>
            </div>
            <span>{entry.type}</span>
            <p>{entry.detail}</p>
          </article>
        ))}
      </InspectorSection>
    </div>
  );
}

function ProductPanel({ readiness }: { readiness: ProductReadiness | null }) {
  if (!readiness) {
    return <p className="muted">正在加载产品状态。</p>;
  }
  return (
    <div className="inspector-stack">
      <InspectorSection title="完整产品形态">
        <div className="product-status">
          <strong>{readiness.version}</strong>
          <span>{readiness.status}</span>
        </div>
        {readiness.milestones.map((item) => (
          <ReadinessRow item={item} key={item.id} />
        ))}
      </InspectorSection>
      <InspectorSection title="Workspace Templates">
        {readiness.workspaceTemplates.map((item) => (
          <ReadinessRow item={item} key={item.id} />
        ))}
      </InspectorSection>
      <InspectorSection title="Dependency Map">
        {readiness.dependencyMap.nodes.length === 0 ? <p className="muted">暂无项目节点。</p> : null}
        {readiness.dependencyMap.nodes.map((node) => (
          <div className="manifest-row" key={node.id}>
            <strong>{node.label}</strong>
            <span>{node.role}</span>
            <em className="badge green">node</em>
          </div>
        ))}
        {readiness.dependencyMap.edges.map((edge) => (
          <code key={`${edge.from}-${edge.to}`}>{edge.label}</code>
        ))}
      </InspectorSection>
      <InspectorSection title="Governance">
        {readiness.governance.map((item) => (
          <ReadinessRow item={item} key={item.id} />
        ))}
      </InspectorSection>
    </div>
  );
}

function ReadinessRow({ item }: { item: { label: string; status: string; detail: string } }) {
  return (
    <article className="readiness-row">
      <div className="worktree-title">
        <strong>{item.label}</strong>
        <em className={item.status === "ready" ? "badge green" : "badge"}>{item.status}</em>
      </div>
      <p>{item.detail}</p>
    </article>
  );
}

function FilesPanel({
  changedFiles,
  projectById,
  onFileSelect
}: {
  changedFiles: ChangedFile[];
  projectById: Map<string, Project>;
  onFileSelect: (file: ChangedFile) => void;
}) {
  return (
    <div className="changed-file-list">
      {changedFiles.length === 0 ? <p className="muted">运行 Quest 后会展示变更文件。</p> : null}
      {changedFiles.map((file) => (
        <button className="changed-file-row" key={changedFileKey(file)} onClick={() => onFileSelect(file)} type="button">
          <span>{projectById.get(file.projectId)?.name ?? file.projectId}</span>
          <code>{file.path}</code>
          <em>{file.status}</em>
        </button>
      ))}
    </div>
  );
}

function DiffPanel({ file, projectById }: { file?: ChangedFile; projectById: Map<string, Project> }) {
  if (!file) {
    return <p className="muted">选择文件后会在这里审查 diff。</p>;
  }
  return (
    <div className="diff-review">
      <div className="diff-meta">
        <strong>{projectById.get(file.projectId)?.name ?? file.projectId}</strong>
        <code>{file.path}</code>
      </div>
      <pre>{file.diff || "No diff content."}</pre>
    </div>
  );
}

function KnowledgePanel({ knowledge }: { knowledge: KnowledgeItem[] }) {
  return (
    <div className="knowledge-list">
      {knowledge.length === 0 ? <p className="muted">暂无知识记录。</p> : null}
      {knowledge.slice(0, 8).map((item) => (
        <article className="knowledge-row" key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.body}</span>
          {item.sourcePath ? <code>{item.sourcePath}</code> : null}
          <div>
            {item.tags.map((tag) => (
              <em key={tag}>{tag}</em>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function WorkspaceCreateDialog({
  busy,
  onClose,
  onCreateWorkspace
}: {
  busy: boolean;
  onClose: () => void;
  onCreateWorkspace: (input: { name: string; description: string; worktreeRoot: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    worktreeRoot: ""
  });

  async function submitWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      return;
    }
    await onCreateWorkspace({
      name: draft.name.trim(),
      description: draft.description.trim(),
      worktreeRoot: draft.worktreeRoot.trim()
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="workspace-create-title" className="modal-panel compact-modal" role="dialog">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2 id="workspace-create-title">创建 Workspace</h2>
          </div>
          <button aria-label="关闭 workspace 创建" className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>
        <form className="modal-body config-section" onSubmit={submitWorkspace}>
          <label>
            <span>名称</span>
            <input
              aria-label="Workspace 名称"
              placeholder="RepoHelm Product Workspace"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label>
            <span>描述</span>
            <textarea
              aria-label="Workspace 描述"
              className="compact-textarea"
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label>
            <span>Worktree Root</span>
            <input
              aria-label="Worktree Root"
              placeholder="留空使用默认目录"
              value={draft.worktreeRoot}
              onChange={(event) => setDraft((current) => ({ ...current, worktreeRoot: event.target.value }))}
            />
          </label>
          <button className="secondary-action" disabled={busy || !draft.name.trim()} type="submit">
            创建 Workspace
          </button>
        </form>
      </section>
    </div>
  );
}

function WorkspaceConfigDialog({
  busy,
  projects,
  workspace,
  onAddProject,
  onCheckProject,
  onClose,
  onRemoveProject,
  onSaveWorkspace,
  onUpdateProject
}: {
  busy: boolean;
  projects: Project[];
  workspace: Workspace;
  onAddProject: (input: {
    name: string;
    path: string;
    role: string;
    defaultBranch: string;
    validationCommand: string;
  }) => Promise<void>;
  onCheckProject: (projectId: string) => Promise<void>;
  onClose: () => void;
  onRemoveProject: (projectId: string) => Promise<void>;
  onSaveWorkspace: (input: { name: string; description: string; worktreeRoot: string }) => Promise<void>;
  onUpdateProject: (
    projectId: string,
    input: {
      name: string;
      path: string;
      role: string;
      defaultBranch: string;
      validationCommand: string;
    }
  ) => Promise<void>;
}) {
  const [workspaceDraft, setWorkspaceDraft] = useState({
    name: workspace.name,
    description: workspace.description,
    worktreeRoot: workspace.worktreeRoot
  });
  const [newProject, setNewProject] = useState({
    name: "",
    path: "",
    role: "unknown",
    defaultBranch: "main",
    validationCommand: ""
  });

  useEffect(() => {
    setWorkspaceDraft({
      name: workspace.name,
      description: workspace.description,
      worktreeRoot: workspace.worktreeRoot
    });
  }, [workspace.description, workspace.name, workspace.worktreeRoot]);

  async function submitWorkspace(event: FormEvent) {
    event.preventDefault();
    await onSaveWorkspace(workspaceDraft);
  }

  async function submitNewProject(event: FormEvent) {
    event.preventDefault();
    if (!newProject.name.trim() || !newProject.path.trim()) {
      return;
    }
    await onAddProject({
      ...newProject,
      name: newProject.name.trim(),
      path: newProject.path.trim(),
      defaultBranch: newProject.defaultBranch.trim() || "main"
    });
    setNewProject({
      name: "",
      path: "",
      role: "unknown",
      defaultBranch: "main",
      validationCommand: ""
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="workspace-config-title" className="modal-panel" role="dialog">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Workspace Config</p>
            <h2 id="workspace-config-title">{workspace.name}</h2>
          </div>
          <button aria-label="关闭 workspace 配置" className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>
        <div className="modal-body">
          <form className="config-section" onSubmit={submitWorkspace}>
            <h3>Workspace</h3>
            <div className="config-grid">
              <label>
                <span>名称</span>
                <input
                  aria-label="Workspace 名称"
                  value={workspaceDraft.name}
                  onChange={(event) => setWorkspaceDraft((draft) => ({ ...draft, name: event.target.value }))}
                />
              </label>
              <label>
                <span>Worktree Root</span>
                <input
                  aria-label="Worktree Root"
                  value={workspaceDraft.worktreeRoot}
                  onChange={(event) => setWorkspaceDraft((draft) => ({ ...draft, worktreeRoot: event.target.value }))}
                />
              </label>
            </div>
            <label>
              <span>描述</span>
              <textarea
                aria-label="Workspace 描述"
                className="compact-textarea"
                value={workspaceDraft.description}
                onChange={(event) => setWorkspaceDraft((draft) => ({ ...draft, description: event.target.value }))}
              />
            </label>
            <button className="secondary-action" disabled={busy || !workspaceDraft.name.trim()} type="submit">
              保存 Workspace
            </button>
          </form>

          <section className="config-section">
            <h3>关联项目</h3>
            {projects.length === 0 ? <p className="muted">暂无关联项目。</p> : null}
            {projects.map((project) => (
              <ProjectConfigForm
                busy={busy}
                key={project.id}
                project={project}
                onCheckProject={onCheckProject}
                onRemoveProject={onRemoveProject}
                onUpdateProject={onUpdateProject}
              />
            ))}
          </section>

          <form className="config-section add-project-form" onSubmit={submitNewProject}>
            <h3>新增项目</h3>
            <ProjectFields draft={newProject} onDraftChange={setNewProject} />
            <button className="secondary-action" disabled={busy || !newProject.name.trim() || !newProject.path.trim()} type="submit">
              添加项目
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function ProjectConfigForm({
  busy,
  project,
  onCheckProject,
  onRemoveProject,
  onUpdateProject
}: {
  busy: boolean;
  project: Project;
  onCheckProject: (projectId: string) => Promise<void>;
  onRemoveProject: (projectId: string) => Promise<void>;
  onUpdateProject: (
    projectId: string,
    input: {
      name: string;
      path: string;
      role: string;
      defaultBranch: string;
      validationCommand: string;
    }
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    name: project.name,
    path: project.path,
    role: project.role,
    defaultBranch: project.defaultBranch,
    validationCommand: project.validationCommand
  });

  useEffect(() => {
    setDraft({
      name: project.name,
      path: project.path,
      role: project.role,
      defaultBranch: project.defaultBranch,
      validationCommand: project.validationCommand
    });
  }, [project.defaultBranch, project.name, project.path, project.role, project.validationCommand]);

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    await onUpdateProject(project.id, {
      ...draft,
      name: draft.name.trim(),
      path: draft.path.trim(),
      defaultBranch: draft.defaultBranch.trim() || "main"
    });
  }

  return (
    <form className="project-config-card" onSubmit={submitProject}>
      <div className="project-config-heading">
        <div>
          <strong>{project.name}</strong>
          <span className={`health-pill ${project.health.status}`}>{project.health.status}</span>
        </div>
        <p>{project.health.message}</p>
      </div>
      <ProjectFields draft={draft} onDraftChange={setDraft} />
      <div className="project-config-actions">
        <button className="secondary-action" disabled={busy || !draft.name.trim() || !draft.path.trim()} type="submit">
          保存项目
        </button>
        <button className="ghost-action" disabled={busy} onClick={() => onCheckProject(project.id)} type="button">
          检查状态
        </button>
        <button className="danger-action" disabled={busy} onClick={() => onRemoveProject(project.id)} type="button">
          移除
        </button>
      </div>
    </form>
  );
}

function ProjectFields({
  draft,
  onDraftChange
}: {
  draft: {
    name: string;
    path: string;
    role: string;
    defaultBranch: string;
    validationCommand: string;
  };
  onDraftChange: (draft: {
    name: string;
    path: string;
    role: string;
    defaultBranch: string;
    validationCommand: string;
  }) => void;
}) {
  return (
    <div className="project-fields">
      <label>
        <span>名称</span>
        <input
          aria-label="项目名称"
          value={draft.name}
          onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label>
        <span>路径</span>
        <input
          aria-label="项目路径"
          value={draft.path}
          onChange={(event) => onDraftChange({ ...draft, path: event.target.value })}
        />
      </label>
      <label>
        <span>角色</span>
        <select
          aria-label="项目角色"
          value={draft.role}
          onChange={(event) => onDraftChange({ ...draft, role: event.target.value })}
        >
          <option value="unknown">unknown</option>
          <option value="frontend">frontend</option>
          <option value="backend">backend</option>
          <option value="documentation">documentation</option>
          <option value="library">library</option>
          <option value="infra">infra</option>
        </select>
      </label>
      <label>
        <span>默认分支</span>
        <input
          aria-label="默认分支"
          value={draft.defaultBranch}
          onChange={(event) => onDraftChange({ ...draft, defaultBranch: event.target.value })}
        />
      </label>
      <label className="full-field">
        <span>验证命令</span>
        <input
          aria-label="验证命令"
          placeholder="pnpm test"
          value={draft.validationCommand}
          onChange={(event) => onDraftChange({ ...draft, validationCommand: event.target.value })}
        />
      </label>
    </div>
  );
}

function KnowledgeDialog({
  knowledge,
  workspace,
  onClose
}: {
  knowledge: KnowledgeItem[];
  workspace: Workspace;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(knowledge);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setResults(knowledge);
  }, [knowledge]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    try {
      setResults(await api.searchKnowledge(workspace.id, query));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="knowledge-title" className="modal-panel knowledge-modal" role="dialog">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Knowledge Center</p>
            <h2 id="knowledge-title">知识中心</h2>
          </div>
          <button aria-label="关闭知识中心" className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>
        <div className="modal-body">
          <form className="knowledge-search" onSubmit={submitSearch}>
            <input
              aria-label="搜索知识"
              placeholder="搜索 memory、project summary 或 architecture"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="secondary-action" disabled={searching} type="submit">
              搜索
            </button>
          </form>
          <KnowledgePanel knowledge={results} />
        </div>
      </section>
    </div>
  );
}

function InspectorSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Timeline({ events }: { events: AgentEvent[] }) {
  return (
    <div className="timeline">
      {events.length === 0 ? <p className="muted">暂无执行事件。</p> : null}
      {events.map((event) => (
        <article className="timeline-item" key={event.id}>
          <div className="timeline-dot" />
          <div>
            <strong>{event.title}</strong>
            <span>{event.agent}</span>
            <p>{event.detail}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function SpecBlock({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  return (
    <div className="spec-block">
      <h4>{title}</h4>
      {items.length === 0 ? <p className="muted">{empty ?? "暂无内容。"}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function normalizeChangedFile(file: ChangedFile | string): ChangedFile {
  if (typeof file === "string") {
    return {
      projectId: "unknown",
      path: file,
      status: "unknown",
      diff: "",
      worktreePath: ""
    };
  }
  return file;
}

function changedFileKey(file?: ChangedFile) {
  if (!file) {
    return "";
  }
  return `${file.projectId}:${file.path}`;
}

function deriveRequestTitle(requirement: string) {
  const firstLine = requirement
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return "Untitled Request";
  }
  return firstLine.length > 42 ? `${firstLine.slice(0, 42)}...` : firstLine;
}

function composerBackendLabel(backend: AgentBackendInfo) {
  const labels: Record<AgentBackendId, string> = {
    mock: "智能体",
    "codex-cli": "Codex",
    "claude-code": "Claude Code",
    opencode: "OpenCode",
    "openai-compatible": "OpenAI-compatible"
  };
  return labels[backend.id] ?? backend.name;
}
