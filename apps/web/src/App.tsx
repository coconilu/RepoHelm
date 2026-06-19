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
  MessageSquare,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AgentBackendId,
  AgentBackendInfo,
  AgentEvent,
  api,
  streamQuestSpec,
  AuditLogEntry,
  ByokConfig,
  ChangedFile,
  CapabilityDefinition,
  CliTestResult,
  CommandApproval,
  CommandApprovalScope,
  CreateModelKitInput,
  CreateSubAgentInput,
  EngineConfig,
  ExpertSession,
  ExpertTask,
  AcceptanceTest,
  CodeResearchResult,
  TaskArtifact,
  KnowledgeItem,
  CliModelOption,
  LocalCliInfo,
  ModelKit,
  OrchestrationPlan,
  Project,
  ProductReadiness,
  ProviderId,
  Quest,
  RepoHelmState,
  RepoWikiPage,
  SecurityPolicy,
  SubAgent,
  TestModelInput,
  UpdateModelKitInput,
  UpdateSubAgentInput,
  Workspace
} from "./api";
import { motion } from "motion/react";
import { CommandPalette } from "./components/CommandPalette";
import { Select } from "./components/Select";
import { KnowledgeCenter } from "./components/KnowledgeCenter";
import { OrchestrationPanel } from "./components/OrchestrationPanel";
import { ProgressPanel } from "./components/ProgressPanel";
import { AcceptancePanel } from "./components/AcceptancePanel";
import { DeliverablesPanel } from "./components/DeliverablesPanel";
import { ReferencesPanel } from "./components/ReferencesPanel";
import { ResearchPanel } from "./components/ResearchPanel";

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

type InspectorTab = "spec" | "plan" | "overview" | "capabilities" | "files" | "diff" | "orchestration" | "progress" | "acceptance" | "deliverables" | "references" | "research";
type ResizeDivider = "sidebar" | "inspector";
type SettingsTab = "repositories" | "models" | "modelkits" | "subagents" | "security";

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
  const [selectedEntrySubAgentId, setSelectedEntrySubAgentId] = useState<string>("");
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
  const [pendingAction, setPendingAction] = useState<string>("");
  const [pendingRequirement, setPendingRequirement] = useState<string>("");
  const [streamingAnalysis, setStreamingAnalysis] = useState<string>("");
  // Tracks the quest whose spec stream is currently active, so createQuest's own
  // stream and the resume-on-select effect never double-subscribe the same quest.
  const streamingQuestIdRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [expertSession, setExpertSession] = useState<ExpertSession | null>(null);

  async function handleConfirmExpertSession() {
    if (!expertSession) return;
    setPendingAction("专家团正在执行...");
    try {
      const result = await api.confirmExpertSession(expertSession.id);
      setExpertSession(result.session);
      setInspectorTab("progress");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction("");
    }
  }
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

  // Resume spec streaming for a quest left in "specifying" (e.g. the page was refreshed
  // or navigated away mid-stream), so it never gets stuck on the placeholder spec.
  useEffect(() => {
    if (busy) return; // createQuest is driving its own stream; don't race on the quests[0] fallback
    if (!selectedQuest || selectedQuest.status !== "specifying") return;
    if (streamingQuestIdRef.current === selectedQuest.id) return; // createQuest or a prior resume owns it
    const questId = selectedQuest.id;
    streamingQuestIdRef.current = questId;
    setStreamingAnalysis("");
    const close = streamQuestSpec(questId, {
      onAnalysis: (text) => setStreamingAnalysis((prev) => prev + text),
      onSpecReady: () => { void load(); },
      onEvent: () => { void load(); },
      onDone: () => { streamingQuestIdRef.current = null; setStreamingAnalysis(""); void load(); },
      onError: () => { streamingQuestIdRef.current = null; setStreamingAnalysis(""); }
    });
    return () => {
      close();
      if (streamingQuestIdRef.current === questId) streamingQuestIdRef.current = null;
    };
    // load is intentionally excluded: it is re-created each render and would thrash the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuest?.id, selectedQuest?.status, busy]);
  const knowledge = state?.knowledge.filter((item) => item.workspaceId === workspace?.id) ?? [];
  const changedFiles = selectedQuest?.changedFiles.map((file) => normalizeChangedFile(file)) ?? [];
  const selectedChangedFile =
    changedFiles.find((file) => changedFileKey(file) === selectedChangedFileKey) ?? changedFiles[0];
  const activeBackend = agentBackends.find((backend) => backend.id === agentBackendId);
  // The pill should reflect what actually answers: the entry agent + its model.
  const activeEntryAgentGlobal = state?.entrySubAgentId ? state.subAgents[state.entrySubAgentId] : undefined;
  const activeEntryModelKit = activeEntryAgentGlobal
    ? state?.engine.modelKits[activeEntryAgentGlobal.modelKitId]
    : undefined;
  const enginePillLabel = activeEntryAgentGlobal
    ? `${activeEntryAgentGlobal.name}${activeEntryModelKit ? ` · ${activeEntryModelKit.model || activeEntryModelKit.name}` : ""}`
    : activeBackend?.name ?? "未配置 Agent";
  const entrySubAgents = useMemo(() => {
    const all = state?.subAgents ? Object.values(state.subAgents) : [];
    return all.filter((agent) => agent.mode === "entry").sort((a, b) => a.name.localeCompare(b.name));
  }, [state?.subAgents]);

  useEffect(() => {
    if (entrySubAgents.length === 0) {
      setSelectedEntrySubAgentId("");
      return;
    }
    const preferred = state?.entrySubAgentId;
    const preferredStillValid = entrySubAgents.some((agent) => agent.id === preferred);
    if (preferredStillValid && preferred) {
      setSelectedEntrySubAgentId(preferred);
    } else if (!entrySubAgents.some((agent) => agent.id === selectedEntrySubAgentId)) {
      setSelectedEntrySubAgentId(entrySubAgents[0].id);
    }
  }, [entrySubAgents, state?.entrySubAgentId, selectedEntrySubAgentId]);

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
    // Clear the composer immediately on send; keep an optimistic copy for the bubble.
    setQuestRequirement("");
    setPendingRequirement(trimmedRequirement);
    try {
      setPendingAction("正在创建 Quest...");
      const quest = await api.createQuest({
        workspaceId: workspace.id,
        title: deriveRequestTitle(trimmedRequirement),
        requirement: trimmedRequirement,
        agentBackendId,
        entrySubAgentId: selectedEntrySubAgentId || undefined
      });
      setSelectedQuestId(quest.id);
      // Stream the spec generation: analysis text流式呈现，事件逐条落库刷新。
      // Claim ownership so the resume-on-select effect skips this quest.
      streamingQuestIdRef.current = quest.id;
      setPendingAction("正在分析需求并生成 Spec...");
      setStreamingAnalysis("");
      await new Promise<void>((resolve) => {
        streamQuestSpec(quest.id, {
          onAnalysis: (text) => setStreamingAnalysis((prev) => prev + text),
          onSpecReady: () => { void load(); },
          onEvent: () => { void load(); },
          onDone: () => { streamingQuestIdRef.current = null; setStreamingAnalysis(""); resolve(); },
          onError: () => { streamingQuestIdRef.current = null; setStreamingAnalysis(""); resolve(); }
        });
      });
      const latestState = await api.state();
      setState(latestState);
      const latestQuest = latestState.quests.find((item) => item.id === quest.id);
      if (latestQuest?.status === "cancelled") {
        setDraftWorkspaceId("");
        setInspectorTab("overview");
        return;
      }
      setPendingAction("Supervisor 正在生成编排计划...");
      await api.runQuest(quest.id);
      // 同时创建专家团 session（fake mode 下自动生成任务树）
      try {
        const result = await api.createExpertSession({
          questId: quest.id,
          requirement: trimmedRequirement,
          entryAgentId: selectedEntrySubAgentId || "supervisor",
        });
        setExpertSession(result.session);
        setInspectorTab("orchestration");
      } catch { /* expert session creation is optional */ }
      await load();
      setDraftWorkspaceId("");
      setInspectorTab("plan");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Restore the text so the user doesn't lose their input on failure.
      setQuestRequirement(trimmedRequirement);
    } finally {
      setBusy(false);
      setPendingAction("");
      setPendingRequirement("");
      setStreamingAnalysis("");
    }
  }

  async function deliverQuest() {
    if (!selectedQuest) {
      return;
    }
    setBusy(true);
    setError("");
    setPendingAction("正在验证、提交并准备 PR handoff...");
    try {
      await api.deliverQuest(selectedQuest.id);
      await load();
      setInspectorTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPendingAction("");
    }
  }

  async function approvePlan() {
    if (!selectedQuest) return;
    setBusy(true);
    setError("");
    setPendingAction("计划已批准，Agent 正在执行步骤...");
    try {
      await api.approvePlan(selectedQuest.id);
      await load();
      setInspectorTab("plan");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPendingAction("");
    }
  }

  async function cancelQuest() {
    if (!selectedQuest) return;
    setError("");
    setPendingAction("正在取消当前运行...");
    try {
      await api.cancelQuest(selectedQuest.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPendingAction("");
    }
  }

  async function rejectPlan() {
    if (!selectedQuest) return;
    setBusy(true);
    setError("");
    setPendingAction("正在拒绝计划...");
    try {
      await api.rejectPlan(selectedQuest.id);
      await load();
      setInspectorTab("plan");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPendingAction("");
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
          <span
            className={activeEntryModelKit || activeBackend?.available ? "backend-pill available" : "backend-pill"}
            title="当前执行 Agent 与模型"
          >
            <Bot size={14} />
            {enginePillLabel}
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
          knowledgeCount={state.projects.filter((p) => p.knowledge?.status === "ready" || p.knowledge?.status === "stale").length}
          quests={state.quests}
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
            setKnowledgeOpen(false);
            setSelectedWorkspaceId(workspaceId);
            setSelectedQuestId("");
            setDraftWorkspaceId(workspaceId);
            setQuestRequirement("");
            setExpandedWorkspaceIds((current) => (current.includes(workspaceId) ? current : [...current, workspaceId]));
            setInspectorTab("spec");
          }}
          onSelectQuest={(questId, workspaceId) => {
            setKnowledgeOpen(false);
            setSelectedWorkspaceId(workspaceId);
            setSelectedQuestId(questId);
            setDraftWorkspaceId("");
            setInspectorTab("spec");
            setExpandedWorkspaceIds((current) => (current.includes(workspaceId) ? current : [...current, workspaceId]));
          }}
          onSelectWorkspace={(workspaceId) => {
            setKnowledgeOpen(false);
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
              agentBackendId={agentBackendId}
              agentBackends={agentBackends}
              busy={busy}
              entrySubAgents={entrySubAgents}
              events={questEvents}
              pendingAction={pendingAction}
              pendingRequirement={pendingRequirement}
              streamingAnalysis={streamingAnalysis}
              projects={projects}
              quest={selectedQuest}
              questRequirement={questRequirement}
              selectedEntrySubAgentId={selectedEntrySubAgentId}
              workspace={workspace}
              onApprovePlan={approvePlan}
              onCancelQuest={cancelQuest}
              onEntrySubAgentChange={setSelectedEntrySubAgentId}
              onCreateQuest={createQuest}
              onDeliverQuest={deliverQuest}
              onRejectPlan={rejectPlan}
              onRequirementChange={setQuestRequirement}
            />
            <div
              aria-label="调整右侧栏宽度"
              className="resize-handle resize-handle-right"
              onPointerDown={(event) => startColumnResize("inspector", event)}
              role="separator"
            />
            <Inspector
              busy={busy}
              capabilities={state.capabilities}
              changedFiles={changedFiles}
              events={questEvents}
              expertSession={expertSession}
              projects={projects}
              quest={selectedQuest}
              selectedChangedFile={selectedChangedFile}
              tab={inspectorTab}
              onApprovePlan={approvePlan}
              onConfirmExpertSession={handleConfirmExpertSession}
              onRejectPlan={rejectPlan}
              onFileSelect={(file) => {
                setSelectedChangedFileKey(changedFileKey(file));
                setInspectorTab("diff");
              }}
              onTabChange={setInspectorTab}
            />
          </>
        )}
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
              const created = await api.createProject(input);
              await api.checkProject(created.id).catch(() => undefined);
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
          onRefreshAll={async () => {
            await load();
          }}
          onRemoveProject={removeProject}
          onSetBusy={setBusy}
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
  onSelectQuest: (questId: string, workspaceId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleWorkspace: (workspaceId: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-topbar">
        <button className="new-quest-button" onClick={onCreateWorkspace} type="button">
          <Plus size={16} />
          <span>创建 Workspace</span>
        </button>
        <button
          aria-label={`打开知识中心，${knowledgeCount} 个项目已有知识库`}
          className="sidebar-knowledge-button"
          onClick={onKnowledgeOpen}
          title="知识中心"
          type="button"
        >
          <BookOpen size={16} />
          <em>{knowledgeCount}</em>
        </button>
      </div>

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
                        onClick={() => onSelectQuest(quest.id, quest.workspaceId)}
                        type="button"
                      >
                        <Circle size={10} />
                        <span className="quest-row-main">
                          <span className="quest-row-title">{quest.title}</span>
                          <time className="quest-row-time" dateTime={quest.createdAt}>
                            {formatQuestStamp(quest.createdAt)}
                          </time>
                        </span>
                        <em className={statusClass[quest.status] ?? "badge"}>
                          {quest.status === "planning" && quest.planApproval?.status === "pending"
                            ? "待确认"
                            : statusLabel[quest.status]}
                        </em>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

    </aside>
  );
}

// Event types that are internal/backend plumbing — useful for debugging
// but not meaningful to end users. Filtered out of the chat thread.
const INTERNAL_EVENT_TYPES = new Set([
  "agent.backend.started",
  "agent.backend.completed",
  "agent.backend.failed",
  "agent.backend.blocked",
  "agent.byok.call",
  "agent.cli.call",
  "agent.provider.completed",
  "agent.provider.failed",
  "agent.artifacts.standardized",
  "implementation.changed_files"
]);

/** Icon per structured agent-event type, so the Quest timeline distinguishes
 *  file edits, command/test output and tool calls at a glance. */
function eventIcon(type: string) {
  switch (type) {
    case "agent.file_change":
      return <Pencil size={15} />;
    case "agent.command":
      return <Terminal size={15} />;
    case "agent.tool_call":
      return <Wrench size={15} />;
    case "agent.message":
      return <MessageSquare size={15} />;
    default:
      return <CheckCircle2 size={15} />;
  }
}

function QuestStage({
  agentBackendId,
  agentBackends,
  busy,
  entrySubAgents,
  events,
  pendingAction,
  pendingRequirement,
  streamingAnalysis,
  projects,
  quest,
  questRequirement,
  selectedEntrySubAgentId,
  workspace,
  onApprovePlan,
  onCancelQuest,
  onEntrySubAgentChange,
  onCreateQuest,
  onDeliverQuest,
  onRejectPlan,
  onRequirementChange
}: {
  agentBackendId: AgentBackendId;
  agentBackends: AgentBackendInfo[];
  busy: boolean;
  entrySubAgents: SubAgent[];
  events: AgentEvent[];
  pendingAction: string;
  pendingRequirement: string;
  streamingAnalysis: string;
  projects: Project[];
  quest?: Quest;
  questRequirement: string;
  selectedEntrySubAgentId: string;
  workspace: Workspace;
  onApprovePlan: () => void;
  onCancelQuest: () => void;
  onEntrySubAgentChange: (id: string) => void;
  onCreateQuest: (event: FormEvent) => void;
  onDeliverQuest: () => void;
  onRejectPlan: () => void;
  onRequirementChange: (value: string) => void;
}) {
  const questBackend = agentBackends.find((backend) => backend.id === quest?.agentBackendId);
  const activeEntryAgent =
    entrySubAgents.find((agent) => agent.id === selectedEntrySubAgentId) ??
    entrySubAgents.find((agent) => agent.id === quest?.entrySubAgentId) ??
    entrySubAgents[0];
  const [contextListToast, setContextListToast] = useState<string>("");
  const [enhancing, setEnhancing] = useState(false);
  const chatThreadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Streaming "thinking" bubble shown while Spec Agent analyzes the requirement.
  const analysisBubble = streamingAnalysis ? (
    <article className="chat-message assistant compact">
      <div className="chat-avatar">
        <RefreshCw size={15} className="spin" />
      </div>
      <div className="chat-bubble">
        <strong>Spec Agent 正在分析…</strong>
        <span>Spec Agent</span>
        <p style={{ whiteSpace: "pre-wrap" }}>{streamingAnalysis}</p>
      </div>
    </article>
  ) : null;

  async function enhanceRequirement() {
    const text = questRequirement.trim();
    if (!text || enhancing || busy) {
      return;
    }
    setEnhancing(true);
    setContextListToast("正在智能增强需求…");
    try {
      const { requirement } = await api.enhanceRequirement(text);
      onRequirementChange(requirement);
      setContextListToast("需求已增强");
    } catch (err) {
      setContextListToast(err instanceof Error ? err.message : "智能增强失败");
    } finally {
      setEnhancing(false);
      window.setTimeout(() => setContextListToast(""), 3000);
    }
  }

  const affectedProjectCount = quest ? quest.affectedProjectIds.length : projects.length;
  const canDeliver = Boolean(quest && quest.changedFiles.length > 0);
  const canCancel = Boolean(quest && busy && pendingAction && pendingAction !== "正在拒绝计划...");

  useEffect(() => {
    const chatThread = chatThreadRef.current;
    if (!chatThread) {
      return;
    }
    chatThread.scrollTop = chatThread.scrollHeight;
  }, [events.length, quest?.id, pendingAction]);

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
            <span>{activeEntryAgent?.name ?? (questBackend?.name ?? "未选择 Agent")}</span>
            <ChevronDown size={14} />
            <span>{affectedProjectCount} project{affectedProjectCount === 1 ? "" : "s"}</span>
          </div>
        </div>
        {quest ? (
          <div className="chat-header-actions">
            {canCancel ? (
              <button
                className="ghost-action"
                onClick={onCancelQuest}
                type="button"
              >
                <X size={15} />
                <span>取消</span>
              </button>
            ) : null}
            <button
              className="request-delivery-action"
              disabled={busy || !canDeliver}
              title={canDeliver ? "提交变更并准备 PR handoff" : "没有可交付的文件变更"}
              onClick={onDeliverQuest}
              type="button"
            >
              <GitPullRequest size={15} />
              <span>交付</span>
            </button>
          </div>
        ) : null}
      </header>

      <div className="chat-thread" ref={chatThreadRef}>
        {!quest ? (
          <>
            <article className="chat-message assistant">
              <div className="chat-avatar">
                <Sparkles size={16} />
              </div>
              <div className="chat-bubble">
                <strong>RepoHelm Agent</strong>
                <p>描述你要完成的 request。Supervisor 会把任务分派给合适的 worker sub-agent 来完成。</p>
              </div>
            </article>
            {pendingAction ? (
              <>
                <article className="chat-message user">
                  <div className="chat-bubble">
                    <strong>你</strong>
                    <p>{pendingRequirement || questRequirement || "..."}</p>
                  </div>
                </article>
                <article className="chat-message assistant compact">
                  <div className="chat-avatar">
                    <RefreshCw size={15} className="spin" />
                  </div>
                  <div className="chat-bubble">
                    <strong>工作中</strong>
                    <span>RepoHelm Agent</span>
                    <p>{pendingAction}</p>
                  </div>
                </article>
                {analysisBubble}
              </>
            ) : null}
          </>
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
                <strong>{activeEntryAgent?.name ?? "RepoHelm Agent"}</strong>
                <p>
                  Request 已进入工作流。右侧会展示 Supervisor 分派进展、Spec、执行产物和 diff。
                </p>
              </div>
            </article>
            {analysisBubble}
            {[...events]
              .filter((event) => !INTERNAL_EVENT_TYPES.has(event.type))
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((event) => (
                <article className="chat-message assistant compact" key={event.id}>
                  <div className="chat-avatar">
                    {eventIcon(event.type)}
                  </div>
                  <div className="chat-bubble">
                    <strong>{event.title}</strong>
                    <span>{event.agent}</span>
                    <p>{event.detail}</p>
                  </div>
                </article>
              ))}
            {quest.planApproval?.status === "pending" && !pendingAction ? (
              <article className="chat-message assistant compact">
                <div className="chat-avatar">
                  <Route size={15} />
                </div>
                <div className="chat-bubble">
                  <strong>编排计划已生成</strong>
                  <span>Supervisor</span>
                  <p>请在右侧 Plan 面板查看执行步骤并确认（Approve &amp; Execute / Reject）。</p>
                </div>
              </article>
            ) : null}
            {pendingAction ? (
              <article className="chat-message assistant compact">
                <div className="chat-avatar">
                  <RefreshCw size={15} className="spin" />
                </div>
                <div className="chat-bubble">
                  <strong>工作中</strong>
                  <span>RepoHelm Agent</span>
                  <p>{pendingAction}</p>
                </div>
              </article>
            ) : null}
          </>
        )}
      </div>

      <form className="quest-composer" onSubmit={onCreateQuest}>
        <textarea
          aria-label="需求"
          id="quest-requirement"
          name="quest-requirement"
          placeholder="描述计划，@ 引用上下文，/ 使用命令"
          ref={textareaRef}
          value={questRequirement}
          onChange={(event) => onRequirementChange(event.target.value)}
        />
        {contextListToast ? (
          <div
            aria-live="polite"
            className="composer-toast"
            role="status"
          >
            {contextListToast}
          </div>
        ) : null}
        <div className="composer-footer">
          <div className="composer-tools">
            {entrySubAgents.length > 0 ? (
              <Select
                variant="inline"
                ariaLabel="入口 Agent"
                leadingIcon={<Bot size={15} />}
                value={selectedEntrySubAgentId || entrySubAgents[0]?.id || ""}
                onValueChange={onEntrySubAgentChange}
                options={entrySubAgents.map((agent) => ({ value: agent.id, label: agent.name }))}
              />
            ) : (
              <span className="composer-empty-agent" title="请先在设置里配置 BYOK 或创建入口 Agent">
                <Bot size={15} />
                <span>未配置 Agent</span>
              </span>
            )}
            <button
              aria-label="上下文清单"
              className="composer-icon-button"
              type="button"
              onClick={() => {
                setContextListToast("暂无附加上下文，用 @ 引用文件或符号");
                window.setTimeout(() => setContextListToast(""), 2500);
              }}
            >
              <ListChecks size={16} />
            </button>
          </div>
          <div className="composer-actions">
            <button
              aria-label="智能增强"
              className="spark-action"
              type="button"
              disabled={enhancing || busy || !questRequirement.trim() || entrySubAgents.length === 0}
              title="用模型把需求改写得更清晰"
              onClick={enhanceRequirement}
            >
              {enhancing ? <RefreshCw size={17} className="spin" /> : <Sparkles size={17} />}
            </button>
            <button
              aria-label="发送给 Agent"
              className="send-button icon-send"
              disabled={busy || !questRequirement.trim() || entrySubAgents.length === 0}
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
  busy,
  capabilities,
  changedFiles,
  events,
  expertSession,
  projects,
  quest,
  selectedChangedFile,
  tab,
  onApprovePlan,
  onConfirmExpertSession,
  onFileSelect,
  onRejectPlan,
  onTabChange
}: {
  busy: boolean;
  capabilities: CapabilityDefinition[];
  changedFiles: ChangedFile[];
  events: AgentEvent[];
  expertSession: ExpertSession | null;
  projects: Project[];
  quest?: Quest;
  selectedChangedFile?: ChangedFile;
  tab: InspectorTab;
  onApprovePlan: () => void;
  onConfirmExpertSession?: () => void;
  onFileSelect: (file: ChangedFile) => void;
  onRejectPlan: () => void;
  onTabChange: (tab: InspectorTab) => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));

  // Determine which tabs have content
  const hasSpec = !!quest?.spec;
  const hasPlan = !!quest?.planApproval;
  const hasCapabilities = capabilities.length > 0;
  const hasFiles = changedFiles.length > 0;
  const hasDiff = !!selectedChangedFile;

  // Build visible tabs list (dynamic display)
  const allTabs: Array<{ id: InspectorTab; label: string }> = [
    { id: "overview", label: "概要" },
    { id: "spec", label: "Spec" },
    { id: "plan", label: "Plan" },
    { id: "capabilities", label: "能力" },
    { id: "files", label: "文件" },
    { id: "diff", label: "Diff" },
    { id: "orchestration", label: "编排" },
    { id: "progress", label: "进展" },
    { id: "acceptance", label: "验收" },
    { id: "deliverables", label: "产物" },
    { id: "references", label: "引用" },
    { id: "research", label: "研究" }
  ];

  const visibleTabs = allTabs.filter((tabItem) => {
    switch (tabItem.id) {
      case "overview":
        return true; // Always visible
      case "spec":
        return hasSpec;
      case "plan":
        return hasPlan;
      case "capabilities":
        return hasCapabilities;
      case "files":
        return hasFiles;
      case "diff":
        return hasDiff;
      case "orchestration":
      case "progress":
      case "acceptance":
      case "deliverables":
      case "references":
      case "research":
        return !!expertSession; // Expert tabs only visible when expert session exists
      default:
        return false;
    }
  });

  // Auto-select first visible tab if current tab has no content
  const effectiveTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id || "overview";

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        {visibleTabs.map((item) => (
          <button
            className={item.id === effectiveTab ? "active" : ""}
            key={item.id}
            onClick={() => onTabChange(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        {effectiveTab === "overview" ? (
          <OverviewPanel projects={projects} quest={quest} />
        ) : null}
        {effectiveTab === "spec" && hasSpec ? <SpecPanel quest={quest} /> : null}
        {effectiveTab === "plan" && hasPlan ? (
          <PlanPanel busy={busy} quest={quest} onApprovePlan={onApprovePlan} onRejectPlan={onRejectPlan} />
        ) : null}
        {effectiveTab === "capabilities" && hasCapabilities ? (
          <CapabilitiesPanel capabilities={capabilities} quest={quest} />
        ) : null}
        {effectiveTab === "files" && hasFiles ? (
          <FilesPanel changedFiles={changedFiles} projectById={projectById} quest={quest} onFileSelect={onFileSelect} />
        ) : null}
        {effectiveTab === "diff" && hasDiff ? (
          <DiffPanel file={selectedChangedFile} projectById={projectById} quest={quest} />
        ) : null}
        {effectiveTab === "orchestration" && expertSession ? (
          <OrchestrationPanel session={expertSession} />
        ) : null}
        {effectiveTab === "progress" && expertSession ? (
          <ProgressPanel tasks={expertSession.flatTasks} />
        ) : null}
        {effectiveTab === "acceptance" && expertSession ? (
          <AcceptancePanel tests={expertSession.acceptanceTests} onConfirmAll={onConfirmExpertSession} />
        ) : null}
        {effectiveTab === "deliverables" && expertSession ? (
          <DeliverablesPanel tasks={expertSession.flatTasks} />
        ) : null}
        {effectiveTab === "references" && expertSession ? (
          <ReferencesPanel research={expertSession.research} />
        ) : null}
        {effectiveTab === "research" && expertSession ? (
          <ResearchPanel research={expertSession.research} />
        ) : null}
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

function PlanPanel({ busy, quest, onApprovePlan, onRejectPlan }: { busy: boolean; quest?: Quest; onApprovePlan: () => void; onRejectPlan: () => void }) {
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!quest?.planPath) {
      setPlan(null);
      return;
    }
    setLoading(true);
    api.getQuestPlan(quest.id)
      .then((p) => setPlan(p))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [quest?.id, quest?.planPath]);

  if (!quest) {
    return (
      <div className="inspector-empty">
        <Route size={18} />
        <p>运行 Quest 后会生成编排计划，在此查看和确认。</p>
      </div>
    );
  }

  if (loading) {
    return <div className="inspector-stack"><p className="muted">加载编排计划中...</p></div>;
  }

  if (error) {
    return <div className="inspector-stack"><p className="muted">{error}</p></div>;
  }

  if (!plan) {
    return (
      <div className="inspector-stack">
        <p className="muted">
          {quest.planApproval?.status === "pending"
            ? "正在生成编排计划..."
            : "暂无编排计划。点击 Run 后 Supervisor 会生成计划。"}
        </p>
      </div>
    );
  }

  const isPending = quest.planApproval?.status === "pending";

  return (
    <div className="inspector-stack">
      <InspectorSection title="编排计划">
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)" }}>{plan.summary}</p>
        {plan.steps.map((step, index) => (
          <div key={step.id} style={{ padding: "8px 0", borderBottom: index < plan.steps.length - 1 ? "1px solid var(--border)" : undefined }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>
              {index + 1}. {step.description}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              Agent: {step.agentName}
              {step.dependencies.length > 0 ? ` · 依赖: ${step.dependencies.join(", ")}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
              预期输出: {step.contract?.outputFormat || step.expectedOutput}
            </div>
            {step.contract?.boundaries ? (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                边界: {step.contract.boundaries}
              </div>
            ) : null}
            {step.contract?.sourcesGuidance ? (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                信息源: {step.contract.sourcesGuidance}
              </div>
            ) : null}
            {step.contract?.doneCriteria ? (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                完成判据: {step.contract.doneCriteria}
              </div>
            ) : null}
          </div>
        ))}
        {plan.notes ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-tertiary)" }}>
            <strong>备注:</strong> {plan.notes}
          </div>
        ) : null}
      </InspectorSection>
      {isPending ? (
        <InspectorSection title="确认计划">
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px" }}>
            确认编排计划后，Agent 将按步骤执行。
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="secondary-action"
              disabled={busy}
              onClick={onApprovePlan}
              type="button"
            >
              {busy ? "执行中..." : <><CheckCircle2 size={14} /> Approve & Execute</>}
            </button>
            {!busy ? (
              <button className="ghost-action" onClick={onRejectPlan} type="button">
                <X size={14} /> Reject
              </button>
            ) : null}
          </div>
        </InspectorSection>
      ) : null}
      {quest.planApproval?.status === "approved" ? (
        <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--green)" }}>
          Plan approved at {quest.planApproval.approvedAt}
        </div>
      ) : null}
      {quest.planApproval?.status === "rejected" ? (
        <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--red)" }}>
          Plan rejected{quest.planApproval.rejectionReason ? `: ${quest.planApproval.rejectionReason}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function OverviewPanel({
  projects,
  quest
}: {
  projects: Project[];
  quest?: Quest;
}) {
  const [relatedKnowledge, setRelatedKnowledge] = useState<RepoWikiPage[]>([]);

  // Fetch related knowledge pages
  useEffect(() => {
    if (quest?.relatedKnowledgeIds && quest.relatedKnowledgeIds.length > 0) {
      api.getKnowledgePages(quest.relatedKnowledgeIds).then(setRelatedKnowledge).catch(() => setRelatedKnowledge([]));
    } else {
      setRelatedKnowledge([]);
    }
  }, [quest?.relatedKnowledgeIds]);

  // Get affected projects
  const affectedProjects = quest?.affectedProjectIds.map((pid) => ({
    project: projects.find((p) => p.id === pid),
    worktree: quest.worktrees.find((w) => w.projectId === pid)
  })) ?? [];

  return (
    <div className="inspector-stack">
      <InspectorSection title="受影响项目">
        {affectedProjects.length === 0 ? (
          <p className="muted">暂未关联项目。</p>
        ) : (
          affectedProjects.map(({ project, worktree }) => (
            <div className="context-project" key={project?.id ?? "unknown"}>
              <div className="worktree-title">
                <strong>{project?.name ?? "Unknown"}</strong>
                {worktree ? <em className="badge green">worktree 就绪</em> : <em className="badge">待创建</em>}
              </div>
            </div>
          ))
        )}
      </InspectorSection>
      <InspectorSection title="关联知识">
        {relatedKnowledge.length === 0 ? (
          <p className="muted">暂无关联知识。</p>
        ) : (
          relatedKnowledge.map((page) => {
            // Strip HTML tags and truncate for a clean one-line description.
            const plainText = page.body.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
            const summary = plainText.length > 80 ? `${plainText.slice(0, 80)}…` : plainText;
            return (
              <div className="context-knowledge" key={page.id}>
                <div className="worktree-title">
                  <strong>{page.title}</strong>
                </div>
                <span className="muted">{summary || "(无摘要)"}</span>
              </div>
            );
          })
        )}
      </InspectorSection>
      {(quest?.validationResults?.length || quest?.reviewNotes?.length) ? (
        <InspectorSection title="审查">
          <SpecBlock title="验证" items={quest?.validationResults ?? []} empty="暂无验证结果。" />
          <SpecBlock title="风险" items={quest?.reviewNotes ?? []} empty="暂无审查记录。" />
        </InspectorSection>
      ) : null}
      {quest?.deliveryResults?.length ? (
        <InspectorSection title="交付">
          {quest.deliveryResults.map((delivery) => (
            <div className="delivery-row" key={`${delivery.projectId}-${delivery.createdAt}`}>
              <div className="worktree-title">
                <strong>{projects.find((project) => project.id === delivery.projectId)?.name ?? delivery.projectId}</strong>
                <em className={delivery.status === "failed" ? "badge red" : "badge green"}>{delivery.status}</em>
              </div>
              {delivery.commitMessage ? <p>{delivery.commitMessage}</p> : null}
              {delivery.prUrl ? <span>{delivery.prUrl}</span> : null}
              {delivery.note ? <p>{delivery.note}</p> : null}
            </div>
          ))}
        </InspectorSection>
      ) : null}
    </div>
  );
}

function CapabilitiesPanel({
  capabilities,
  quest
}: {
  capabilities: CapabilityDefinition[];
  quest?: Quest;
}) {
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const recommendations = quest?.capabilityRecommendations ?? [];

  return (
    <div className="inspector-stack">
      <InspectorSection title="本 Quest 使用的能力">
        {recommendations.length === 0 ? (
          <p className="muted">本 Quest 暂未匹配到额外能力，将使用默认能力执行。</p>
        ) : null}
        {recommendations.map((recommendation) => {
          const capability = capabilityById.get(recommendation.capabilityId);
          if (!capability) {
            return null;
          }
          return (
            <article className="capability-row" key={recommendation.capabilityId}>
              <div className="worktree-title">
                <strong>{capability.name}</strong>
              </div>
              <p>{capability.description}</p>
              <span>{recommendation.reason}</span>
              <code>{capability.kind} · {capability.source} · 匹配度 {Math.round(recommendation.confidence * 100)}%</code>
              <div className="capability-permissions">
                {recommendation.requiredPermissions.map((permission) => (
                  <em key={permission}>{permission}</em>
                ))}
              </div>
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


/** A quest has executed once its plan was approved (or it reached a post-run status). */
function questHasExecuted(quest?: Quest): boolean {
  if (!quest) {
    return false;
  }
  if (quest.planApproval?.status === "approved") {
    return true;
  }
  return ["validating", "reviewing", "ready", "delivered", "blocked"].includes(quest.status);
}

function FilesPanel({
  changedFiles,
  projectById,
  quest,
  onFileSelect
}: {
  changedFiles: ChangedFile[];
  projectById: Map<string, Project>;
  quest?: Quest;
  onFileSelect: (file: ChangedFile) => void;
}) {
  return (
    <div className="changed-file-list">
      {changedFiles.length === 0 ? (
        <p className="muted">
          {questHasExecuted(quest) ? "本次执行没有产生文件变更。" : "运行 Quest 后会展示变更文件。"}
        </p>
      ) : null}
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

function DiffPanel({ file, projectById, quest }: { file?: ChangedFile; projectById: Map<string, Project>; quest?: Quest }) {
  if (!file) {
    return (
      <p className="muted">
        {questHasExecuted(quest) ? "本次执行没有产生文件变更，暂无 diff。" : "运行 Quest 并产生变更后，在此审查 diff。"}
      </p>
    );
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
  onRefreshAll,
  onRemoveProject,
  onSetBusy
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
  onRefreshAll: () => Promise<void>;
  onRemoveProject: (projectId: string) => Promise<void>;
  onSetBusy: (value: boolean) => void;
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
  const [byokTesting, setByokTesting] = useState(false);
  const [byokTestResult, setByokTestResult] = useState<CliTestResult | null>(null);
  const [newProject, setNewProject] = useState({
    name: "",
    path: "",
    role: "unknown",
    defaultBranch: "main",
    validationCommand: ""
  });
  // ModelKit management state
  const [modelKits, setModelKits] = useState<ModelKit[]>([]);
  const [savingAsKit, setSavingAsKit] = useState<{
    type: "cli" | "byok";
    backendId?: string;
    providerId?: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  } | null>(null);
  const [kitDraft, setKitDraft] = useState({
    name: ""
  });
  const [editingKit, setEditingKit] = useState<ModelKit | null>(null);
  const [kitError, setKitError] = useState("");
  
  // Sub-agent management state
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [entrySubAgentId, setEntrySubAgentId] = useState<string | undefined>();
  const [creatingSubAgent, setCreatingSubAgent] = useState(false);
  const [editingSubAgent, setEditingSubAgent] = useState<SubAgent | null>(null);
  const [subAgentError, setSubAgentError] = useState("");
  const [securityPolicy, setSecurityPolicy] = useState<SecurityPolicy | null>(null);
  const [commandApprovals, setCommandApprovals] = useState<CommandApproval[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [securityDraft, setSecurityDraft] = useState({
    allowedCommands: "",
    commandTemplates: "",
    fileScopes: "",
    networkScopes: ""
  });
  const [securityError, setSecurityError] = useState("");

  const repoAutoCheckedRef = useRef(false);

  useEffect(() => {
    repoAutoCheckedRef.current = false;
  }, []);

  useEffect(() => {
    if (tab !== "repositories" || repoAutoCheckedRef.current || busy || projects.length === 0) return;
    repoAutoCheckedRef.current = true;
    (async () => {
      onSetBusy(true);
      try {
        for (const project of projects) {
          await api.checkProject(project.id).catch(() => undefined);
        }
        await onRefreshAll();
      } finally {
        onSetBusy(false);
      }
    })();
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listClis(),
      api.getEngine(),
      api.listModelKits(),
      api.listSubAgents(),
      api.getEntrySubAgent(),
      api.securityPolicy(),
      api.commandApprovals(),
      api.auditLog()
    ])
      .then(([cliList, eng, kits, agents, entryAgent, policy, approvals, auditEntries]) => {
        if (cancelled) {
          return;
        }
        setClis(cliList);
        setEngine(eng);
        setModelKits(kits);
        setSubAgents(agents);
        setEntrySubAgentId(entryAgent?.id);
        setSecurityPolicy(policy);
        setSecurityDraft({
          allowedCommands: formatListDraft(policy.allowedCommands),
          commandTemplates: formatListDraft(policy.commandTemplates),
          fileScopes: formatListDraft(policy.fileScopes),
          networkScopes: formatListDraft(policy.networkScopes)
        });
        setCommandApprovals(approvals);
        setAuditLog(auditEntries);
        const activeId = eng.activeByokProviderId;
        const savedConfig = eng.byokProviders[activeId];
        setProviderId(activeId as ProviderId);
        setByokDraft(
          savedConfig ?? {
            provider: providerOptions.find((p) => p.id === activeId)?.label ?? "OpenAI",
            baseUrl: providerOptions.find((p) => p.id === activeId)?.baseUrl ?? "https://api.openai.com/v1",
            model: providerOptions.find((p) => p.id === activeId)?.model ?? "",
            apiKey: ""
          }
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function patchEngine(input: Partial<Omit<EngineConfig, "updatedAt">>) {
    const next = await api.updateEngine(input);
    setEngine(next);
    const activeId = next.activeByokProviderId;
    const savedConfig = next.byokProviders[activeId];
    if (savedConfig) {
      setByokDraft(savedConfig);
    }
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

  // Auto-scan when switching to the models tab.
  useEffect(() => {
    if (tab !== "models" || !engine) {
      return;
    }
    if (engine.mode === "cli") {
      void rescanClis();
    } else if (engine.mode === "byok") {
      void loadProviderModels(providerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, engine?.mode]);

  async function testByok() {
    setByokTesting(true);
    setByokTestResult(null);
    try {
      setByokTestResult(await api.testProvider(providerId, { baseUrl: byokDraft.baseUrl, apiKey: byokDraft.apiKey }));
    } catch (error) {
      setByokTestResult({
        id: providerId,
        ok: false,
        latencyMs: 0,
        message: error instanceof Error ? error.message : "测试失败。"
      });
    } finally {
      setByokTesting(false);
    }
  }

  const modelSelectOptions = (() => {
    const options = providerModels.map((model) => ({ value: model.id, label: model.label }));
    if (byokDraft.model && !options.some((option) => option.value === byokDraft.model)) {
      options.unshift({ value: byokDraft.model, label: `${byokDraft.model}(当前)` });
    }
    return options;
  })();

  // ModelKit management functions
  async function saveAsModelKit(event: FormEvent) {
    event.preventDefault();
    if (!savingAsKit || !kitDraft.name.trim()) {
      return;
    }
    onSetBusy(true);
    setKitError("");
    try {
      const input: TestModelInput = {
        type: savingAsKit.type,
        backendId: savingAsKit.backendId,
        providerId: savingAsKit.providerId,
        model: savingAsKit.model,
        apiKey: savingAsKit.apiKey,
        baseUrl: savingAsKit.baseUrl,
        name: kitDraft.name.trim(),
        costTier: "medium",  // 使用默认值
        performanceProfile: "balanced"  // 使用默认值
      };
      const newKit = await api.testAndSaveModelKit(input);
      setModelKits((prev) => [...prev, newKit]);
      setSavingAsKit(null);
      setKitDraft({ name: "" });
    } catch (err) {
      setKitError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  async function updateModelKitHandler(id: string, input: UpdateModelKitInput) {
    onSetBusy(true);
    setKitError("");
    try {
      const updated = await api.updateModelKit(id, input);
      setModelKits((prev) => prev.map((kit) => (kit.id === id ? updated : kit)));
      setEditingKit(null);
    } catch (err) {
      setKitError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  async function deleteModelKitHandler(id: string) {
    if (!confirm("确定要删除此 ModelKit 吗?")) {
      return;
    }
    onSetBusy(true);
    setKitError("");
    try {
      await api.deleteModelKit(id);
      setModelKits((prev) => prev.filter((kit) => kit.id !== id));
    } catch (err) {
      setKitError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  // Sub-agent management functions
  async function createSubAgentHandler(input: CreateSubAgentInput) {
    onSetBusy(true);
    setSubAgentError("");
    try {
      const newAgent = await api.createSubAgent(input);
      setSubAgents((prev) => [...prev, newAgent]);
      if (input.mode === "entry") {
        setEntrySubAgentId(newAgent.id);
      }
      setCreatingSubAgent(false);
    } catch (err) {
      setSubAgentError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  async function updateSubAgentHandler(id: string, input: UpdateSubAgentInput) {
    onSetBusy(true);
    setSubAgentError("");
    try {
      const updated = await api.updateSubAgent(id, input);
      setSubAgents((prev) => prev.map((agent) => (agent.id === id ? updated : agent)));
      setEditingSubAgent(null);
    } catch (err) {
      setSubAgentError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  async function deleteSubAgentHandler(id: string) {
    if (id === entrySubAgentId) {
      alert("无法删除入口 Agent，请先设置其他 Agent 为入口。");
      return;
    }
    if (!confirm("确定要删除此 Agent 吗?")) {
      return;
    }
    onSetBusy(true);
    setSubAgentError("");
    try {
      await api.deleteSubAgent(id);
      setSubAgents((prev) => prev.filter((agent) => agent.id !== id));
    } catch (err) {
      setSubAgentError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  async function setEntrySubAgentHandler(id: string) {
    onSetBusy(true);
    setSubAgentError("");
    try {
      await api.setEntrySubAgent(id);
      setEntrySubAgentId(id);
      // 更新该 agent 的 mode 为 entry
      setSubAgents((prev) =>
        prev.map((agent) =>
          agent.id === id ? { ...agent, mode: "entry" as const } : agent
        )
      );
    } catch (err) {
      setSubAgentError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  async function refreshSecurity() {
    const [policy, approvals, auditEntries] = await Promise.all([
      api.securityPolicy(),
      api.commandApprovals(),
      api.auditLog()
    ]);
    setSecurityPolicy(policy);
    setSecurityDraft({
      allowedCommands: formatListDraft(policy.allowedCommands),
      commandTemplates: formatListDraft(policy.commandTemplates),
      fileScopes: formatListDraft(policy.fileScopes),
      networkScopes: formatListDraft(policy.networkScopes)
    });
    setCommandApprovals(approvals);
    setAuditLog(auditEntries);
  }

  async function patchSecurityPolicy(input: Partial<Omit<SecurityPolicy, "updatedAt">>) {
    onSetBusy(true);
    setSecurityError("");
    try {
      const next = await api.updateSecurityPolicy(input);
      setSecurityPolicy(next);
      setSecurityDraft({
        allowedCommands: formatListDraft(next.allowedCommands),
        commandTemplates: formatListDraft(next.commandTemplates),
        fileScopes: formatListDraft(next.fileScopes),
        networkScopes: formatListDraft(next.networkScopes)
      });
      setAuditLog(await api.auditLog());
    } catch (err) {
      setSecurityError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  async function saveSecurityPolicy(event: FormEvent) {
    event.preventDefault();
    await patchSecurityPolicy({
      allowedCommands: parseListDraft(securityDraft.allowedCommands),
      commandTemplates: parseListDraft(securityDraft.commandTemplates),
      fileScopes: parseListDraft(securityDraft.fileScopes),
      networkScopes: parseListDraft(securityDraft.networkScopes)
    });
  }

  async function decideCommandApproval(approvalId: string, decision: "approve" | "deny", scope?: CommandApprovalScope) {
    onSetBusy(true);
    setSecurityError("");
    try {
      if (decision === "approve") {
        await api.approveCommandApproval(approvalId, { scope });
      } else {
        await api.denyCommandApproval(approvalId);
      }
      await refreshSecurity();
    } catch (err) {
      setSecurityError(err instanceof Error ? err.message : String(err));
    } finally {
      onSetBusy(false);
    }
  }

  const pendingCommandApprovals = commandApprovals.filter((approval) => approval.status === "pending");
  const activeCommandApprovals = commandApprovals.filter((approval) => approval.status === "approved");
  const recentCommandApprovals = commandApprovals.filter((approval) => approval.status !== "pending").slice(0, 8);
  const recentAuditLog = auditLog.slice(0, 10);

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
            模型管理
          </button>
          <button className={tab === "modelkits" ? "active" : ""} onClick={() => setTab("modelkits")} role="tab" type="button">
            ModelKit 管理
          </button>
          <button className={tab === "subagents" ? "active" : ""} onClick={() => setTab("subagents")} role="tab" type="button">
            Agent 管理
          </button>
          <button className={tab === "security" ? "active" : ""} onClick={() => setTab("security")} role="tab" type="button">
            安全
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
                添加仓库
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
              <div className="seg-control" role="tablist" aria-label="模型管理">
                <button
                  className={(!engine || engine.mode === "cli") ? "active" : ""}
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
                  onClick={() => patchEngine({ mode: "byok", activeByokProviderId: providerId })}
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
                          const savedConfig = engine?.byokProviders[provider.id];
                          setByokDraft(
                            savedConfig ?? {
                              provider: provider.label,
                              baseUrl: provider.baseUrl,
                              model: provider.model,
                              apiKey: ""
                            }
                          );
                          patchEngine({ activeByokProviderId: provider.id });
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
                      onClick={() => patchEngine({
                        byokProviders: {
                          ...engine?.byokProviders,
                          [providerId]: { ...(engine?.byokProviders[providerId] ?? {}), ...byokDraft }
                        },
                        activeByokProviderId: providerId
                      })}
                      type="button"
                    >
                      保存 BYOK 配置
                    </button>
                    <button className="ghost-action" disabled={byokTesting} onClick={testByok} type="button">
                      {byokTesting ? "测试中…" : "测试连接"}
                    </button>
                  </div>
                  {byokTestResult ? (
                    <div className={`cli-test-banner${byokTestResult.ok ? " ok" : " fail"}`}>
                      {byokTestResult.message}
                      {byokTestResult.ok && (
                        <button
                          className="ghost-action"
                          style={{ marginLeft: '8px' }}
                          onClick={() => setSavingAsKit({
                            type: "byok",
                            providerId,
                            model: byokDraft.model,
                            apiKey: byokDraft.apiKey,
                            baseUrl: byokDraft.baseUrl
                          })}
                          type="button"
                        >
                          保存为 ModelKit
                        </button>
                      )}
                    </div>
                  ) : null}
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
                            <div className={`cli-test-banner${testResult.ok ? " ok" : " fail"}`}>
                              {testResult.message}
                              {testResult.ok && (
                                <button
                                  className="ghost-action"
                                  style={{ marginLeft: '8px' }}
                                  onClick={() => setSavingAsKit({
                                    type: "cli",
                                    backendId: cli.id,
                                    model: selectedModel
                                  })}
                                  type="button"
                                >
                                  保存为 ModelKit
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          ) : null}

          {tab === "modelkits" ? (
            <section className="config-section">
              <div className="settings-section-heading">
                <h3>ModelKits ({modelKits.length})</h3>
              </div>
              <p className="muted">管理已保存的模型配置,方便在不同场景下快速切换。</p>

              <div className="modelkit-embedding-field">
                <label>
                  <span>Embedding 模型（向量检索）</span>
                  <select
                    value={engine?.embeddingModelKitId ?? ""}
                    onChange={(e) => patchEngine({ embeddingModelKitId: e.target.value })}
                  >
                    <option value="">未启用（关键词检索）</option>
                    {modelKits.filter((k) => k.type === "byok").map((kit) => (
                      <option key={kit.id} value={kit.id}>{kit.name || kit.model}</option>
                    ))}
                  </select>
                  <span className="field-hint">未配置时知识库使用关键词检索。</span>
                </label>
              </div>

              {modelKits.length === 0 ? (
                <p className="muted">暂无 ModelKits。在"模型管理"标签页中测试通过后,可以保存为 ModelKit。</p>
              ) : (
                <div className="modelkit-list">
                  {modelKits.map((kit) => (
                    <article key={kit.id} className="modelkit-card">
                      <div className="modelkit-header">
                        <div>
                          <strong>{kit.name}</strong>
                          <span className="modelkit-type">{kit.type === "cli" ? "CLI" : "BYOK"}</span>
                        </div>
                        <div className="modelkit-actions">
                          <button
                            className="ghost-action"
                            onClick={() => setEditingKit(kit)}
                            type="button"
                          >
                            编辑
                          </button>
                          <button
                            className="danger-action"
                            onClick={() => deleteModelKitHandler(kit.id)}
                            type="button"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div className="modelkit-details">
                        <code>{kit.model}</code>
                        {kit.backendId && <span>Backend: {kit.backendId}</span>}
                        {kit.providerId && <span>Provider: {kit.providerId}</span>}
                        <span className="field-hint">创建于 {formatDate(kit.metadata.createdAt)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
          
          {tab === "subagents" ? (
            <section className="config-section">
              <div className="settings-section-heading">
                <h3>Agent ({subAgents.length})</h3>
                <button
                  className="secondary-action"
                  onClick={() => setCreatingSubAgent(true)}
                  type="button"
                >
                  <Plus size={14} />
                  <span>新建 Agent</span>
                </button>
              </div>
              <p className="muted">管理专门的智能体，每个 Agent 绑定一个 ModelKit 并配置特定权限。</p>
                        
              {(() => {
                const userAgents = subAgents.filter((a) => a.mode !== "system");
                const systemAgents = subAgents.filter((a) => a.mode === "system");

                return (
                  <>
                    {/* 用户 Agent 列表 */}
                    {userAgents.length === 0 ? (
                      <p className="muted">暂无 Agent。点击"新建 Agent"创建第一个。</p>
                    ) : (
                      <div className="subagent-list">
                        {userAgents.map((agent) => {
                          const modelKit = modelKits.find((kit) => kit.id === agent.modelKitId);
                          const isEntry = agent.id === entrySubAgentId;
                          return (
                            <article key={agent.id} className="subagent-card">
                              <div className="subagent-header">
                                <div className="subagent-title">
                                  <strong>{agent.name}</strong>
                                  {isEntry && (
                                    <span className="badge green" style={{ marginLeft: '8px' }}>
                                      入口 Agent
                                    </span>
                                  )}
                                  <span className={`badge ${agent.mode === 'entry' ? 'blue' : ''}`}>
                                    {agent.mode === 'entry' ? '入口' : '工作节点'}
                                  </span>
                                </div>
                                <div className="subagent-actions">
                                  {!isEntry && (
                                    <button
                                      className="ghost-action"
                                      onClick={() => setEntrySubAgentHandler(agent.id)}
                                      type="button"
                                    >
                                      设为入口
                                    </button>
                                  )}
                                  <button
                                    className="ghost-action"
                                    onClick={() => setEditingSubAgent(agent)}
                                    type="button"
                                  >
                                    编辑
                                  </button>
                                  <button
                                    className="danger-action"
                                    disabled={isEntry}
                                    onClick={() => deleteSubAgentHandler(agent.id)}
                                    type="button"
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                              <div className="subagent-details">
                                <p className="subagent-role">{agent.role}</p>
                                {modelKit && (
                                  <div className="subagent-modelkit">
                                    <span>绑定 ModelKit:</span>
                                    <code>{modelKit.name}</code>
                                    <span className="modelkit-type">{modelKit.type === "cli" ? "CLI" : "BYOK"}</span>
                                  </div>
                                )}
                                {agent.capabilities.length > 0 && (
                                  <div className="subagent-capabilities">
                                    <span>能力:</span>
                                    {agent.capabilities.map((cap) => (
                                      <em key={cap}>{cap}</em>
                                    ))}
                                  </div>
                                )}
                                <div className="subagent-permissions">
                                  <span>允许工具: {agent.permissions.allowedTools.length}</span>
                                  {agent.permissions.deniedTools.length > 0 && (
                                    <span>禁止工具: {agent.permissions.deniedTools.length}</span>
                                  )}
                                  {agent.permissions.maxSteps && (
                                    <span>最大步数: {agent.permissions.maxSteps}</span>
                                  )}
                                </div>
                                <span className="field-hint">创建于 {formatDate(agent.metadata.createdAt)}</span>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}

                    {/* 系统 Agent 列表 */}
                    {systemAgents.length > 0 && (
                      <>
                        <div className="settings-section-heading" style={{ marginTop: '24px' }}>
                          <h3>系统 Agent ({systemAgents.length})</h3>
                          <span className="badge blue">内置</span>
                        </div>
                        <p className="muted">系统自带智能体,分别负责知识库、用户习惯和失败经验管理。只读,不可删除。</p>
                        <div className="subagent-list">
                          {systemAgents.map((agent) => {
                            const modelKit = modelKits.find((kit) => kit.id === agent.modelKitId);
                            const roleLabel =
                              agent.systemRole === "knowledge" ? "知识库" :
                              agent.systemRole === "habits" ? "用户习惯" :
                              agent.systemRole === "failure-experience" ? "失败经验" : "系统";
                            return (
                              <article key={agent.id} className="subagent-card system-agent-card">
                                <div className="subagent-header">
                                  <div className="subagent-title">
                                    <strong>{agent.name}</strong>
                                    <span className="badge green">{roleLabel}</span>
                                    <span className="badge blue">系统</span>
                                  </div>
                                  <div className="subagent-actions">
                                    <select
                                      aria-label={`切换 ${agent.name} 的 ModelKit`}
                                      value={agent.modelKitId}
                                      onChange={(event) => {
                                        const newKitId = event.target.value;
                                        updateSubAgentHandler(agent.id, { modelKitId: newKitId });
                                      }}
                                      className="compact-select"
                                    >
                                      {modelKits.length === 0 && (
                                        <option value={agent.modelKitId}>无可用 ModelKit</option>
                                      )}
                                      {modelKits.map((kit) => (
                                        <option key={kit.id} value={kit.id}>
                                          {kit.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div className="subagent-details">
                                  <p className="subagent-role">{agent.role}</p>
                                  {modelKit && (
                                    <div className="subagent-modelkit">
                                      <span>绑定 ModelKit:</span>
                                      <code>{modelKit.name}</code>
                                      <span className="modelkit-type">{modelKit.type === "cli" ? "CLI" : "BYOK"}</span>
                                    </div>
                                  )}
                                  {agent.capabilities.length > 0 && (
                                    <div className="subagent-capabilities">
                                      <span>能力:</span>
                                      {agent.capabilities.map((cap) => (
                                        <em key={cap}>{cap}</em>
                                      ))}
                                    </div>
                                  )}
                                  <div className="subagent-permissions">
                                    <span>允许工具: {agent.permissions.allowedTools.length}</span>
                                    {agent.permissions.deniedTools.length > 0 && (
                                      <span>禁止工具: {agent.permissions.deniedTools.length}</span>
                                    )}
                                  </div>
                                  <span className="field-hint">使用 {agent.metadata.usageCount} 次</span>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </section>
          ) : null}

          {tab === "security" ? (
            <section className="config-section">
              <div className="settings-section-heading">
                <h3>命令安全</h3>
                <button className="ghost-action" disabled={busy} onClick={refreshSecurity} type="button">
                  <RefreshCw size={14} />
                  <span>刷新</span>
                </button>
              </div>
              {securityError ? <div className="error-banner">{securityError}</div> : null}
              {!securityPolicy ? (
                <p className="muted">正在加载安全策略…</p>
              ) : (
                <>
                  <div className="settings-policy-grid">
                    <div>
                      <span>命令模式</span>
                      <strong>{securityPolicy.commandApprovalMode === "manual" ? "人工审批" : "Allowlist"}</strong>
                    </div>
                    <div>
                      <span>Sandbox</span>
                      <strong>{securityPolicy.sandboxRuntime}</strong>
                    </div>
                    <div>
                      <span>Secrets</span>
                      <strong>{securityPolicy.secretsPolicy}</strong>
                    </div>
                    <div>
                      <span>更新时间</span>
                      <strong>{formatDate(securityPolicy.updatedAt)}</strong>
                    </div>
                  </div>

                  <div className="seg-control" role="tablist" aria-label="命令审批模式">
                    <button
                      className={securityPolicy.commandApprovalMode === "allowlist" ? "active" : ""}
                      disabled={busy}
                      onClick={() => patchSecurityPolicy({ commandApprovalMode: "allowlist" })}
                      role="tab"
                      type="button"
                    >
                      Allowlist
                    </button>
                    <button
                      className={securityPolicy.commandApprovalMode === "manual" ? "active" : ""}
                      disabled={busy}
                      onClick={() => patchSecurityPolicy({ commandApprovalMode: "manual" })}
                      role="tab"
                      type="button"
                    >
                      人工审批
                    </button>
                  </div>

                  <div className="security-select-row">
                    <label>
                      <span>Sandbox Runtime</span>
                      <Select
                        ariaLabel="Sandbox Runtime"
                        value={securityPolicy.sandboxRuntime}
                        onValueChange={(sandboxRuntime) =>
                          patchSecurityPolicy({ sandboxRuntime: sandboxRuntime as SecurityPolicy["sandboxRuntime"] })
                        }
                        options={[
                          { value: "local-worktree", label: "local-worktree" },
                          { value: "cubesandbox", label: "cubesandbox" }
                        ]}
                      />
                    </label>
                    <label>
                      <span>Secrets 策略</span>
                      <Select
                        ariaLabel="Secrets 策略"
                        value={securityPolicy.secretsPolicy}
                        onValueChange={(secretsPolicy) =>
                          patchSecurityPolicy({ secretsPolicy: secretsPolicy as SecurityPolicy["secretsPolicy"] })
                        }
                        options={[
                          { value: "redact-env", label: "redact-env" },
                          { value: "deny", label: "deny" }
                        ]}
                      />
                    </label>
                  </div>

                  <form className="security-policy-form" onSubmit={saveSecurityPolicy}>
                    <label>
                      <span>Validation command allowlist</span>
                      <textarea
                        className="compact-textarea"
                        value={securityDraft.allowedCommands}
                        onChange={(event) =>
                          setSecurityDraft((current) => ({ ...current, allowedCommands: event.target.value }))
                        }
                      />
                      <span className="field-hint">一行一个命令名，用于用户配置的 validation command。</span>
                    </label>
                    <label>
                      <span>Worker command templates</span>
                      <textarea
                        className="compact-textarea"
                        value={securityDraft.commandTemplates}
                        onChange={(event) =>
                          setSecurityDraft((current) => ({ ...current, commandTemplates: event.target.value }))
                        }
                      />
                      <span className="field-hint">一行一个 argv 前缀模板，用于自动放行 worker run_command。</span>
                    </label>
                    <label>
                      <span>File scopes</span>
                      <textarea
                        className="compact-textarea"
                        value={securityDraft.fileScopes}
                        onChange={(event) =>
                          setSecurityDraft((current) => ({ ...current, fileScopes: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      <span>Network scopes</span>
                      <textarea
                        className="compact-textarea"
                        value={securityDraft.networkScopes}
                        onChange={(event) =>
                          setSecurityDraft((current) => ({ ...current, networkScopes: event.target.value }))
                        }
                      />
                    </label>
                    <div className="project-config-actions">
                      <button className="secondary-action" disabled={busy} type="submit">
                        保存策略
                      </button>
                    </div>
                  </form>
                </>
              )}

              <div className="settings-section-heading">
                <h3>待审批命令</h3>
                <span>{pendingCommandApprovals.length} pending</span>
              </div>
              {pendingCommandApprovals.length === 0 ? <p className="muted">暂无待审批命令。</p> : null}
              <div className="command-approval-list">
                {pendingCommandApprovals.map((approval) => (
                  <article className="command-approval-row" key={approval.id}>
                    <div>
                      <strong>{approval.subject}</strong>
                      <code>{approval.command}</code>
                      <p>{approval.reason}</p>
                      <span className="field-hint">
                        请求 {approval.requestCount} 次 · {formatDate(approval.updatedAt)}
                      </span>
                    </div>
                    <div className="settings-row-actions">
                      <button
                        className="secondary-action"
                        disabled={busy}
                        onClick={() => decideCommandApproval(approval.id, "approve", "session")}
                        type="button"
                      >
                        本会话批准
                      </button>
                      <button
                        className="ghost-action"
                        disabled={busy}
                        onClick={() => decideCommandApproval(approval.id, "approve", "persistent")}
                        type="button"
                      >
                        持久批准
                      </button>
                      <button
                        className="danger-action"
                        disabled={busy}
                        onClick={() => decideCommandApproval(approval.id, "deny")}
                        type="button"
                      >
                        拒绝
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="settings-section-heading">
                <h3>已批准命令</h3>
                <span>{activeCommandApprovals.length} active</span>
              </div>
              {activeCommandApprovals.length === 0 ? <p className="muted">暂无已批准命令。</p> : null}
              <div className="command-approval-list">
                {activeCommandApprovals.map((approval) => (
                  <article className="command-approval-row" key={approval.id}>
                    <div>
                      <strong>{approval.scope === "persistent" ? "持久批准" : "本会话批准"}</strong>
                      <code>{approval.command}</code>
                      <span className="field-hint">
                        {approval.decidedAt ? formatDate(approval.decidedAt) : formatDate(approval.updatedAt)}
                      </span>
                    </div>
                    <div className="settings-row-actions">
                      <button
                        className="danger-action"
                        disabled={busy}
                        onClick={() => decideCommandApproval(approval.id, "deny")}
                        type="button"
                      >
                        撤销
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="security-history-grid">
                <section>
                  <div className="settings-section-heading">
                    <h3>最近审批</h3>
                    <span>{recentCommandApprovals.length}</span>
                  </div>
                  {recentCommandApprovals.length === 0 ? <p className="muted">暂无审批历史。</p> : null}
                  <div className="command-approval-list compact">
                    {recentCommandApprovals.map((approval) => (
                      <article className="command-approval-row compact" key={approval.id}>
                        <div>
                          <strong>{approval.status === "approved" ? `已批准 · ${approval.scope}` : "已拒绝"}</strong>
                          <code>{approval.command}</code>
                          <span className="field-hint">{approval.decidedAt ? formatDate(approval.decidedAt) : formatDate(approval.updatedAt)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
                <section>
                  <div className="settings-section-heading">
                    <h3>Audit log</h3>
                    <span>{recentAuditLog.length}</span>
                  </div>
                  {recentAuditLog.length === 0 ? <p className="muted">暂无审计记录。</p> : null}
                  <div className="command-approval-list compact">
                    {recentAuditLog.map((entry) => (
                      <article className="audit-row" key={entry.id}>
                        <span>{entry.type} · {entry.decision}</span>
                        <strong>{entry.subject}</strong>
                        <p>{entry.detail}</p>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </section>
          ) : null}
        </div>
      </section>

      {/* Save as ModelKit Dialog */}
      {savingAsKit ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="save-kit-title" className="modal-panel compact-modal" role="dialog">
            <header className="modal-header">
              <div>
                <p className="eyebrow">ModelKit</p>
                <h2 id="save-kit-title">保存为 ModelKit</h2>
              </div>
              <button aria-label="关闭" className="icon-button" onClick={() => setSavingAsKit(null)} type="button">
                <X size={17} />
              </button>
            </header>
            <form className="modal-body config-section" onSubmit={saveAsModelKit}>
              {kitError && <div className="error-banner">{kitError}</div>}
              <label>
                <span>名称 *</span>
                <input
                  aria-label="ModelKit 名称"
                  placeholder="例如: Claude Code (快速响应)"
                  value={kitDraft.name}
                  onChange={(event) => setKitDraft({ name: event.target.value })}
                  required
                />
              </label>
              <div className="project-config-actions">
                <button 
                  className="ghost-action" 
                  onClick={() => setSavingAsKit(null)} 
                  disabled={busy}
                  type="button"
                >
                  取消
                </button>
                <button 
                  className="secondary-action" 
                  disabled={busy || !kitDraft.name.trim()} 
                  type="submit"
                >
                  {busy ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {/* Edit ModelKit Dialog */}
      {editingKit ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="edit-kit-title" className="modal-panel compact-modal" role="dialog">
            <header className="modal-header">
              <div>
                <p className="eyebrow">ModelKit</p>
                <h2 id="edit-kit-title">编辑 ModelKit</h2>
              </div>
              <button aria-label="关闭" className="icon-button" onClick={() => setEditingKit(null)} type="button">
                <X size={17} />
              </button>
            </header>
            <form
              className="modal-body config-section"
              onSubmit={(event) => {
                event.preventDefault();
                updateModelKitHandler(editingKit.id, {
                  name: editingKit.name
                });
              }}
            >
              {kitError && <div className="error-banner">{kitError}</div>}
              <label>
                <span>名称</span>
                <input
                  aria-label="ModelKit 名称"
                  value={editingKit.name}
                  onChange={(event) => setEditingKit({ ...editingKit, name: event.target.value })}
                />
              </label>
              <div className="project-config-actions">
                <button className="secondary-action" disabled={busy} type="submit">
                  保存
                </button>
                <button className="ghost-action" onClick={() => setEditingKit(null)} type="button">
                  取消
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {/* Create/Edit Sub-agent Dialog */}
      {(creatingSubAgent || editingSubAgent) ? (
        <SubAgentDialog
          agent={editingSubAgent}
          modelKits={modelKits}
          busy={busy}
          error={subAgentError}
          onClose={() => {
            setCreatingSubAgent(false);
            setEditingSubAgent(null);
            setSubAgentError("");
          }}
          onSave={(input) => {
            if (editingSubAgent) {
              updateSubAgentHandler(editingSubAgent.id, input);
            } else {
              createSubAgentHandler(input as CreateSubAgentInput);
            }
          }}
        />
      ) : null}
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
  const [tab, setTab] = useState<"basic" | "repos">("basic");

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
        <div className="settings-tabs" role="tablist" aria-label="Workspace 配置分类">
          <button className={tab === "basic" ? "active" : ""} onClick={() => setTab("basic")} role="tab" type="button">
            基本信息
          </button>
          <button className={tab === "repos" ? "active" : ""} onClick={() => setTab("repos")} role="tab" type="button">
            关联仓库
          </button>
        </div>
        <div className="modal-body">
          {tab === "basic" ? (
          <form className="config-section" onSubmit={submitWorkspace}>
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
          ) : (
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
                  <article className="worktree-row" key={worktree.projectId}>
                    <div className="worktree-row-head">
                      <div className="worktree-row-title">
                        <strong>{project?.name ?? worktree.projectId}</strong>
                        {project ? <span className="role-pill">{project.role}</span> : null}
                      </div>
                      <div className="worktree-row-status">
                        <span>{worktree.branchName}</span>
                        <span>base: {worktree.baseBranch}</span>
                        <span className={`health-pill ${worktree.status === "created" ? "ok" : "invalid"}`}>
                          {worktree.status}
                        </span>
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
                    </div>
                    <div className="worktree-row-paths">
                      {project ? (
                        <div className="path-row">
                          <span className="path-label">仓库地址</span>
                          <code title={project.path}>{project.path}</code>
                          <button
                            aria-label="打开仓库目录"
                            className="ghost-action icon-only"
                            onClick={() => api.openProjectDirectory(project.id)}
                            title="打开仓库目录"
                            type="button"
                          >
                            <FolderOpen size={14} />
                          </button>
                        </div>
                      ) : null}
                      <div className="path-row">
                        <span className="path-label">Worktree</span>
                        <code title={worktree.worktreePath}>{worktree.worktreePath}</code>
                        <button
                          aria-label="打开 worktree 目录"
                          className="ghost-action icon-only"
                          onClick={() => api.openWorktreeDirectory(workspace.id, worktree.projectId)}
                          title="打开 worktree 目录"
                          type="button"
                        >
                          <FolderOpen size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          )}
        </div>
      </section>
    </div>
  );
}

function basenameFromPath(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function formatListDraft(values: string[] = []): string {
  return values.join("\n");
}

function parseListDraft(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
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
  const [currentBranch, setCurrentBranch] = useState<string>("");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const path = draft.path.trim();
    if (!path) {
      setCurrentBranch("");
      return;
    }
    let cancelled = false;
    api
      .listBranches(path)
      .then((result) => {
        if (!cancelled) {
          setCurrentBranch(result.currentBranch);
          if (result.currentBranch && result.currentBranch !== draft.defaultBranch) {
            onDraftChange({ ...draft, defaultBranch: result.currentBranch });
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentBranch("");
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
        .catch(() => ({ branches: [] as string[], defaultBranch: "main", currentBranch: "" }));
      setCurrentBranch(branchInfo.currentBranch);
      onDraftChange({
        ...draft,
        path,
        name: draft.name.trim() || basenameFromPath(path),
        defaultBranch: branchInfo.currentBranch || branchInfo.defaultBranch || "main"
      });
    } finally {
      setPicking(false);
    }
  }

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
        <span>当前分支</span>
        <input
          aria-label="当前分支"
          value={currentBranch || "—"}
          readOnly
        />
        <span className="field-hint">自动检测仓库当前分支，作为 worktree 和知识库的 base。</span>
      </label>
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

function formatQuestStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function costTierLabel(tier: "free" | "low" | "medium" | "high"): string {
  const labels = {
    free: "免费",
    low: "低成本",
    medium: "中等",
    high: "高成本"
  };
  return labels[tier];
}

function performanceProfileLabel(profile: "fast" | "balanced" | "accurate"): string {
  const labels = {
    fast: "快速",
    balanced: "平衡",
    accurate: "高精度"
  };
  return labels[profile];
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return dateString;
  }
}

/**
 * Sub-agent 创建/编辑对话框组件
 */
function SubAgentDialog({
  agent,
  modelKits,
  busy,
  error,
  onClose,
  onSave
}: {
  agent: SubAgent | null;
  modelKits: ModelKit[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (input: CreateSubAgentInput | UpdateSubAgentInput) => void;
}) {
  // 初始化表单状态
  const [formData, setFormData] = useState<{
    name: string;
    role: string;
    capabilities: string[];
    modelKitId: string;
    mode?: "entry" | "worker" | "system";
    allowedTools: string[];
    deniedTools: string[];
    maxSteps?: number;
    promptTemplate?: string;
  }>(() => {
    if (agent) {
      return {
        name: agent.name,
        role: agent.role,
        capabilities: agent.capabilities,
        modelKitId: agent.modelKitId,
        mode: agent.mode,
        allowedTools: agent.permissions.allowedTools,
        deniedTools: agent.permissions.deniedTools,
        maxSteps: agent.permissions.maxSteps,
        promptTemplate: agent.promptTemplate
      };
    }
    return {
      name: "",
      role: "",
      capabilities: [],
      modelKitId: "",
      mode: "worker",
      allowedTools: [],
      deniedTools: [],
      maxSteps: undefined,
      promptTemplate: ""
    };
  });

  // 能力标签选项
  const capabilityOptions = [
    "requirements",
    "specification",
    "planning",
    "coding",
    "testing",
    "review",
    "documentation",
    "debugging"
  ];

  // 常用工具列表(用于权限配置)
  const commonTools = [
    "read_file",
    "write_file",
    "edit_file",
    "run_command",
    "list_directory",
    "search_files",
    "grep_code",
    "git_operations"
  ];

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!formData.name.trim() || !formData.role.trim() || !formData.modelKitId) {
      return;
    }
    
    const input: CreateSubAgentInput | UpdateSubAgentInput = {
      name: formData.name.trim(),
      role: formData.role.trim(),
      capabilities: formData.capabilities,
      modelKitId: formData.modelKitId,
      mode: formData.mode,
      permissions: {
        allowedTools: formData.allowedTools,
        deniedTools: formData.deniedTools,
        maxSteps: formData.maxSteps
      },
      promptTemplate: formData.promptTemplate?.trim() || undefined
    };
    
    onSave(input);
  }

  function toggleCapability(cap: string) {
    setFormData((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap]
    }));
  }

  function toggleTool(tool: string, type: "allowed" | "denied") {
    setFormData((prev) => {
      const targetList = type === "allowed" ? prev.allowedTools : prev.deniedTools;
      const otherList = type === "allowed" ? prev.deniedTools : prev.allowedTools;
      
      if (targetList.includes(tool)) {
        return {
          ...prev,
          [type === "allowed" ? "allowedTools" : "deniedTools"]: targetList.filter((t) => t !== tool)
        };
      } else {
        // 从另一个列表中移除
        return {
          ...prev,
          [type === "allowed" ? "allowedTools" : "deniedTools"]: [...targetList, tool],
          [type === "allowed" ? "deniedTools" : "allowedTools"]: otherList.filter((t) => t !== tool)
        };
      }
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="subagent-dialog-title" className="modal-panel" role="dialog">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Agent</p>
            <h2 id="subagent-dialog-title">
              {agent ? "编辑 Agent" : "新建 Agent"}
            </h2>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>
        <form className="modal-body config-section" onSubmit={handleSubmit}>
          {error && <div className="error-banner">{error}</div>}
          
          {/* Step 1: 基本信息 */}
          <div className="config-section">
            <h3>基本信息</h3>
            <label>
              <span>名称 *</span>
              <input
                aria-label="Agent 名称"
                placeholder="例如: Spec Generator"
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                required
              />
            </label>
            <label>
              <span>角色描述 *</span>
              <textarea
                aria-label="角色描述"
                className="compact-textarea"
                placeholder="例如: 负责需求澄清和 Spec 生成"
                value={formData.role}
                onChange={(event) => setFormData({ ...formData, role: event.target.value })}
                required
              />
            </label>
            <label>
              <span>能力标签(可选)</span>
              <div className="capability-tags">
                {capabilityOptions.map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    className={`capability-tag ${formData.capabilities.includes(cap) ? 'active' : ''}`}
                    onClick={() => toggleCapability(cap)}
                  >
                    {cap}
                  </button>
                ))}
              </div>
            </label>
          </div>

          {/* Step 2: 绑定 ModelKit */}
          <div className="config-section">
            <h3>绑定 ModelKit *</h3>
            <label>
              <span>选择 ModelKit</span>
              <Select
                ariaLabel="选择 ModelKit"
                value={formData.modelKitId}
                placeholder="请选择一个 ModelKit"
                onValueChange={(value) => setFormData({ ...formData, modelKitId: value })}
                options={modelKits.map((kit) => ({
                  value: kit.id,
                  label: `${kit.name} (${kit.type === "cli" ? "CLI" : "BYOK"})`
                }))}
              />
              <span className="field-hint">每个 Agent 必须绑定一个 ModelKit</span>
            </label>
          </div>

          {/* Step 3: 配置权限 */}
          <div className="config-section">
            <h3>配置权限</h3>
            <label>
              <span>允许的工具</span>
              <div className="tool-permissions">
                {commonTools.map((tool) => (
                  <label key={tool} className="tool-checkbox">
                    <input
                      type="checkbox"
                      checked={formData.allowedTools.includes(tool)}
                      onChange={() => toggleTool(tool, "allowed")}
                    />
                    <span>{tool}</span>
                  </label>
                ))}
              </div>
            </label>
            <label>
              <span>禁止的工具</span>
              <div className="tool-permissions">
                {commonTools.map((tool) => (
                  <label key={tool} className="tool-checkbox">
                    <input
                      type="checkbox"
                      checked={formData.deniedTools.includes(tool)}
                      onChange={() => toggleTool(tool, "denied")}
                    />
                    <span>{tool}</span>
                  </label>
                ))}
              </div>
            </label>
            <label>
              <span>最大执行步数(可选)</span>
              <input
                type="number"
                min="1"
                placeholder="例如: 50"
                value={formData.maxSteps || ""}
                onChange={(event) => setFormData({
                  ...formData,
                  maxSteps: event.target.value ? parseInt(event.target.value) : undefined
                })}
              />
            </label>
          </div>

          {/* Step 4: 选择模式 */}
          <div className="config-section">
            <h3>选择模式</h3>
            <div className="seg-control" role="tablist" aria-label="Agent 模式">
              <button
                className={formData.mode === "entry" ? "active" : ""}
                type="button"
                onClick={() => setFormData({ ...formData, mode: "entry" })}
              >
                Entry (入口 Agent)
              </button>
              <button
                className={formData.mode === "worker" ? "active" : ""}
                type="button"
                onClick={() => setFormData({ ...formData, mode: "worker" })}
              >
                Worker (工作节点)
              </button>
            </div>
            <p className="field-hint">
              Entry: 处理初始请求,协调其他 agents<br />
              Worker: 执行具体任务,由 Entry agent 调用
            </p>
          </div>

          {/* Step 5: 系统提示模板 */}
          <div className="config-section">
            <h3>系统提示模板(可选)</h3>
            <label>
              <span>自定义行为提示词</span>
              <textarea
                aria-label="系统提示模板"
                className="compact-textarea"
                placeholder="例如: 你是一个专业的需求分析师,专注于..."
                value={formData.promptTemplate || ""}
                onChange={(event) => setFormData({ ...formData, promptTemplate: event.target.value })}
                style={{ minHeight: '120px' }}
              />
            </label>
          </div>

          <div className="project-config-actions">
            <button className="ghost-action" onClick={onClose} disabled={busy} type="button">
              取消
            </button>
            <button
              className="secondary-action"
              disabled={busy || !formData.name.trim() || !formData.role.trim() || !formData.modelKitId}
              type="submit"
            >
              {busy ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
