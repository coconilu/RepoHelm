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
  knowledgeBranch?: string;          // KB truth branch; defaults to defaultBranch
  knowledge?: ProjectKnowledgeMeta;  // persisted index metadata
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

export interface TaskContract {
  outputFormat?: string;     // 产出格式（缺则回退到 step.expectedOutput）
  boundaries?: string;       // 边界 / 不要做什么
  sourcesGuidance?: string;  // 信息源与注意事项（纯文本）
  doneCriteria?: string;     // 完成判据（done 长什么样）
}

export interface OrchestrationPlanStep {
  id: string;
  description: string;
  agentId: string;
  agentName: string;
  dependencies: string[];
  expectedOutput: string;
  targetProjectId?: string;
  contract?: TaskContract;
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
  /**
   * argv-prefix templates that a model-generated worker `run_command` may run
   * (e.g. "pnpm test", "git diff --name-only"). Stricter than `allowedCommands`
   * (which is a bare command-name list used for user-configured validation),
   * because workers run through a shell and a bare binary name is too broad.
   */
  commandTemplates: string[];
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
  entrySubAgentId?: string;
  affectedProjectIds: string[];
  relatedKnowledgeIds?: string[];
  worktrees: WorktreeState[];
  changedFiles: ChangedFile[];
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

export type QuestSpecStreamEvent =
  | { type: "analysis_delta"; text: string }
  | { type: "spec_ready"; spec: QuestSpec }
  | { type: "event_added"; event: AgentEvent }
  | { type: "done"; quest: Quest }
  | { type: "error"; message: string };

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

export type RepoWikiSlug =
  | "overview"
  | "architecture"
  | "modules"
  | "key-flows"
  | "conventions"
  | "decisions";

export const REPO_WIKI_SLUGS: RepoWikiSlug[] = [
  "overview",
  "architecture",
  "modules",
  "key-flows",
  "conventions",
  "decisions"
];

export interface RepoWikiPage {
  id: string;            // wiki_<projectId>_<slug>
  projectId: string;
  slug: RepoWikiSlug;
  title: string;
  body: string;          // Markdown, source of truth
  sourcePath: string;    // .repohelm/knowledge/<projectId>/<slug>.md
  updatedAtSha?: string;
  updatedAt: string;
}

export interface WikiChunkEmbedding {
  id: string;            // chunk_<pageId>_<idx>
  projectId: string;
  pageId: string;
  slug: RepoWikiSlug;
  chunkText: string;
  vector: number[];
  model: string;         // embedding model that produced the vector
  createdAt: string;
}

export type ProjectKnowledgeStatus = "empty" | "indexing" | "ready" | "stale" | "error";

export interface ProjectKnowledgeMeta {
  lastIndexedSha?: string;
  lastIndexedAt?: string;
  status: ProjectKnowledgeStatus;
  error?: string;
}

/** Read model returned to the UI: pages + freshly computed staleness. */
export interface ProjectKnowledgeView {
  projectId: string;
  knowledgeBranch: string;
  status: ProjectKnowledgeStatus;
  pendingCommits: number;   // commits in lastIndexedSha..HEAD; 0 when fresh/unknown
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
  mode?: "entry" | "worker" | "system"; // 模式:入口 agent、工作 agent 或系统 agent（可选，仅作为提示）
  systemRole?: "knowledge" | "habits" | "failure-experience"; // 系统 agent 的专项角色（仅 mode="system" 时有效）
  permissions: SubAgentPermissions; // 权限配置
  promptTemplate?: string; // 提示词模板(可选)
  metadata: SubAgentMetadata; // 元数据信息
}

/**
 * 用户偏好分类
 */
export type PreferenceCategory = "coding_style" | "naming" | "architecture" | "tooling" | "workflow" | "other";

/**
 * 偏好来源:explicit=用户明确声明,observed=系统观察,correction=用户纠正,inferred=推理
 */
export type PreferenceSource = "explicit" | "observed" | "correction" | "inferred";

/**
 * 用户偏好,记录用户的编码习惯、风格倾向和工作流偏好
 */
export interface UserPreference {
  id: string;
  category: PreferenceCategory;
  key: string; // 偏好键,如 "use-single-quotes"、"test-framework"、"prefer-fp"
  value: string; // 偏好值,如 "always"、"avoid"、"jest"
  confidence: number; // 置信度 0.0-1.0
  source: PreferenceSource;
  occurrences: number; // 被确认的次数
  examples: string[]; // 最多 5 个具体示例
  createdAt: string;
  updatedAt: string;
}

/**
 * 失败模式分类
 */
export type FailureCategory =
  | "type_error"
  | "test_failure"
  | "build_error"
  | "logic_bug"
  | "architecture"
  | "security"
  | "performance"
  | "other";

/**
 * 失败模式,记录 Quest 执行中的失败经验和缓解方案
 */
export interface FailurePattern {
  id: string;
  category: FailureCategory;
  title: string; // 简短标签
  description: string; // 发生了什么
  rootCause: string; // 根因分析
  context: string; // 当时在做什么
  mitigation: string; // 下次如何避免
  signals: string[]; // 匹配关键词,用于检测相似场景
  projectId?: string;
  questId?: string;
  severity: "low" | "medium" | "high";
  resolved: boolean;
  createdAt: string;
  resolvedAt?: string;
}

export interface EngineConfig {
  mode: "cli" | "byok";
  cliId: string;
  cliModels: Record<string, string>;
  byokProviders: Record<string, ByokConfig>;
  activeByokProviderId: string;
  modelKits: Record<string, ModelKit>; // ModelKit 集合，按 ID 索引
  embeddingModelKitId?: string;      // BYOK ModelKit used for /embeddings; unset => keyword fallback
  updatedAt: string;
}

export interface UpdateEngineInput {
  mode?: "cli" | "byok";
  cliId?: string;
  cliModels?: Record<string, string>;
  byokProviders?: Record<string, Partial<ByokConfig>>;
  activeByokProviderId?: string;
  embeddingModelKitId?: string;
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
  userPreferences: Record<string, UserPreference>; // 用户偏好集合,按 ID 索引
  failurePatterns: Record<string, FailurePattern>; // 失败模式集合,按 ID 索引
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
  entrySubAgentId?: string;
  affectedProjectIds?: string[];
  autoApprovePlan?: boolean;
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
  mode?: "entry" | "worker" | "system";
  systemRole?: "knowledge" | "habits" | "failure-experience";
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
  mode?: "entry" | "worker" | "system";
  systemRole?: "knowledge" | "habits" | "failure-experience";
  permissions?: SubAgentPermissions;
  promptTemplate?: string;
}

/**
 * 创建用户偏好的输入参数
 */
export interface CreateUserPreferenceInput {
  category: PreferenceCategory;
  key: string;
  value: string;
  confidence?: number;
  source?: PreferenceSource;
  example?: string;
}

/**
 * 创建失败模式的输入参数
 */
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

// Expert orchestration types
export type {
  ExpertSession,
  ExpertSessionStatus,
  ExpertTaskNode,
  ExpertTask,
  TaskNodeType,
  TaskStatus,
  AcceptanceTest,
  AcceptanceTestStatus,
  CodeResearchResult,
  CodeResearchResultType,
  AgentPrototype,
  DynamicAgent,
  AgentPoolEntry,
  AgentPoolSnapshot,
  TaskArtifact,
  ExpertError,
  ExpertErrorCode,
} from "./expert/types.js";
