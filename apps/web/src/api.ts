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

export type AgentBackendId = "mock" | "codex-cli" | "claude-code" | "opencode" | "openai-compatible";

export interface AgentBackendInfo {
  id: AgentBackendId;
  name: string;
  available: boolean;
  configured: boolean;
  command?: string;
  detail: string;
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

export interface ProjectHealth {
  status: "unknown" | "ok" | "missing" | "not_git" | "invalid";
  message: string;
  checkedAt?: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  role: string;
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
  status: string;
  note: string;
  repoRoot?: string;
}

export interface ChangedFile {
  projectId: string;
  path: string;
  status: string;
  diff: string;
  worktreePath: string;
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

export interface CapabilityDefinition {
  id: string;
  kind: "skill" | "agent" | "mcp";
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
    nodes: Array<{ id: string; label: string; role: string }>;
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
  changedFiles: Array<ChangedFile | string>;
  validationResults: string[];
  reviewNotes: string[];
  deliveryResults: DeliveryState[];
  capabilityRecommendations: CapabilityRecommendation[];
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
  agentBackends: () => request<AgentBackendInfo[]>("/api/agent-backends"),
  capabilities: () => request<CapabilityDefinition[]>("/api/capabilities"),
  securityPolicy: () => request<SecurityPolicy>("/api/security-policy"),
  auditLog: () => request<AuditLogEntry[]>("/api/audit-log"),
  updateSecurityPolicy: (input: Partial<Omit<SecurityPolicy, "updatedAt">>) =>
    request<SecurityPolicy>("/api/security-policy", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  productReadiness: (workspaceId?: string) =>
    request<ProductReadiness>(
      `/api/product-readiness${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`
    ),
  searchKnowledge: (workspaceId: string, query: string) =>
    request<KnowledgeItem[]>(`/api/workspaces/${workspaceId}/knowledge?q=${encodeURIComponent(query)}`),
  createQuest: (input: {
    workspaceId: string;
    title: string;
    requirement: string;
    agentBackendId: AgentBackendId;
    affectedProjectIds: string[];
  }) =>
    request<Quest>("/api/quests", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  runQuest: (questId: string) =>
    request<Quest>(`/api/quests/${questId}/run`, {
      method: "POST"
    }),
  retryQuest: (questId: string) =>
    request<Quest>(`/api/quests/${questId}/retry`, {
      method: "POST"
    }),
  cleanupQuest: (questId: string) =>
    request<Quest>(`/api/quests/${questId}/cleanup`, {
      method: "POST"
    }),
  deliverQuest: (questId: string) =>
    request<Quest>(`/api/quests/${questId}/deliver`, {
      method: "POST"
    }),
  acceptCapability: (questId: string, capabilityId: string) =>
    request<Quest>(`/api/quests/${questId}/capabilities/${capabilityId}/accept`, {
      method: "POST"
    }),
  dismissCapability: (questId: string, capabilityId: string) =>
    request<Quest>(`/api/quests/${questId}/capabilities/${capabilityId}/dismiss`, {
      method: "POST"
    }),
  updateWorkspace: (workspaceId: string, input: { name?: string; description?: string; worktreeRoot?: string }) =>
    request<Workspace>(`/api/workspaces/${workspaceId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createProject: (input: {
    workspaceId: string;
    name: string;
    path: string;
    role: string;
    defaultBranch: string;
    validationCommand?: string;
  }) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateProject: (
    projectId: string,
    input: { name?: string; path?: string; role?: string; defaultBranch?: string; validationCommand?: string }
  ) =>
    request<Project>(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  removeProject: (projectId: string) =>
    request<RepoHelmState>(`/api/projects/${projectId}`, {
      method: "DELETE"
    }),
  checkProject: (projectId: string) =>
    request<Project>(`/api/projects/${projectId}/check`, {
      method: "POST"
    })
};
