import {
  BookOpen,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  ListChecks,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AgentBackendId,
  AgentBackendInfo,
  AgentEvent,
  api,
  ChangedFile,
  KnowledgeItem,
  Project,
  Quest,
  RepoHelmState,
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

type InspectorTab = "spec" | "overview" | "files" | "diff" | "logs";

export function App() {
  const [state, setState] = useState<RepoHelmState | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [selectedQuestId, setSelectedQuestId] = useState<string>("");
  const [questRequirement, setQuestRequirement] = useState("");
  const [agentBackendId, setAgentBackendId] = useState<AgentBackendId>("mock");
  const [agentBackends, setAgentBackends] = useState<AgentBackendInfo[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("spec");
  const [selectedChangedFileKey, setSelectedChangedFileKey] = useState("");
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<string[]>([]);
  const [workspaceConfigOpen, setWorkspaceConfigOpen] = useState(false);
  const [workspaceConfigId, setWorkspaceConfigId] = useState("");
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const [nextState, nextBackends] = await Promise.all([api.state(), api.agentBackends()]);
    setState(nextState);
    setAgentBackends(nextBackends);
    setSelectedWorkspaceId((current) => current || nextState.workspaces[0]?.id || "");
    setSelectedQuestId((current) => current || nextState.quests[0]?.id || "");
    setExpandedWorkspaceIds((current) => (current.length > 0 ? current : nextState.workspaces[0] ? [nextState.workspaces[0].id] : []));
  };

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
  const selectedQuest = quests.find((quest) => quest.id === selectedQuestId) ?? quests[0];
  const questEvents = state?.events.filter((event) => event.questId === selectedQuest?.id) ?? [];
  const knowledge = state?.knowledge.filter((item) => item.workspaceId === workspace?.id) ?? [];
  const changedFiles = selectedQuest?.changedFiles.map((file) => normalizeChangedFile(file)) ?? [];
  const selectedChangedFile =
    changedFiles.find((file) => changedFileKey(file) === selectedChangedFileKey) ?? changedFiles[0];
  const activeBackend = agentBackends.find((backend) => backend.id === agentBackendId);

  useEffect(() => {
    if (!selectedQuestId && quests[0]) {
      setSelectedQuestId(quests[0].id);
    }
  }, [quests, selectedQuestId]);

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
          <button className="toolbar-action" disabled={busy || !selectedQuest} onClick={runQuest} type="button">
            <Play size={15} />
            <span>{selectedQuest?.status === "ready" ? "重新运行" : "运行 Request"}</span>
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="quest-workbench">
        <Sidebar
          knowledgeCount={knowledge.length}
          quests={quests}
          selectedQuest={selectedQuest}
          selectedWorkspaceId={workspace.id}
          workspaces={state.workspaces}
          expandedWorkspaceIds={expandedWorkspaceIds}
          onConfigWorkspace={(workspaceId) => {
            setWorkspaceConfigId(workspaceId);
            setWorkspaceConfigOpen(true);
          }}
          onKnowledgeOpen={() => setKnowledgeOpen(true)}
          onNewQuest={() => {
            setSelectedQuestId("");
            setQuestRequirement("");
            setInspectorTab("spec");
          }}
          onSelectQuest={(questId) => {
            setSelectedQuestId(questId);
            setInspectorTab("spec");
          }}
          onSelectWorkspace={(workspaceId) => {
            setSelectedWorkspaceId(workspaceId);
            setSelectedQuestId("");
            setQuestRequirement("");
            setInspectorTab("spec");
          }}
          onToggleWorkspace={(workspaceId) => {
            setExpandedWorkspaceIds((current) =>
              current.includes(workspaceId) ? current.filter((id) => id !== workspaceId) : [...current, workspaceId]
            );
          }}
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
        <Inspector
          changedFiles={changedFiles}
          events={questEvents}
          projects={projects}
          quest={selectedQuest}
          selectedChangedFile={selectedChangedFile}
          tab={inspectorTab}
          onFileSelect={(file) => {
            setSelectedChangedFileKey(changedFileKey(file));
            setInspectorTab("diff");
          }}
          onTabChange={setInspectorTab}
        />
      </section>

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
  expandedWorkspaceIds,
  knowledgeCount,
  quests,
  selectedQuest,
  selectedWorkspaceId,
  workspaces,
  onConfigWorkspace,
  onKnowledgeOpen,
  onNewQuest,
  onSelectQuest,
  onSelectWorkspace,
  onToggleWorkspace
}: {
  expandedWorkspaceIds: string[];
  knowledgeCount: number;
  quests: Quest[];
  selectedQuest?: Quest;
  selectedWorkspaceId: string;
  workspaces: Workspace[];
  onConfigWorkspace: (workspaceId: string) => void;
  onKnowledgeOpen: () => void;
  onNewQuest: () => void;
  onSelectQuest: (questId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleWorkspace: (workspaceId: string) => void;
}) {
  return (
    <aside className="sidebar">
      <button className="new-quest-button" onClick={onNewQuest} type="button">
        <Plus size={16} />
        <span>创建 Request</span>
        <kbd>N</kbd>
      </button>

      <section className="sidebar-section grow">
        <span className="section-label">Workspaces</span>
        <div className="workspace-tree">
          {workspaces.map((item) => {
            const expanded = expandedWorkspaceIds.includes(item.id);
            const itemQuests = quests.filter((quest) => quest.workspaceId === item.id);
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
                    {itemQuests.length === 0 ? <p className="muted request-empty">暂无 Request</p> : null}
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

      <div className="chat-thread">
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
  changedFiles,
  events,
  projects,
  quest,
  selectedChangedFile,
  tab,
  onFileSelect,
  onTabChange
}: {
  changedFiles: ChangedFile[];
  events: AgentEvent[];
  projects: Project[];
  quest?: Quest;
  selectedChangedFile?: ChangedFile;
  tab: InspectorTab;
  onFileSelect: (file: ChangedFile) => void;
  onTabChange: (tab: InspectorTab) => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: "spec", label: "Spec" },
    { id: "overview", label: "概要" },
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
    </div>
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
    opencode: "OpenCode"
  };
  return labels[backend.id] ?? backend.name;
}
