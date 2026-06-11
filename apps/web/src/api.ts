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

export interface WorkspaceWorktree {
  projectId: string;
  baseBranch: string;
  branchName: string;
  worktreePath: string;
  repoRoot?: string;
  status: "created" | "failed";
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  projectIds: string[];
  worktrees: WorkspaceWorktree[];
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
  name: string;
  path: string;
  role: string;
  defaultBranch: string;
  validationCommand: string;
  health: ProjectHealth;
  knowledgeBranch?: string;
  knowledge?: ProjectKnowledgeMeta;
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

export type PlanApprovalStatus = "pending" | "approved" | "rejected";

export interface PlanApproval {
  status: PlanApprovalStatus;
  approvedAt?: string;
  rejectionReason?: string;
}

export interface OrchestrationPlanStep {
  id: string;
  description: string;
  agentId: string;
  agentName: string;
  dependencies: string[];
  expectedOutput: string;
}

export interface OrchestrationPlan {
  questId: string;
  summary: string;
  steps: OrchestrationPlanStep[];
  notes?: string;
  generatedAt: string;
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
  entrySubAgentId?: string;
  affectedProjectIds: string[];
  relatedKnowledgeIds?: string[];
  worktrees: WorktreeState[];
  changedFiles: Array<ChangedFile | string>;
  validationResults: string[];
  reviewNotes: string[];
  deliveryResults: DeliveryState[];
  capabilityRecommendations: CapabilityRecommendation[];
  agentSummary?: string;
  autoApprovePlan: boolean;
  planApproval?: PlanApproval;
  planPath?: string;
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

export type ProjectKnowledgeStatus = "empty" | "indexing" | "ready" | "stale" | "error";

export interface ProjectKnowledgeMeta {
  lastIndexedSha?: string;
  lastIndexedAt?: string;
  status: ProjectKnowledgeStatus;
  error?: string;
}

export interface RepoWikiPage {
  id: string;
  projectId: string;
  slug: "overview" | "architecture" | "modules" | "key-flows" | "conventions" | "decisions";
  title: string;
  body: string;
  sourcePath: string;
  updatedAtSha?: string;
  updatedAt: string;
}

export interface ProjectKnowledgeView {
  projectId: string;
  knowledgeBranch: string;
  status: ProjectKnowledgeStatus;
  pendingCommits: number;
  head?: string;
  lastIndexedSha?: string;
  lastIndexedAt?: string;
  error?: string;
  pages: RepoWikiPage[];
}

export interface CliModelOption {
  id: string;
  label: string;
}

export interface LocalCliInfo {
  id: string;
  name: string;
  tagline: string;
  bin: string;
  available: boolean;
  version?: string;
  models: CliModelOption[];
  modelsLive: boolean;
  detail: string;
}

export interface CliTestResult {
  id: string;
  ok: boolean;
  latencyMs: number;
  message: string;
}

export type ProviderId = "openai" | "anthropic" | "gemini" | "deepseek" | "openrouter" | "openai-compatible";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  defaultBaseUrl: string;
  keyOptional: boolean;
}

export interface ProviderModelsResult {
  providerId: ProviderId;
  models: CliModelOption[];
  live: boolean;
  detail: string;
  fetchedAt: string;
}

export interface ByokConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface EngineConfig {
  mode: "cli" | "byok";
  cliId: string;
  cliModels: Record<string, string>;
  byokProviders: Record<string, ByokConfig>;
  activeByokProviderId: string;
  modelKits: Record<string, ModelKit>; // 新增
  embeddingModelKitId?: string;
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
  engine: EngineConfig;
  subAgents: Record<string, SubAgent>;
  entrySubAgentId?: string;
  userPreferences: Record<string, UserPreference>;
  failurePatterns: Record<string, FailurePattern>;
}

export interface TestModelInput {
  type: "cli" | "byok";
  backendId?: string;
  providerId?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  name: string;
  costTier?: "free" | "low" | "medium" | "high";
  performanceProfile?: "fast" | "balanced" | "accurate";
}

export interface ModelKitMetadata {
  createdAt: string;
  testedAt: string;
  lastUsedAt?: string;
  costTier: "free" | "low" | "medium" | "high";
  performanceProfile: "fast" | "balanced" | "accurate";
}

export interface ModelKit {
  id: string;
  name: string;
  type: "cli" | "byok";
  backendId?: string;
  providerId?: string;
  model: string;
  config: any;
  metadata: ModelKitMetadata;
}

// Sub-agent 相关类型定义
export interface SubAgentPermissions {
  allowedTools: string[];
  deniedTools: string[];
  maxSteps?: number;
}

export interface SubAgentMetadata {
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface SubAgent {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  modelKitId: string;
  mode?: "entry" | "worker" | "system";
  systemRole?: "knowledge" | "habits" | "failure-experience";
  permissions: SubAgentPermissions;
  promptTemplate?: string;
  metadata: SubAgentMetadata;
}

export interface CreateSubAgentInput {
  id?: string;
  name: string;
  role: string;
  capabilities?: string[];
  modelKitId: string;
  mode?: "entry" | "worker" | "system";
  systemRole?: "knowledge" | "habits" | "failure-experience";
  permissions?: SubAgentPermissions;
  promptTemplate?: string;
}

export interface UpdateSubAgentInput {
  name?: string;
  role?: string;
  capabilities?: string[];
  modelKitId?: string;
  mode?: "entry" | "worker" | "system";
  systemRole?: "knowledge" | "habits" | "failure-experience";
  permissions?: SubAgentPermissions;
  promptTemplate?: string;
}

export type PreferenceCategory = "coding_style" | "naming" | "architecture" | "tooling" | "workflow" | "other";
export type PreferenceSource = "explicit" | "observed" | "correction" | "inferred";

export interface UserPreference {
  id: string;
  category: PreferenceCategory;
  key: string;
  value: string;
  confidence: number;
  source: PreferenceSource;
  occurrences: number;
  examples: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserPreferenceInput {
  category: PreferenceCategory;
  key: string;
  value: string;
  confidence?: number;
  source?: PreferenceSource;
  example?: string;
}

export type FailureCategory =
  | "type_error"
  | "test_failure"
  | "build_error"
  | "logic_bug"
  | "architecture"
  | "security"
  | "performance"
  | "other";

export interface FailurePattern {
  id: string;
  category: FailureCategory;
  title: string;
  description: string;
  rootCause: string;
  context: string;
  mitigation: string;
  signals: string[];
  projectId?: string;
  questId?: string;
  severity: "low" | "medium" | "high";
  resolved: boolean;
  createdAt: string;
  resolvedAt?: string;
}

export interface CreateFailurePatternInput {
  category: FailureCategory;
  title: string;
  description: string;
  rootCause: string;
  context: string;
  mitigation: string;
  signals?: string[];
  projectId?: string;
  questId?: string;
  severity?: "low" | "medium" | "high";
}

export interface CreateModelKitInput {
  id?: string;
  name: string;
  type: "cli" | "byok";
  backendId?: string;
  providerId?: string;
  model: string;
  config: any;
  costTier?: "free" | "low" | "medium" | "high";
  performanceProfile?: "fast" | "balanced" | "accurate";
}

export interface UpdateModelKitInput {
  name?: string;
  model?: string;
  config?: any;
  costTier?: "free" | "low" | "medium" | "high";
  performanceProfile?: "fast" | "balanced" | "accurate";
}

// Expert orchestration types
export type ExpertSessionStatus = "analyzing" | "awaiting_confirmation" | "confirmed" | "executing" | "completed" | "failed";
export type TaskNodeType = "root" | "analysis" | "research" | "implementation" | "test" | "review" | "delivery";
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
export type AcceptanceTestStatus = "draft" | "confirmed" | "generated" | "passing" | "failing";

export interface ExpertSession {
  id: string;
  questId: string;
  status: ExpertSessionStatus;
  entryAgentId: string;
  taskTree: ExpertTaskNode;
  flatTasks: ExpertTask[];
  acceptanceTests: AcceptanceTest[];
  research: CodeResearchResult[];
  agentPool: AgentPoolSnapshot;
  createdAt: string;
  confirmedAt?: string;
  completedAt?: string;
  errors: ExpertError[];
}

export interface ExpertTaskNode {
  id: string;
  title: string;
  type: TaskNodeType;
  status: TaskStatus;
  assignedAgentId?: string;
  assignedAgentName?: string;
  children: ExpertTaskNode[];
  dependencies: string[];
  research?: CodeResearchResult;
  artifacts: TaskArtifact[];
  acceptanceTestIds?: string[];
  description: string;
  expectedOutput: string;
  summary?: string;
}

export interface ExpertTask {
  id: string;
  nodeId: string;
  title: string;
  description: string;
  type: TaskNodeType;
  status: TaskStatus;
  assignedAgentId?: string;
  assignedAgentName?: string;
  agentAvatar?: string;
  progress?: number;
  startedAt?: string;
  completedAt?: string;
  artifacts: TaskArtifact[];
  failureReason?: string;
}

export interface AcceptanceTest {
  id: string;
  title: string;
  description: string;
  status: AcceptanceTestStatus;
  testType: "unit" | "integration" | "e2e";
  relatedTaskIds: string[];
  userConfirmed: boolean;
  userNotes?: string;
  generatedTestPath?: string;
  testOutput?: string;
}

export interface CodeResearchResult {
  id: string;
  taskId?: string;
  type: "reusable_function" | "existing_logic" | "proposed_change" | "related_code";
  title: string;
  filePath?: string;
  codeSnippet?: string;
  lineRange?: { start: number; end: number };
  summary: string;
  proposedLogic?: string;
  reasoning?: string;
}

export interface AgentPoolSnapshot {
  prototypes: Array<{
    id: string;
    name: string;
    role: string;
    capabilities: string[];
    isBuiltIn: boolean;
  }>;
  dynamicAgents: Array<{
    id: string;
    name: string;
    createdBy: string;
    taskId?: string;
  }>;
  activeAgents: string[];
}

export interface TaskArtifact {
  id: string;
  taskId: string;
  type: "file_change" | "test_result" | "research_summary" | "review_comment";
  filePath?: string;
  projectId?: string;
  summary: string;
  diff?: string;
  createdAt: string;
}

export interface ExpertError {
  code: string;
  message: string;
  detail: string;
  recoverable: boolean;
  affectedTaskIds: string[];
  createdAt: string;
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
  listClis: () => request<LocalCliInfo[]>("/api/clis"),
  rescanClis: () => request<LocalCliInfo[]>("/api/clis/rescan", { method: "POST" }),
  testCli: (id: string) => request<CliTestResult>(`/api/clis/${id}/test`, { method: "POST" }),
  listProviders: () => request<ProviderInfo[]>("/api/providers"),
  listProviderModels: (
    providerId: string,
    input: { baseUrl?: string; apiKey?: string; refresh?: boolean } = {}
  ) =>
    request<ProviderModelsResult>(`/api/providers/${providerId}/models`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  testProvider: (providerId: string, input: { baseUrl?: string; apiKey?: string } = {}) =>
    request<CliTestResult>(`/api/providers/${providerId}/test`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  getEngine: () => request<EngineConfig>("/api/engine"),
  updateEngine: (input: Partial<Omit<EngineConfig, "updatedAt">>) =>
    request<EngineConfig>("/api/engine", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
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
  getKnowledgePages: (ids: string[]) =>
    request<RepoWikiPage[]>("/api/knowledge/pages", {
      method: "POST",
      body: JSON.stringify({ ids })
    }),
  getProjectKnowledge: (projectId: string) =>
    request<ProjectKnowledgeView>(`/api/projects/${projectId}/knowledge`),
  syncProjectKnowledge: (projectId: string) =>
    request<ProjectKnowledgeView>(`/api/projects/${projectId}/knowledge/sync`, { method: "POST" }),
  setKnowledgeBranch: (projectId: string, knowledgeBranch: string) =>
    request<Project>(`/api/projects/${projectId}/knowledge`, {
      method: "PATCH",
      body: JSON.stringify({ knowledgeBranch })
    }),
  createWorkspace: (input: { name: string; description?: string; worktreeRoot?: string }) =>
    request<Workspace>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  createQuest: (input: {
    workspaceId: string;
    title: string;
    requirement: string;
    agentBackendId?: AgentBackendId;
    entrySubAgentId?: string;
    affectedProjectIds?: string[];
    autoApprovePlan?: boolean;
  }) =>
    request<Quest>("/api/quests", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  runQuest: (questId: string) =>
    request<Quest>(`/api/quests/${questId}/run`, {
      method: "POST"
    }),
  enhanceRequirement: (text: string) =>
    request<{ requirement: string }>("/api/assist/enhance-requirement", {
      method: "POST",
      body: JSON.stringify({ text })
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
  approvePlan: (questId: string) =>
    request<Quest>(`/api/quests/${questId}/approve-plan`, {
      method: "POST"
    }),
  rejectPlan: (questId: string, reason?: string) =>
    request<Quest>(`/api/quests/${questId}/reject-plan`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  getQuestPlan: (questId: string) =>
    request<OrchestrationPlan>(`/api/quests/${questId}/plan`),
  updateWorkspace: (workspaceId: string, input: { name?: string; description?: string; worktreeRoot?: string }) =>
    request<Workspace>(`/api/workspaces/${workspaceId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createProject: (input: {
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
  linkProject: (workspaceId: string, projectId: string) =>
    request<Workspace>(`/api/workspaces/${workspaceId}/links`, {
      method: "POST",
      body: JSON.stringify({ projectId })
    }),
  unlinkProject: (workspaceId: string, projectId: string) =>
    request<Workspace>(`/api/workspaces/${workspaceId}/links/${projectId}`, {
      method: "DELETE"
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
  openProjectDirectory: (projectId: string) =>
    request<{ ok: boolean }>(`/api/projects/${projectId}/open-directory`, {
      method: "POST"
    }),
  openWorktreeDirectory: (workspaceId: string, projectId: string) =>
    request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/worktrees/${projectId}/open-directory`, {
      method: "POST"
    }),
  pickDirectory: () =>
    request<{ path: string | null; error?: string }>("/api/pick-directory", {
      method: "POST"
    }),
  listBranches: (path: string) =>
    request<{ branches: string[]; defaultBranch: string; currentBranch: string }>(`/api/branches?path=${encodeURIComponent(path)}`),
  checkProject: (projectId: string) =>
    request<Project>(`/api/projects/${projectId}/check`, {
      method: "POST"
    }),
  listModelKits: () => request<ModelKit[]>("/api/model-kits"),
  createModelKit: (input: CreateModelKitInput) =>
    request<ModelKit>("/api/model-kits", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateModelKit: (id: string, input: UpdateModelKitInput) =>
    request<ModelKit>(`/api/model-kits/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteModelKit: (id: string) =>
    request<{ ok: boolean }>(`/api/model-kits/${id}`, {
      method: "DELETE"
    }),
  testAndSaveModelKit: (input: TestModelInput) =>
    request<ModelKit>("/api/model-kits/test-and-save", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  // Sub-agent API 函数
  listSubAgents: () => request<SubAgent[]>("/api/sub-agents"),
  createSubAgent: (input: CreateSubAgentInput) =>
    request<SubAgent>("/api/sub-agents", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateSubAgent: (id: string, input: UpdateSubAgentInput) =>
    request<SubAgent>(`/api/sub-agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteSubAgent: (id: string) =>
    request<{ ok: boolean }>(`/api/sub-agents/${id}`, {
      method: "DELETE"
    }),
  setEntrySubAgent: (id: string) =>
    request<{ ok: boolean }>("/api/sub-agents/set-entry", {
      method: "POST",
      body: JSON.stringify({ id })
    }),
  getEntrySubAgent: () => request<SubAgent | undefined>("/api/sub-agents/entry"),
  // 系统 Agent 调用
  invokeSystemAgent: (agentId: string, input: { task: string; context?: Record<string, unknown> }) =>
    request<{ content: string }>(`/api/system-agents/${agentId}/invoke`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  // 用户偏好 API
  listPreferences: () => request<UserPreference[]>("/api/preferences"),
  recordPreference: (input: CreateUserPreferenceInput) =>
    request<UserPreference>("/api/preferences", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deletePreference: (id: string) =>
    request<{ ok: boolean }>(`/api/preferences/${id}`, {
      method: "DELETE"
    }),
  // 失败模式 API
  listFailures: () => request<FailurePattern[]>("/api/failures"),
  recordFailure: (input: CreateFailurePatternInput) =>
    request<FailurePattern>("/api/failures", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  searchFailures: (query: string, options?: { category?: string; projectId?: string }) =>
    request<FailurePattern[]>("/api/failures/search", {
      method: "POST",
      body: JSON.stringify({ query, ...options })
    }),
  updateFailure: (id: string, input: { resolved?: boolean; severity?: string; mitigation?: string }) =>
    request<FailurePattern>(`/api/failures/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  // Expert Session API
  createExpertSession: (input: { questId: string; requirement: string; entryAgentId?: string; projectIds?: string[] }) =>
    request<{ session: ExpertSession }>("/api/expert/session", { method: "POST", body: JSON.stringify(input) }),
  getExpertSession: (id: string) =>
    request<{ session: ExpertSession }>(`/api/expert/session/${id}`),
  updateExpertSession: (id: string, updates: Partial<ExpertSession>) =>
    request<{ session: ExpertSession }>(`/api/expert/session/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
  confirmExpertSession: (id: string, input?: { acceptanceTestIds?: string[]; skipAcceptanceTests?: boolean }) =>
    request<{ session: ExpertSession }>(`/api/expert/session/${id}/confirm`, { method: "POST", body: JSON.stringify(input || {}) }),
  getExpertDeliverables: (id: string) =>
    request(`/api/expert/session/${id}/deliverables`),
  getExpertReferences: (id: string) =>
    request(`/api/expert/session/${id}/references`),
  getExpertResearch: (id: string) =>
    request(`/api/expert/session/${id}/research`),
  getExpertAcceptanceTests: (id: string) =>
    request(`/api/expert/session/${id}/acceptance-tests`)
};
