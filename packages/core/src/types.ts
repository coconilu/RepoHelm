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

export interface Project {
  id: string;
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

export interface CliModelOption {
  id: string;
  label: string;
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

export interface ModelCacheEntry {
  models: CliModelOption[];
  live: boolean;
  detail: string;
  fetchedAt: string;
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

export interface ByokConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * ModelKit 元数据信息，记录模型的性能和成本特征
 */
export interface ModelKitMetadata {
  createdAt: string; // 创建时间
  testedAt: string; // 最后测试时间
  lastUsedAt?: string; // 最后使用时间（可选）
  costTier: "free" | "low" | "medium" | "high"; // 成本等级
  performanceProfile: "fast" | "balanced" | "accurate"; // 性能配置：快速、平衡或准确
}

/**
 * ModelKit 定义,封装了模型的完整配置信息
 */
export interface ModelKit {
  id: string; // 唯一标识符
  name: string; // 名称
  type: "cli" | "byok"; // 类型:CLI 模式或 BYOK 模式
  backendId?: string; // CLI 后端 ID(仅 cli 类型)
  providerId?: string; // 提供商 ID(仅 byok 类型)
  model: string; // 模型名称
  config: any; // 配置信息,暂时使用 any,后续可细化为 CliBackendConfig | ByokConfig
  metadata: ModelKitMetadata; // 元数据信息
}

/**
 * SubAgent 权限配置,定义子代理的工具访问和步数限制
 */
export interface SubAgentPermissions {
  allowedTools: string[]; // 允许使用的工具列表
  deniedTools: string[]; // 禁止使用的工具列表
  maxSteps?: number; // 最大执行步数(可选)
}

/**
 * SubAgent 元数据信息,记录创建和使用情况
 */
export interface SubAgentMetadata {
  createdAt: string; // 创建时间
  updatedAt: string; // 更新时间
  usageCount: number; // 使用次数
}

/**
 * SubAgent 定义,表示一个专门化的子代理实例
 */
export interface SubAgent {
  id: string; // 唯一标识符
  name: string; // 名称
  role: string; // 角色描述
  capabilities: string[]; // 能力列表
  modelKitId: string; // 绑定的 ModelKit ID(一对一绑定关系)
  mode: "entry" | "worker"; // 模式:入口 agent 或工作 agent
  permissions: SubAgentPermissions; // 权限配置
  promptTemplate?: string; // 提示词模板(可选)
  metadata: SubAgentMetadata; // 元数据信息
}

export interface EngineConfig {
  mode: "cli" | "byok";
  cliId: string;
  cliModels: Record<string, string>;
  byokProviders: Record<string, ByokConfig>;
  activeByokProviderId: string;
  modelKits: Record<string, ModelKit>; // ModelKit 集合，按 ID 索引
  updatedAt: string;
}

export interface UpdateEngineInput {
  mode?: "cli" | "byok";
  cliId?: string;
  cliModels?: Record<string, string>;
  byokProviders?: Record<string, Partial<ByokConfig>>;
  activeByokProviderId?: string;
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
  modelCache: Record<string, ModelCacheEntry>;
  subAgents: Record<string, SubAgent>; // SubAgent 集合,按 ID 索引
  entrySubAgentId?: string; // 入口 SubAgent 的 ID(可选)
}

export interface ListProviderModelsInput {
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
  refresh?: boolean;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  worktreeRoot?: string;
}

export interface CreateProjectInput {
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

/**
 * 创建 ModelKit 的输入参数
 */
export interface CreateModelKitInput {
  id?: string; // 可选,不传则自动生成
  name: string;
  type: "cli" | "byok";
  backendId?: string; // cli 类型必需
  providerId?: string; // byok 类型必需
  model: string;
  config: any;
  costTier?: "free" | "low" | "medium" | "high";
  performanceProfile?: "fast" | "balanced" | "accurate";
}

/**
 * 更新 ModelKit 的输入参数(所有字段可选)
 */
export interface UpdateModelKitInput {
  name?: string;
  model?: string;
  config?: any;
  costTier?: "free" | "low" | "medium" | "high";
  performanceProfile?: "fast" | "balanced" | "accurate";
}

/**
 * 测试并保存 ModelKit 的输入参数
 */
export interface TestModelInput {
  type: "cli" | "byok";
  backendId?: string; // cli 类型时提供
  providerId?: string; // byok 类型时提供
  model: string;
  apiKey?: string; // byok 类型时可选
  baseUrl?: string; // byok 类型时可选
  name: string;
  costTier?: "free" | "low" | "medium" | "high";
  performanceProfile?: "fast" | "balanced" | "accurate";
}

/**
 * 创建 SubAgent 的输入参数
 */
export interface CreateSubAgentInput {
  id?: string; // 可选,不传则自动生成
  name: string;
  role: string;
  capabilities?: string[];
  modelKitId: string;
  mode: "entry" | "worker";
  permissions?: SubAgentPermissions;
  promptTemplate?: string;
}

/**
 * 更新 SubAgent 的输入参数(所有字段可选)
 */
export interface UpdateSubAgentInput {
  name?: string;
  role?: string;
  capabilities?: string[];
  modelKitId?: string;
  mode?: "entry" | "worker";
  permissions?: SubAgentPermissions;
  promptTemplate?: string;
}
