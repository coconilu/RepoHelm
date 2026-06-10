// packages/core/src/expert/types.ts

// === Expert Session ===
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

export type ExpertSessionStatus =
  | "analyzing"
  | "awaiting_confirmation"
  | "confirmed"
  | "executing"
  | "completed"
  | "failed";

// === Task Tree ===
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

export type TaskNodeType =
  | "root"
  | "analysis"
  | "research"
  | "implementation"
  | "test"
  | "review"
  | "delivery";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

// === Flat Task (for UI) ===
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

// === Acceptance Test ===
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

export type AcceptanceTestStatus =
  | "draft"
  | "confirmed"
  | "generated"
  | "passing"
  | "failing";

// === Code Research ===
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

// === Agent Pool ===
export interface AgentPrototype {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  systemPromptTemplate: string;
  defaultModelKitId?: string;
  isBuiltIn: boolean;
}

export interface DynamicAgent extends AgentPrototype {
  createdBy: string;
  createdAt: string;
  taskId?: string;
  ttl?: number;
}

export type AgentPoolEntry = AgentPrototype | DynamicAgent;

export interface AgentPoolSnapshot {
  prototypes: AgentPrototype[];
  dynamicAgents: DynamicAgent[];
  activeAgents: string[];
}

// === Artifacts ===
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

// === Errors ===
export interface ExpertError {
  code: ExpertErrorCode;
  message: string;
  detail: string;
  recoverable: boolean;
  affectedTaskIds: string[];
  createdAt: string;
}

export type ExpertErrorCode =
  | "ANALYSIS_FAILED"
  | "AGENT_UNAVAILABLE"
  | "TASK_EXECUTION_FAILED"
  | "TDD_ITERATION_EXCEEDED"
  | "WORKTREE_CREATION_FAILED"
  | "TEST_GENERATION_FAILED"
  | "TEST_RUN_FAILED"
  | "DYNAMIC_AGENT_LIMIT"
  | "SESSION_TIMEOUT"
  | "KNOWLEDGE_SEARCH_FAILED"
  | "OTHER";

// === Type Aliases ===
export type CodeResearchResultType = CodeResearchResult["type"];
