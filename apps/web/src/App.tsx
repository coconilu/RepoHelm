import {
  BookOpen,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  FolderOpen,
  GitPullRequest,
  ListChecks,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Route,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
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
  ByokConfig,
  ChangedFile,
  CapabilityDefinition,
  CliTestResult,
  EngineConfig,
  KnowledgeItem,
  CliModelOption,
  LocalCliInfo,
  Project,
  ProductReadiness,
  ProviderId,
  Quest,
  RepoHelmState,
  SecurityPolicy,
  Workspace
} from "./api";
import { motion } from "motion/react";
import { CommandPalette } from "./components/CommandPalette";
import { Select } from "./components/Select";

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
type SettingsTab = "repositories" | "models";

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
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document !== "undefined") {
      const current = document.documentElement.getAttribute("data-theme");
      if (current === "light" || current === "dark") {
        return current;
      }
    }
    return "dark";
  });
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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("repohelm-theme", theme);
    } catch {
      // Ignore unavailable storage (private mode, etc.).
    }
  }, [theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const workspace = useMemo(
    () => state?.workspaces.find((item) => item.id === selectedWorkspaceId) ?? state?.workspaces[0],
    [selectedWorkspaceId, state?.workspaces]
  );
  const configWorkspace = useMemo(
    () => state?.workspaces.find((item) => item.id === workspaceConfigId) ?? workspace,
    [state?.workspaces, workspace, workspaceConfigId]
  );
  const projects = useMemo(
    () => state?.projects.filter((project) => workspace?.projectIds.includes(project.id)) ?? [],
    [state?.projects, workspace?.projectIds]
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
      await api.runQuest(quest.id);
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

  async function linkProject(projectId: string) {
    if (!configWorkspace) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.linkProject(configWorkspace.id, projectId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlinkProject(projectId: string) {
    if (!configWorkspace) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.unlinkProject(configWorkspace.id, projectId);
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

  async function openProjectDirectory(projectId: string) {
    setError("");
    try {
      await api.openProjectDirectory(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          <button
            aria-label={theme === "dark" ? "切换到浅色" : "切换到深色"}
            className="toolbar-icon-button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            type="button"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button aria-label="打开设置" className="toolbar-icon-button" onClick={() => setAppSettingsOpen(true)} type="button">
            <Settings size={16} />
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
          onDeliverQuest={deliverQuest}
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

      {appSettingsOpen ? (
        <AppSettingsDialog
          busy={busy}
          projects={state.projects}
          onAddProject={async (input) => {
            setBusy(true);
            setError("");
            try {
              await api.createProject(input);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          onCheckProject={checkProject}
          onClose={() => setAppSettingsOpen(false)}
          onOpenProjectDirectory={openProjectDirectory}
          onRemoveProject={removeProject}
        />
      ) : null}

      {workspaceConfigOpen && configWorkspace ? (
        <WorkspaceConfigDialog
          busy={busy}
          projects={state.projects}
          workspace={configWorkspace}
          onClose={() => setWorkspaceConfigOpen(false)}
          onLinkProject={linkProject}
          onSaveWorkspace={saveWorkspaceConfig}
          onUnlinkProject={unlinkProject}
        />
      ) : null}

      {knowledgeOpen ? (
        <KnowledgeDialog
          knowledge={knowledge}
          workspace={workspace}
          onClose={() => setKnowledgeOpen(false)}
        />
      ) : null}

      <CommandPalette
        open={commandOpen}
        theme={theme}
        workspaces={state.workspaces}
        onClose={() => setCommandOpen(false)}
        onNewRequest={() => {
          setSelectedWorkspaceId(workspace.id);
          setSelectedQuestId("");
          setDraftWorkspaceId(workspace.id);
          setQuestRequirement("");
          setExpandedWorkspaceIds((current) => (current.includes(workspace.id) ? current : [...current, workspace.id]));
          setInspectorTab("spec");
        }}
        onSelectWorkspace={(workspaceId) => {
          setSelectedWorkspaceId(workspaceId);
          setSelectedQuestId("");
          setDraftWorkspaceId("");
          setQuestRequirement("");
          setInspectorTab("spec");
          setExpandedWorkspaceIds((current) => (current.includes(workspaceId) ? current : [...current, workspaceId]));
        }}
        onCreateWorkspace={() => setWorkspaceCreateOpen(true)}
        onOpenSettings={() => setAppSettingsOpen(true)}
        onOpenKnowledge={() => setKnowledgeOpen(true)}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
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
                  <button
                    className="workspace-title-button"
                    onClick={() => {
                      onSelectWorkspace(item.id);
                      onToggleWorkspace(item.id);
                    }}
                    type="button"
                  >
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
  onDeliverQuest,
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
  onDeliverQuest: () => void;
  onRequirementChange: (value: string) => void;
}) {
  const questBackend = agentBackends.find((backend) => backend.id === quest?.agentBackendId);
  const backend = questBackend ?? agentBackends.find((item) => item.id === agentBackendId);
  const chatThreadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState("auto");

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
        {quest ? (
          <button className="request-delivery-action" disabled={busy} onClick={onDeliverQuest} type="button">
            <GitPullRequest size={15} />
            <span>交付</span>
          </button>
        ) : null}
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
            <Select
              variant="inline"
              ariaLabel="Agent Backend"
              leadingIcon={<Bot size={15} />}
              value={agentBackendId}
              onValueChange={(value) => onBackendChange(value as AgentBackendId)}
              options={agentBackends.map((item) => ({ value: item.id, label: composerBackendLabel(item) }))}
            />
            <div className="composer-divider">
              <Select
                variant="inline"
                ariaLabel="执行模式"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "plan", label: "Plan" },
                  { value: "review", label: "Review" }
                ]}
              />
            </div>
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
          quest.worktrees.map((worktree, index) => (
            <motion.div
              className="worktree-row"
              key={`${worktree.projectId}-${worktree.worktreePath}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: Math.min(index * 0.05, 0.3), ease: [0.22, 0.61, 0.36, 1] }}
            >
              <div className="worktree-title">
                <strong>{projects.find((project) => project.id === worktree.projectId)?.name ?? worktree.projectId}</strong>
                <em className={worktree.status === "created" ? "badge green" : "badge"}>{worktree.status}</em>
              </div>
              <code>{worktree.branchName}</code>
              <span>{worktree.worktreePath}</span>
            </motion.div>
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
      {changedFiles.map((file, index) => (
        <motion.button
          className="changed-file-row"
          key={changedFileKey(file)}
          onClick={() => onFileSelect(file)}
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, delay: Math.min(index * 0.04, 0.3), ease: [0.22, 0.61, 0.36, 1] }}
        >
          <span>{projectById.get(file.projectId)?.name ?? file.projectId}</span>
          <code>{file.path}</code>
          <em>{file.status}</em>
        </motion.button>
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

function AppSettingsDialog({
  busy,
  projects,
  onAddProject,
  onCheckProject,
  onClose,
  onOpenProjectDirectory,
  onRemoveProject
}: {
  busy: boolean;
  projects: Project[];
  onAddProject: (input: {
    name: string;
    path: string;
    role: string;
    defaultBranch: string;
    validationCommand: string;
  }) => Promise<void>;
  onCheckProject: (projectId: string) => Promise<void>;
  onClose: () => void;
  onOpenProjectDirectory: (projectId: string) => Promise<void>;
  onRemoveProject: (projectId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<SettingsTab>("repositories");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [clis, setClis] = useState<LocalCliInfo[]>([]);
  const [engine, setEngine] = useState<EngineConfig | null>(null);
  const [scanning, setScanning] = useState(false);
  const [testingId, setTestingId] = useState("");
  const [testResult, setTestResult] = useState<CliTestResult | null>(null);
  const [byokDraft, setByokDraft] = useState<ByokConfig>({
    provider: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.1-codex",
    apiKey: ""
  });
  const [providerId, setProviderId] = useState<ProviderId>("openai");
  const [providerModels, setProviderModels] = useState<CliModelOption[]>([]);
  const [modelsMeta, setModelsMeta] = useState<{ live: boolean; detail: string } | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    path: "",
    role: "unknown",
    defaultBranch: "main",
    validationCommand: ""
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listClis(), api.getEngine()])
      .then(([cliList, eng]) => {
        if (cancelled) {
          return;
        }
        setClis(cliList);
        setEngine(eng);
        setByokDraft(eng.byok);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function patchEngine(input: Partial<Omit<EngineConfig, "updatedAt">> & { byok?: Partial<ByokConfig> }) {
    const next = await api.updateEngine(input);
    setEngine(next);
    setByokDraft(next.byok);
  }

  async function rescanClis() {
    setScanning(true);
    try {
      setClis(await api.rescanClis());
    } finally {
      setScanning(false);
    }
  }

  async function testCli(id: string) {
    setTestingId(id);
    setTestResult(null);
    try {
      setTestResult(await api.testCli(id));
    } finally {
      setTestingId("");
    }
  }

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    const path = newProject.path.trim();
    if (!path) {
      return;
    }
    await onAddProject({
      ...newProject,
      name: newProject.name.trim() || basenameFromPath(path),
      path,
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

  const providerOptions: Array<{ id: ProviderId; label: string; baseUrl: string; model: string }> = [
    { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
    { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
    { id: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-pro" },
    { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o" },
    { id: "openai-compatible", label: "Ollama / 兼容", baseUrl: "http://127.0.0.1:11434/v1", model: "" }
  ];

  async function loadProviderModels(target: ProviderId, options: { refresh?: boolean } = {}) {
    setLoadingModels(true);
    try {
      const result = await api.listProviderModels(target, {
        baseUrl: byokDraft.baseUrl,
        apiKey: byokDraft.apiKey,
        refresh: options.refresh
      });
      setProviderModels(result.models);
      setModelsMeta({ live: result.live, detail: result.detail });
    } catch {
      setProviderModels([]);
      setModelsMeta({ live: false, detail: "拉取模型失败,请检查 Base URL 和 API Key。" });
    } finally {
      setLoadingModels(false);
    }
  }

  // Infer the provider id from the saved BYOK base URL, then load its models (cached).
  useEffect(() => {
    if (engine?.mode !== "byok") {
      return;
    }
    const matched = providerOptions.find((option) => byokDraft.baseUrl.startsWith(option.baseUrl));
    const next = matched?.id ?? "openai-compatible";
    setProviderId(next);
    void loadProviderModels(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine?.mode]);

  const modelSelectOptions = (() => {
    const options = providerModels.map((model) => ({ value: model.id, label: model.label }));
    if (byokDraft.model && !options.some((option) => option.value === byokDraft.model)) {
      options.unshift({ value: byokDraft.model, label: `${byokDraft.model}(当前)` });
    }
    return options;
  })();

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="app-settings-title" className="modal-panel settings-modal" role="dialog">
        <header className="modal-header">
          <div>
            <p className="eyebrow">RepoHelm Settings</p>
            <h2 id="app-settings-title">设置</h2>
          </div>
          <button aria-label="关闭设置" className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>
        <div className="settings-tabs" role="tablist" aria-label="设置分类">
          <button className={tab === "repositories" ? "active" : ""} onClick={() => setTab("repositories")} role="tab" type="button">
            仓库管理
          </button>
          <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")} role="tab" type="button">
            执行模式
          </button>
        </div>
        <div className="modal-body settings-body">
          {tab === "repositories" ? (
            <section className="config-section">
            <div className="settings-section-heading">
              <h3>仓库管理</h3>
              <span>{projects.length} repos</span>
            </div>
            <p className="muted">仓库是全局的,可在任意 workspace 中关联使用。</p>
            <form className="settings-add-project" onSubmit={submitProject}>
              <ProjectFields
                draft={newProject}
                onDraftChange={(draft) => setNewProject((current) => ({ ...current, ...draft }))}
              />
              <button
                className="secondary-action"
                disabled={busy || !newProject.path.trim()}
                type="submit"
              >
                添加目录
              </button>
            </form>
            {projects.length === 0 ? <p className="muted">暂无仓库。</p> : null}
            <div className="settings-project-list">
              {projects.map((project) => (
                <article className="settings-project-row" key={project.id}>
                  <div>
                    <strong>{project.name}</strong>
                    <code>{project.path}</code>
                  </div>
                  <div className="settings-meta">
                    <span>{project.defaultBranch}</span>
                    <span className={`health-pill ${project.health.status}`}>{project.health.status}</span>
                  </div>
                  <div className="settings-row-actions">
                    <button className="ghost-action" disabled={busy} onClick={() => onCheckProject(project.id)} type="button">
                      <RefreshCw size={14} />
                      <span>检查状态</span>
                    </button>
                    <button className="ghost-action" onClick={() => onOpenProjectDirectory(project.id)} type="button">
                      <FolderOpen size={14} />
                      <span>打开目录</span>
                    </button>
                    <button className="danger-action" disabled={busy} onClick={() => onRemoveProject(project.id)} type="button">
                      <Trash2 size={14} />
                      <span>删除</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          ) : null}

          {tab === "models" ? (
            <section className="config-section">
              <p className="muted">在本机 CLI 与 BYOK 之间选择。</p>
              <div className="seg-control" role="tablist" aria-label="执行模式">
                <button
                  className={engine?.mode === "cli" ? "active" : ""}
                  role="tab"
                  type="button"
                  onClick={() => patchEngine({ mode: "cli" })}
                >
                  本机 CLI
                </button>
                <button
                  className={engine?.mode === "byok" ? "active" : ""}
                  role="tab"
                  type="button"
                  onClick={() => patchEngine({ mode: "byok", byok: byokDraft })}
                >
                  BYOK
                </button>
              </div>

              {engine?.mode === "byok" ? (
                <div className="model-config-panel">
                  <div className="settings-section-heading">
                    <h3>API Provider</h3>
                    <span>BYOK</span>
                  </div>
                  <div className="provider-quick-fill" role="tablist" aria-label="Provider 快速填充">
                    {providerOptions.map((provider) => (
                      <button
                        className={providerId === provider.id ? "active" : ""}
                        key={provider.id}
                        onClick={() => {
                          setProviderId(provider.id);
                          setByokDraft((current) => ({
                            ...current,
                            provider: provider.label,
                            baseUrl: provider.baseUrl,
                            model: provider.model
                          }));
                          void loadProviderModels(provider.id);
                        }}
                        type="button"
                      >
                        {provider.label}
                      </button>
                    ))}
                  </div>
                  <div className="model-config-grid">
                    <label>
                      <span>API Key</span>
                      <span className="secret-field">
                        <input
                          aria-label="API Key"
                          placeholder="sk-..."
                          type={apiKeyVisible ? "text" : "password"}
                          value={byokDraft.apiKey}
                          onChange={(event) => setByokDraft((current) => ({ ...current, apiKey: event.target.value }))}
                        />
                        <button onClick={() => setApiKeyVisible((current) => !current)} type="button">
                          {apiKeyVisible ? "隐藏" : "显示"}
                        </button>
                      </span>
                    </label>
                    <label>
                      <span>Base URL</span>
                      <input
                        aria-label="Base URL"
                        value={byokDraft.baseUrl}
                        onChange={(event) => setByokDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>
                        Model · {loadingModels ? "拉取中…" : modelsMeta?.live ? "实时列表" : "内置列表"}
                      </span>
                      <div className="model-picker-row">
                        <Select
                          ariaLabel="模型"
                          value={byokDraft.model}
                          placeholder={loadingModels ? "拉取中…" : "选择或在下方手动输入"}
                          options={modelSelectOptions}
                          onValueChange={(model) => setByokDraft((current) => ({ ...current, model }))}
                        />
                        <button
                          className="ghost-action"
                          disabled={loadingModels}
                          onClick={() => loadProviderModels(providerId, { refresh: true })}
                          type="button"
                        >
                          <RefreshCw size={14} className={loadingModels ? "spin" : undefined} />
                          <span>{loadingModels ? "刷新中…" : "刷新模型"}</span>
                        </button>
                      </div>
                    </label>
                    <label>
                      <span>手动指定(可选)</span>
                      <input
                        aria-label="手动模型"
                        placeholder="如 gpt-4o-2024-11-20"
                        value={byokDraft.model}
                        onChange={(event) => setByokDraft((current) => ({ ...current, model: event.target.value }))}
                      />
                    </label>
                  </div>
                  {modelsMeta ? <p className="field-hint">{modelsMeta.detail}</p> : null}
                  <div className="project-config-actions">
                    <button
                      className="secondary-action"
                      disabled={busy}
                      onClick={() => patchEngine({ mode: "byok", byok: byokDraft })}
                      type="button"
                    >
                      保存 BYOK 配置
                    </button>
                  </div>
                  <p className="field-hint">
                    API Key 保存在本机 SQLite 状态中,仅用于直连对应 Provider 拉取模型与本地调用。
                  </p>
                </div>
              ) : (
                <>
                  <p className="muted">选择用来运行提示词的 CLI。</p>
                  <div className="settings-section-heading">
                    <h3>你的 CLI ({clis.filter((cli) => cli.available).length})</h3>
                    <button className="ghost-action" disabled={scanning} onClick={rescanClis} type="button">
                      <RefreshCw size={14} className={scanning ? "spin" : undefined} />
                      <span>{scanning ? "扫描中…" : "重新扫描"}</span>
                    </button>
                  </div>
                  {clis.length === 0 ? <p className="muted">正在检测本机 CLI…</p> : null}
                  <div className="cli-list">
                    {clis.map((cli) => {
                      const selected = engine?.cliId === cli.id;
                      const selectedModel = engine?.cliModels[cli.id] ?? "default";
                      return (
                        <div key={cli.id}>
                          <article
                            className={`cli-card${selected ? " selected" : ""}${cli.available ? "" : " unavailable"}`}
                          >
                            <button className="cli-card-main" onClick={() => patchEngine({ mode: "cli", cliId: cli.id })} type="button">
                              <div className="cli-card-title">
                                <strong>{cli.name}</strong>
                                <span className="cli-tagline">· {cli.tagline}</span>
                              </div>
                              <span className="cli-version">{cli.available ? cli.version ?? cli.bin : "未检测到"}</span>
                            </button>
                            <button
                              className="cli-test-button"
                              disabled={!cli.available || testingId === cli.id}
                              onClick={() => testCli(cli.id)}
                              type="button"
                            >
                              {testingId === cli.id ? "测试中…" : "测试"}
                            </button>
                          </article>
                          {selected ? (
                            <div className="cli-card-body">
                              <label>
                                <span>模型 · {cli.modelsLive ? "实时列表" : "内置列表"}</span>
                                <Select
                                  ariaLabel={`${cli.name} 模型`}
                                  value={selectedModel}
                                  onValueChange={(model) => patchEngine({ mode: "cli", cliId: cli.id, cliModels: { [cli.id]: model } })}
                                  options={cli.models.map((model) => ({ value: model.id, label: model.label }))}
                                />
                              </label>
                              <span className="field-hint">{cli.detail}</span>
                            </div>
                          ) : null}
                          {testResult && testResult.id === cli.id ? (
                            <div className={`cli-test-banner${testResult.ok ? " ok" : " fail"}`}>{testResult.message}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function WorkspaceConfigDialog({
  busy,
  projects,
  workspace,
  onClose,
  onLinkProject,
  onSaveWorkspace,
  onUnlinkProject
}: {
  busy: boolean;
  projects: Project[];
  workspace: Workspace;
  onClose: () => void;
  onLinkProject: (projectId: string) => Promise<void>;
  onSaveWorkspace: (input: { name: string; description: string; worktreeRoot: string }) => Promise<void>;
  onUnlinkProject: (projectId: string) => Promise<void>;
}) {
  const [workspaceDraft, setWorkspaceDraft] = useState({
    name: workspace.name,
    description: workspace.description,
    worktreeRoot: workspace.worktreeRoot
  });
  const [linkTarget, setLinkTarget] = useState("");

  useEffect(() => {
    setWorkspaceDraft({
      name: workspace.name,
      description: workspace.description,
      worktreeRoot: workspace.worktreeRoot
    });
  }, [workspace.description, workspace.name, workspace.worktreeRoot]);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const linkedIds = new Set(workspace.projectIds);
  const linkableProjects = projects.filter((project) => !linkedIds.has(project.id));

  useEffect(() => {
    setLinkTarget((current) =>
      current && linkableProjects.some((project) => project.id === current) ? current : linkableProjects[0]?.id ?? ""
    );
  }, [linkableProjects]);

  async function submitWorkspace(event: FormEvent) {
    event.preventDefault();
    await onSaveWorkspace(workspaceDraft);
  }

  async function submitLink(event: FormEvent) {
    event.preventDefault();
    if (!linkTarget) {
      return;
    }
    await onLinkProject(linkTarget);
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
            <div className="settings-section-heading">
              <h3>关联仓库</h3>
              <span>{workspace.worktrees.length} worktrees</span>
            </div>
            <form className="settings-add-project" onSubmit={submitLink}>
              <label>
                <span>从仓库管理选择</span>
                <Select
                  ariaLabel="选择要关联的仓库"
                  disabled={linkableProjects.length === 0}
                  placeholder="没有可关联的仓库"
                  value={linkTarget}
                  onValueChange={setLinkTarget}
                  options={linkableProjects.map((project) => ({
                    value: project.id,
                    label: `${project.name} · ${project.defaultBranch}`
                  }))}
                />
              </label>
              <button className="secondary-action" disabled={busy || !linkTarget} type="submit">
                关联并 checkout worktree
              </button>
            </form>

            {workspace.worktrees.length === 0 ? <p className="muted">暂无关联仓库。</p> : null}
            <div className="settings-project-list">
              {workspace.worktrees.map((worktree) => {
                const project = projectById.get(worktree.projectId);
                return (
                  <article className="settings-project-row" key={worktree.projectId}>
                    <div>
                      <strong>{project?.name ?? worktree.projectId}</strong>
                      <code>{worktree.worktreePath}</code>
                    </div>
                    <div className="settings-meta">
                      <span>{worktree.branchName}</span>
                      <span>base: {worktree.baseBranch}</span>
                      <span className={`health-pill ${worktree.status === "created" ? "ok" : "invalid"}`}>
                        {worktree.status}
                      </span>
                    </div>
                    <div className="settings-row-actions">
                      <button
                        className="danger-action"
                        disabled={busy}
                        onClick={() => onUnlinkProject(worktree.projectId)}
                        type="button"
                      >
                        <Trash2 size={14} />
                        <span>删除</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function basenameFromPath(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

interface ProjectDraft {
  name: string;
  path: string;
  role: string;
  defaultBranch: string;
  validationCommand: string;
}

function ProjectFields({
  draft,
  onDraftChange
}: {
  draft: ProjectDraft;
  onDraftChange: (draft: ProjectDraft) => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const path = draft.path.trim();
    if (!path) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    api
      .listBranches(path)
      .then((result) => {
        if (!cancelled) {
          setBranches(result.branches);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranches([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draft.path]);

  async function choosePath() {
    setPicking(true);
    try {
      const result = await api.pickDirectory();
      if (!result.path) {
        return;
      }
      const path = result.path;
      const branchInfo = await api
        .listBranches(path)
        .catch(() => ({ branches: [] as string[], defaultBranch: "main" }));
      setBranches(branchInfo.branches);
      onDraftChange({
        ...draft,
        path,
        name: draft.name.trim() || basenameFromPath(path),
        defaultBranch: branchInfo.defaultBranch || "main"
      });
    } finally {
      setPicking(false);
    }
  }

  const branchOptions = Array.from(
    new Set(["main", "master", draft.defaultBranch, ...branches].map((branch) => branch.trim()).filter(Boolean))
  );

  return (
    <div className="project-fields">
      <label className="full-field">
        <span>路径</span>
        <span className="path-field">
          <input
            aria-label="项目路径"
            placeholder="点击选择仓库目录，或粘贴绝对路径"
            value={draft.path}
            onChange={(event) => onDraftChange({ ...draft, path: event.target.value })}
          />
          <button className="ghost-action" disabled={picking} onClick={choosePath} type="button">
            <FolderOpen size={14} />
            <span>{picking ? "选择中…" : "选择路径"}</span>
          </button>
        </span>
      </label>
      <label className="full-field">
        <span>默认分支</span>
        <Select
          ariaLabel="默认分支"
          value={draft.defaultBranch}
          onValueChange={(branch) => onDraftChange({ ...draft, defaultBranch: branch })}
          options={branchOptions.map((branch) => ({ value: branch, label: branch }))}
        />
        <span className="field-hint">默认分支会作为 worktree 和知识库的 base。</span>
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
      {events.map((event, index) => (
        <motion.article
          className="timeline-item"
          key={event.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.32), ease: [0.22, 0.61, 0.36, 1] }}
        >
          <div className="timeline-dot" />
          <div>
            <strong>{event.title}</strong>
            <span>{event.agent}</span>
            <p>{event.detail}</p>
          </div>
        </motion.article>
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
