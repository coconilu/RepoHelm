import {
  BookOpen,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare
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

type InspectorTab = "overview" | "files" | "diff" | "knowledge" | "logs";

export function App() {
  const [state, setState] = useState<RepoHelmState | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [selectedQuestId, setSelectedQuestId] = useState<string>("");
  const [questTitle, setQuestTitle] = useState("为 RepoHelm 增加真实 worktree 创建能力");
  const [questRequirement, setQuestRequirement] = useState(
    "在 Quest 执行前，为每个受影响项目创建隔离 worktree，并在 UI 中展示 worktree 路径、分支和状态。"
  );
  const [agentBackendId, setAgentBackendId] = useState<AgentBackendId>("mock");
  const [agentBackends, setAgentBackends] = useState<AgentBackendInfo[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [selectedChangedFileKey, setSelectedChangedFileKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const [nextState, nextBackends] = await Promise.all([api.state(), api.agentBackends()]);
    setState(nextState);
    setAgentBackends(nextBackends);
    setSelectedWorkspaceId((current) => current || nextState.workspaces[0]?.id || "");
    setSelectedQuestId((current) => current || nextState.quests[0]?.id || "");
  };

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const workspace = useMemo(
    () => state?.workspaces.find((item) => item.id === selectedWorkspaceId) ?? state?.workspaces[0],
    [selectedWorkspaceId, state?.workspaces]
  );
  const projects = useMemo(
    () => state?.projects.filter((project) => project.workspaceId === workspace?.id) ?? [],
    [state?.projects, workspace?.id]
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
    setBusy(true);
    setError("");
    try {
      const quest = await api.createQuest({
        workspaceId: workspace.id,
        title: questTitle,
        requirement: questRequirement,
        agentBackendId,
        affectedProjectIds: projects.map((project) => project.id)
      });
      await load();
      setSelectedQuestId(quest.id);
      setInspectorTab("overview");
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
          <label className="toolbar-select">
            <LayoutDashboard size={15} />
            <select value={workspace.id} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
              {state.workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <span className={activeBackend?.available ? "backend-pill available" : "backend-pill"}>
            <Bot size={14} />
            {activeBackend?.name ?? "Backend"}
          </span>
          <button className="toolbar-action" disabled={busy || !selectedQuest} onClick={runQuest} type="button">
            <Play size={15} />
            <span>{selectedQuest?.status === "ready" ? "重新运行" : "运行 Quest"}</span>
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="quest-workbench">
        <Sidebar
          knowledgeCount={knowledge.length}
          projects={projects}
          quests={quests}
          selectedQuest={selectedQuest}
          workspace={workspace}
          onNewQuest={() => {
            setSelectedQuestId("");
            setInspectorTab("overview");
          }}
          onSelectQuest={(questId) => {
            setSelectedQuestId(questId);
            setInspectorTab("overview");
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
          questTitle={questTitle}
          workspace={workspace}
          onBackendChange={setAgentBackendId}
          onCreateQuest={createQuest}
          onRequirementChange={setQuestRequirement}
          onRunQuest={runQuest}
          onTitleChange={setQuestTitle}
        />
        <Inspector
          changedFiles={changedFiles}
          events={questEvents}
          knowledge={knowledge}
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
    </main>
  );
}

function Sidebar({
  knowledgeCount,
  projects,
  quests,
  selectedQuest,
  workspace,
  onNewQuest,
  onSelectQuest
}: {
  knowledgeCount: number;
  projects: Project[];
  quests: Quest[];
  selectedQuest?: Quest;
  workspace: Workspace;
  onNewQuest: () => void;
  onSelectQuest: (questId: string) => void;
}) {
  return (
    <aside className="sidebar">
      <button className="new-quest-button" onClick={onNewQuest} type="button">
        <Plus size={16} />
        <span>创建 Quest</span>
        <kbd>N</kbd>
      </button>

      <section className="sidebar-section">
        <span className="section-label">Workspace</span>
        <div className="workspace-card">
          <Boxes size={16} />
          <div>
            <strong>{workspace.name}</strong>
            <span>{workspace.description}</span>
          </div>
        </div>
      </section>

      <section className="sidebar-section">
        <span className="section-label">Projects</span>
        <div className="nav-list">
          {projects.map((project) => (
            <div className="project-row" key={project.id}>
              <FileText size={15} />
              <div>
                <strong>{project.name}</strong>
                <span>{project.role}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sidebar-section grow">
        <span className="section-label">Quests</span>
        <div className="quest-list">
          {quests.length === 0 ? <p className="muted">暂无 Quest</p> : null}
          {quests.map((quest) => (
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
      </section>

      <section className="sidebar-footer">
        <BookOpen size={15} />
        <span>知识中心</span>
        <em>{knowledgeCount}</em>
      </section>
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
  questTitle,
  workspace,
  onBackendChange,
  onCreateQuest,
  onRequirementChange,
  onRunQuest,
  onTitleChange
}: {
  agentBackendId: AgentBackendId;
  agentBackends: AgentBackendInfo[];
  busy: boolean;
  events: AgentEvent[];
  projects: Project[];
  quest?: Quest;
  questRequirement: string;
  questTitle: string;
  workspace: Workspace;
  onBackendChange: (backend: AgentBackendId) => void;
  onCreateQuest: (event: FormEvent) => void;
  onRequirementChange: (value: string) => void;
  onRunQuest: () => void;
  onTitleChange: (value: string) => void;
}) {
  const questBackend = agentBackends.find((backend) => backend.id === quest?.agentBackendId);

  return (
    <section className="quest-stage">
      <div className="stage-intro">
        <div className="ghost-mark">
          <Sparkles size={26} />
        </div>
        <div>
          <p className="eyebrow">Quest</p>
          <h1>{quest ? quest.title : "Quest on, hands off"}</h1>
          <div className="run-context">
            <span>{workspace.name}</span>
            <ChevronDown size={14} />
            <span>{questBackend?.name ?? agentBackends.find((backend) => backend.id === agentBackendId)?.name ?? "Mock"}</span>
            <ChevronDown size={14} />
            <span>{projects.length} project{projects.length === 1 ? "" : "s"}</span>
          </div>
        </div>
      </div>

      <form className="quest-composer" onSubmit={onCreateQuest}>
        <div className="composer-grid">
          <label>
            <span>标题</span>
            <input aria-label="标题" value={questTitle} onChange={(event) => onTitleChange(event.target.value)} />
          </label>
          <label>
            <span>Agent Backend</span>
            <select
              aria-label="Agent Backend"
              className="field-select"
              value={agentBackendId}
              onChange={(event) => onBackendChange(event.target.value as AgentBackendId)}
            >
              {agentBackends.map((backend) => (
                <option key={backend.id} value={backend.id}>
                  {backend.name} {backend.available ? "可用" : backend.configured ? "待启用" : "未配置"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="composer-textarea">
          <span>描述计划、引用上下文，或说明验收标准</span>
          <textarea
            aria-label="需求"
            value={questRequirement}
            onChange={(event) => onRequirementChange(event.target.value)}
          />
        </label>
        <div className="composer-footer">
          <span>{agentBackends.find((backend) => backend.id === agentBackendId)?.detail ?? "正在读取 backend 状态。"}</span>
          <button className="send-button" disabled={busy} type="submit">
            <Plus size={16} />
            <span>生成 Spec</span>
          </button>
        </div>
      </form>

      {quest ? (
        <div className="stage-content">
          <section className="stage-panel">
            <div className="panel-heading compact">
              <h2>Spec</h2>
              <ShieldCheck size={17} />
            </div>
            <SpecBlock title="用户目标" items={[quest.spec.userGoal]} />
            <SpecBlock title="功能需求" items={quest.spec.functionalRequirements} />
            <SpecBlock title="非功能需求" items={quest.spec.nonFunctionalRequirements} />
            <SpecBlock title="验收标准" items={quest.spec.acceptanceCriteria} />
            <SpecBlock title="暂不做" items={quest.spec.outOfScope} />
          </section>

          <section className="stage-panel compact-panel">
            <div className="panel-heading compact">
              <h2>Execution</h2>
              <TerminalSquare size={17} />
            </div>
            <Timeline events={events} />
          </section>

          <button className="run-action" disabled={busy} onClick={onRunQuest} type="button">
            <Play size={16} />
            <span>{quest.status === "ready" ? "重新运行 Quest" : "运行 Quest"}</span>
          </button>
        </div>
      ) : (
        <div className="empty-hint">
          <ListChecks size={22} />
          <span>创建 Quest 后，Spec、执行进度和 worktree 状态会在这里展开。</span>
        </div>
      )}
    </section>
  );
}

function Inspector({
  changedFiles,
  events,
  knowledge,
  projects,
  quest,
  selectedChangedFile,
  tab,
  onFileSelect,
  onTabChange
}: {
  changedFiles: ChangedFile[];
  events: AgentEvent[];
  knowledge: KnowledgeItem[];
  projects: Project[];
  quest?: Quest;
  selectedChangedFile?: ChangedFile;
  tab: InspectorTab;
  onFileSelect: (file: ChangedFile) => void;
  onTabChange: (tab: InspectorTab) => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: "overview", label: "概要" },
    { id: "files", label: "文件" },
    { id: "diff", label: "Diff" },
    { id: "knowledge", label: "知识" },
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
        {tab === "overview" ? (
          <OverviewPanel changedFiles={changedFiles} events={events} projects={projects} quest={quest} />
        ) : null}
        {tab === "files" ? (
          <FilesPanel changedFiles={changedFiles} projectById={projectById} onFileSelect={onFileSelect} />
        ) : null}
        {tab === "diff" ? <DiffPanel file={selectedChangedFile} projectById={projectById} /> : null}
        {tab === "knowledge" ? <KnowledgePanel knowledge={knowledge} /> : null}
        {tab === "logs" ? <Timeline events={events} /> : null}
      </div>
    </aside>
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
      {knowledge.slice(0, 8).map((item) => (
        <article className="knowledge-row" key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.body}</span>
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
