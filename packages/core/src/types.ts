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
export type AgentBackendId = "mock" | "codex-cli" | "claude-code" | "opencode" | "openai-compatible";
export type ProjectHealthStatus = "unknown" | "ok" | "missing" | "not_git" | "invalid";

export interface ProjectHealth {
  status: ProjectHealthStatus;
  message: string;
  checkedAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  projectIds: string[];
  worktreeRoot: string;
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
  validationCommand: string;
  health: ProjectHealth;
  createdAt: string;
  updatedAt: string;
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
  status: "not_created" | "planned" | "created" | "failed" | "cleaned";
  note: string;
  repoRoot?: string;
}

export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked" | "unknown";

export interface ChangedFile {
  projectId: string;
  path: string;
  status: ChangeKind;
  diff: string;
  worktreePath: string;
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

export interface DeliveryState {
  projectId: string;
  worktreePath: string;
  status: "validated" | "committed" | "pr_ready" | "pr_created" | "failed";
  commitMessage: string;
  note: string;
  validationOutput?: string;
  commitSha?: string;
  prUrl?: string;
  createdAt: string;
}

export type CapabilityKind = "skill" | "agent" | "mcp";

export interface CapabilityDefinition {
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  source: "builtin" | "workspace" | "external";
  permissions: string[];
  installed: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityRecommendation {
  capabilityId: string;
  reason: string;
  confidence: number;
  requiredPermissions: string[];
  status: "pending" | "accepted" | "dismissed";
  createdAt: string;
}

export interface SecurityPolicy {
  commandApprovalMode: "allowlist" | "manual";
  allowedCommands: string[];
  fileScopes: string[];
  networkScopes: string[];
  secretsPolicy: "redact-env" | "deny";
  sandboxRuntime: "local" | "external";
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  type: "command" | "file" | "network" | "secrets" | "capability" | "sandbox";
  decision: "allowed" | "denied" | "recorded";
  subject: string;
  detail: string;
  createdAt: string;
}

export interface ProductReadinessItem {
  id: string;
  label: string;
  status: "ready" | "partial" | "planned";
  detail: string;
}

export interface ProductReadiness {
  version: string;
  status: "prototype-ready" | "incomplete";
  milestones: ProductReadinessItem[];
  workspaceTemplates: ProductReadinessItem[];
  dependencyMap: {
    nodes: Array<{ id: string; label: string; role: ProjectRole }>;
    edges: Array<{ from: string; to: string; label: string }>;
  };
  governance: ProductReadinessItem[];
}

export interface Quest {
  id: string;
  workspaceId: string;
  title: string;
  requirement: string;
  status: QuestStatus;
  spec: QuestSpec;
  agentBackendId: AgentBackendId;
  affectedProjectIds: string[];
  worktrees: WorktreeState[];
  changedFiles: ChangedFile[];
  validationResults: string[];
  reviewNotes: string[];
  deliveryResults: DeliveryState[];
  capabilityRecommendations: CapabilityRecommendation[];
  agentSummary?: string;
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
  sourcePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepoHelmState {
  workspaces: Workspace[];
  projects: Project[];
  quests: Quest[];
  events: AgentEvent[];
  knowledge: KnowledgeItem[];
  capabilities: CapabilityDefinition[];
  securityPolicy: SecurityPolicy;
  auditLog: AuditLogEntry[];
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  worktreeRoot?: string;
}

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  path: string;
  role?: ProjectRole;
  defaultBranch?: string;
  validationCommand?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  worktreeRoot?: string;
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
  role?: ProjectRole;
  defaultBranch?: string;
  validationCommand?: string;
}

export interface CreateQuestInput {
  workspaceId: string;
  title: string;
  requirement: string;
  agentBackendId?: AgentBackendId;
  affectedProjectIds?: string[];
}
