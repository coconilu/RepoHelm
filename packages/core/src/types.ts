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

export type ProjectRole = "frontend" | "backend" | "documentation" | "library" | "infra" | "unknown";

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
  role: ProjectRole;
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
  status: "not_created" | "planned" | "created" | "failed";
  note: string;
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

export interface KnowledgeItem {
  id: string;
  workspaceId: string;
  projectId?: string;
  questId?: string;
  type: "repo-wiki" | "architecture" | "decision" | "memory" | "troubleshooting";
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

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
}

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  path: string;
  role?: ProjectRole;
  defaultBranch?: string;
}

export interface CreateQuestInput {
  workspaceId: string;
  title: string;
  requirement: string;
  affectedProjectIds?: string[];
}

