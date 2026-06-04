export type QuestStatus =
  | "draft"
  | "specifying"
  | "planning"
  | "preparing"
  | "executing"
  | "validating"
  | "reviewing"
  | "ready"
  | "delivered"
  | "blocked"
  | "cancelled";

export interface Workspace {
  id: string;
  name: string;
  description: string;
  projectIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  role: string;
  defaultBranch: string;
  createdAt: string;
}

export interface QuestSpec {
  background: string;
  userGoal: string;
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  affectedSurfaces: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  openQuestions: string[];
}

export interface WorktreeState {
  projectId: string;
  branchName: string;
  worktreePath: string;
  status: string;
  note: string;
}

export interface Quest {
  id: string;
  workspaceId: string;
  title: string;
  requirement: string;
  status: QuestStatus;
  spec: QuestSpec;
  affectedProjectIds: string[];
  worktrees: WorktreeState[];
  changedFiles: string[];
  validationResults: string[];
  reviewNotes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentEvent {
  id: string;
  questId: string;
  type: string;
  title: string;
  detail: string;
  agent: string;
  createdAt: string;
}

export interface KnowledgeItem {
  id: string;
  workspaceId: string;
  projectId?: string;
  questId?: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RepoHelmState {
  workspaces: Workspace[];
  projects: Project[];
  quests: Quest[];
  events: AgentEvent[];
  knowledge: KnowledgeItem[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  state: () => request<RepoHelmState>("/api/state"),
  createQuest: (input: { workspaceId: string; title: string; requirement: string; affectedProjectIds: string[] }) =>
    request<Quest>("/api/quests", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  runQuest: (questId: string) =>
    request<Quest>(`/api/quests/${questId}/run`, {
      method: "POST"
    }),
  createProject: (input: { workspaceId: string; name: string; path: string; role: string; defaultBranch: string }) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input)
    })
};

