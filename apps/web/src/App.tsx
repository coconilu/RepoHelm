import {
  BookOpen,
  Boxes,
  CheckCircle2,
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
import { AgentEvent, api, KnowledgeItem, Project, Quest, RepoHelmState, Workspace } from "./api";

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

export function App() {
  const [state, setState] = useState<RepoHelmState | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [selectedQuestId, setSelectedQuestId] = useState<string>("");
  const [questTitle, setQuestTitle] = useState("为 RepoHelm 增加真实 worktree 创建能力");
  const [questRequirement, setQuestRequirement] = useState(
    "在 Quest 执行前，为每个受影响项目创建隔离 worktree，并在 UI 中展示 worktree 路径、分支和状态。"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const nextState = await api.state();
    setState(nextState);
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

  useEffect(() => {
    if (!selectedQuestId && quests[0]) {
      setSelectedQuestId(quests[0].id);
    }
  }, [quests, selectedQuestId]);

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
        affectedProjectIds: projects.map((project) => project.id)
      });
      await load();
      setSelectedQuestId(quest.id);
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
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Route size={20} />
          </div>
          <div>
            <strong>RepoHelm</strong>
            <span>Quest Workspace</span>
          </div>
        </div>
        <div className="workspace-switcher">
          <LayoutDashboard size={16} />
          <select value={workspace.id} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
            {state.workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace-grid">
        <aside className="sidebar">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Workspace</span>
                <h1>{workspace.name}</h1>
              </div>
              <Boxes size={18} />
            </div>
            <p className="muted">{workspace.description}</p>
          </section>

          <section className="panel">
            <div className="panel-heading compact">
              <h2>Projects</h2>
              <span className="count">{projects.length}</span>
            </div>
            <div className="stack">
              {projects.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading compact">
              <h2>Quests</h2>
              <span className="count">{quests.length}</span>
            </div>
            <div className="quest-list">
              {quests.length === 0 ? <p className="muted">还没有 Quest。创建一个来启动工作流。</p> : null}
              {quests.map((quest) => (
                <button
                  className={`quest-row ${quest.id === selectedQuest?.id ? "active" : ""}`}
                  key={quest.id}
                  onClick={() => setSelectedQuestId(quest.id)}
                >
                  <span>{quest.title}</span>
                  <em className={statusClass[quest.status] ?? "badge"}>{statusLabel[quest.status]}</em>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="main-column">
          <form className="quest-composer" onSubmit={createQuest}>
            <div className="composer-title">
              <Sparkles size={18} />
              <strong>创建 Quest</strong>
            </div>
            <div className="field-grid">
              <label>
                <span>标题</span>
                <input aria-label="标题" value={questTitle} onChange={(event) => setQuestTitle(event.target.value)} />
              </label>
              <label>
                <span>需求</span>
                <textarea
                  aria-label="需求"
                  value={questRequirement}
                  onChange={(event) => setQuestRequirement(event.target.value)}
                />
              </label>
            </div>
            <button className="primary-action" disabled={busy} type="submit">
              <Plus size={16} />
              <span>生成 Spec</span>
            </button>
          </form>

          {selectedQuest ? (
            <QuestDetail
              busy={busy}
              events={questEvents}
              knowledge={knowledge}
              projects={projects}
              quest={selectedQuest}
              onRun={runQuest}
            />
          ) : (
            <section className="empty-state">
              <ListChecks size={30} />
              <strong>选择或创建一个 Quest</strong>
              <span>RepoHelm 会围绕 Quest 维护 Spec、worktree、执行记录、Review 和知识库。</span>
            </section>
          )}
        </section>
      </section>
    </main>
  );
}

function ProjectRow({ project }: { project: Project }) {
  return (
    <article className="project-row">
      <div>
        <strong>{project.name}</strong>
        <span>{project.path}</span>
      </div>
      <em>{project.role}</em>
    </article>
  );
}

function QuestDetail({
  busy,
  events,
  knowledge,
  projects,
  quest,
  onRun
}: {
  busy: boolean;
  events: AgentEvent[];
  knowledge: KnowledgeItem[];
  projects: Project[];
  quest: Quest;
  onRun: () => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));

  return (
    <section className="quest-detail">
      <div className="quest-header">
        <div>
          <span className="eyebrow">Quest</span>
          <h2>{quest.title}</h2>
          <p>{quest.requirement}</p>
        </div>
        <button className="run-action" disabled={busy} onClick={onRun} type="button">
          <Play size={16} />
          <span>运行 Quest</span>
        </button>
      </div>

      <div className="detail-grid">
        <section className="panel wide">
          <div className="panel-heading compact">
            <h3>Spec</h3>
            <ShieldCheck size={17} />
          </div>
          <SpecBlock title="用户目标" items={[quest.spec.userGoal]} />
          <SpecBlock title="功能需求" items={quest.spec.functionalRequirements} />
          <SpecBlock title="非功能需求" items={quest.spec.nonFunctionalRequirements} />
          <SpecBlock title="验收标准" items={quest.spec.acceptanceCriteria} />
          <SpecBlock title="暂不做" items={quest.spec.outOfScope} />
        </section>

        <section className="panel">
          <div className="panel-heading compact">
            <h3>Agent 时间线</h3>
            <TerminalSquare size={17} />
          </div>
          <div className="timeline">
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
        </section>

        <section className="panel">
          <div className="panel-heading compact">
            <h3>Worktrees</h3>
            <GitBranch size={17} />
          </div>
          <div className="stack">
            {quest.worktrees.length === 0 ? (
              <p className="muted">运行 Quest 后会生成每项目 worktree 计划。</p>
            ) : null}
            {quest.worktrees.map((worktree) => (
              <article className="worktree-row" key={`${worktree.projectId}-${worktree.worktreePath}`}>
                <strong>{projectById.get(worktree.projectId)?.name ?? worktree.projectId}</strong>
                <code>{worktree.branchName}</code>
                <span>{worktree.worktreePath}</span>
                <em>{worktree.note}</em>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading compact">
            <h3>Validation & Review</h3>
            <CheckCircle2 size={17} />
          </div>
          <SpecBlock title="验证" items={quest.validationResults} empty="还没有验证结果。" />
          <SpecBlock title="Review" items={quest.reviewNotes} empty="还没有 Review 记录。" />
        </section>

        <section className="panel">
          <div className="panel-heading compact">
            <h3>Knowledge</h3>
            <BookOpen size={17} />
          </div>
          <div className="knowledge-list">
            {knowledge.slice(0, 4).map((item) => (
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
        </section>

        <section className="panel">
          <div className="panel-heading compact">
            <h3>Changed Files</h3>
            <Search size={17} />
          </div>
          <div className="file-list">
            {quest.changedFiles.length === 0 ? <p className="muted">运行 Quest 后会展示变更文件。</p> : null}
            {quest.changedFiles.map((file) => (
              <code key={file}>{file}</code>
            ))}
          </div>
        </section>
      </div>
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
