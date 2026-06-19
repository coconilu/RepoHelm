export interface ProjectKnowledgeView {
  projectId: string;
  knowledgeBranch: string;
  status: "empty" | "indexing" | "ready" | "stale" | "error";
  pendingCommits: number;
  lastIndexedSha?: string;
  lastIndexedAt?: string;
  head?: string;
  error?: string;
  pages: Array<{ id: string; projectId: string; slug: string; title: string; body: string; sourcePath: string; updatedAtSha: string; updatedAt: string }>;
}

export interface RepoHelmState {
  workspaces: Array<{ id: string; name: string; projectIds: string[]; worktrees: Array<{ projectId: string; worktreePath: string; status: string }> }>;
  projects: Array<{
    id: string;
    name: string;
    path: string;
    defaultBranch: string;
    health: { status: string };
    knowledge?: { status: string; lastIndexedSha?: string; lastIndexedAt?: string; error?: string };
  }>;
  quests: Array<{
    id: string;
    workspaceId: string;
    title: string;
    status: string;
    planPath?: string;
    agentSummary?: string;
    affectedProjectIds: string[];
    worktrees: Array<{ projectId: string; worktreePath: string; status: string }>;
    changedFiles: Array<{ projectId: string; path: string; status: string; diff: string; worktreePath: string } | string>;
  }>;
  events: Array<{ id: string; questId: string; type: string; title: string; detail: string; agent: string; createdAt: string }>;
}

const apiBase = "http://127.0.0.1:4300";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export async function seedQaAgents() {
  const kit = await postJson<{ id: string }>("/api/model-kits", {
    name: "qa-agent-cli-fixture",
    type: "cli",
    backendId: "codex-cli",
    model: "default",
    config: { backendId: "codex-cli" }
  });
  const entry = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Supervisor",
    role: "Entry supervisor used by the QA golden flow to produce a simple execution plan.",
    capabilities: ["planning"],
    modelKitId: kit.id,
    mode: "entry",
    permissions: { allowedTools: ["delegate"], deniedTools: [] }
  });
  await postJson("/api/sub-agents", {
    name: "QA Coder",
    role: "Worker agent used by the QA golden flow to edit the fixture repository.",
    capabilities: ["coding", "planning"],
    modelKitId: kit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  await postJson("/api/sub-agents/set-entry", { id: entry.id });
  return { modelKitId: kit.id, entryAgentId: entry.id };
}

/**
 * Seed agents for the toolset-flow scenario: the entry/supervisor keeps the
 * deterministic CLI planning backend, but TWO distinct worker agents use BYOK
 * ModelKits whose baseUrl points at the local fake LLM server — so step execution
 * goes through the REAL tool-calling loop (runWorkerWithFsTools) and exercises the
 * built-in tools (issue #22 A–E). The plan assigns step_1 to the researcher and
 * step_2 (dependent) to the implementer, demonstrating plan-based orchestration
 * across two repos and two agents.
 */
export async function seedQaToolsetAgents(byokBaseUrl: string) {
  const entryKit = await postJson<{ id: string }>("/api/model-kits", {
    name: "qa-toolset-entry-cli",
    type: "cli",
    backendId: "codex-cli",
    model: "default",
    config: { backendId: "codex-cli" }
  });
  const workerKit = await postJson<{ id: string }>("/api/model-kits", {
    name: "qa-toolset-worker-byok",
    type: "byok",
    providerId: "qa-fake",
    model: "qa-fake-model",
    config: { provider: "qa-fake", baseUrl: byokBaseUrl, model: "qa-fake-model", apiKey: "qa-fake-key" }
  });
  const entry = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Supervisor",
    role: "Entry supervisor used by the toolset flow to produce a two-step, dependency-ordered execution plan.",
    capabilities: ["planning"],
    modelKitId: entryKit.id,
    mode: "entry",
    permissions: { allowedTools: ["delegate"], deniedTools: [] }
  });
  const researcher = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Researcher",
    role: "Worker agent that researches the API contract via search_files, read_file and web_fetch.",
    capabilities: ["research", "coding"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  const implementer = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Implementer",
    role: "Worker agent that implements the storefront summary via write_todos, start_process and search_files.",
    capabilities: ["coding"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  await postJson("/api/sub-agents/set-entry", { id: entry.id });
  return {
    entryKitId: entryKit.id,
    workerKitId: workerKit.id,
    entryAgentId: entry.id,
    researcherAgentId: researcher.id,
    implementerAgentId: implementer.id
  };
}

/**
 * Seed agents for the delegation-flow scenario: unlike the toolset flow (which
 * keeps a deterministic CLI entry + a static plan), here the **entry/supervisor
 * is itself a BYOK agent** pointing at the fake LLM server. That makes
 * selectExecutionMode pick the adaptive `delegate` path: the supervisor runs in a
 * tool-calling loop and decides AT RUNTIME which worker handles each subtask via
 * the `delegate` tool. Two distinct BYOK workers (researcher, implementer) also
 * point at the fake server so their real tool-calling loops write files.
 */
export async function seedQaDelegationAgents(byokBaseUrl: string) {
  const byokKit = async (name: string) =>
    postJson<{ id: string }>("/api/model-kits", {
      name,
      type: "byok",
      providerId: "qa-fake",
      model: "qa-fake-model",
      config: { provider: "qa-fake", baseUrl: byokBaseUrl, model: "qa-fake-model", apiKey: "qa-fake-key" }
    });

  const entryKit = await byokKit("qa-delegation-entry-byok");
  const workerKit = await byokKit("qa-delegation-worker-byok");

  const entry = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Supervisor",
    role: "Entry supervisor that delegates subtasks to workers at runtime via the delegate tool.",
    capabilities: ["planning"],
    modelKitId: entryKit.id,
    mode: "entry",
    permissions: { allowedTools: ["delegate"], deniedTools: [] }
  });
  const researcher = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Researcher",
    role: "Worker agent that researches the contract in the api repo and writes src/findings.md.",
    capabilities: ["research", "coding"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  const implementer = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Implementer",
    role: "Worker agent that implements and verifies the storefront summary in the web repo.",
    capabilities: ["coding"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  await postJson("/api/sub-agents/set-entry", { id: entry.id });
  return {
    entryKitId: entryKit.id,
    workerKitId: workerKit.id,
    entryAgentId: entry.id,
    researcherAgentId: researcher.id,
    implementerAgentId: implementer.id
  };
}

/**
 * Seed agents for the recovery-knowledge scenario. The entry agent and all
 * workers are BYOK agents pointed at a local fake OpenAI-compatible server so
 * the real delegate loop and worker tool-calling loop run end to end.
 */
export async function seedQaRecoveryKnowledgeAgents(byokBaseUrl: string) {
  const byokKit = async (name: string) =>
    postJson<{ id: string }>("/api/model-kits", {
      name,
      type: "byok",
      providerId: "qa-fake",
      model: "qa-fake-model",
      config: { provider: "qa-fake", baseUrl: byokBaseUrl, model: "qa-fake-model", apiKey: "qa-fake-key" }
    });

  const entryKit = await byokKit("qa-recovery-knowledge-entry-byok");
  const workerKit = await byokKit("qa-recovery-knowledge-worker-byok");

  const entry = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Supervisor",
    role: "Entry supervisor that delegates a recovery-oriented multi-repo QA quest.",
    capabilities: ["planning", "recovery"],
    modelKitId: entryKit.id,
    mode: "entry",
    permissions: { allowedTools: ["delegate"], deniedTools: [] }
  });
  const researcher = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Researcher",
    role: "Worker agent that inspects source and stale knowledge context before implementation.",
    capabilities: ["research", "analysis"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  const implementer = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Implementer",
    role: "Worker agent that updates API and web code and performs targeted repairs.",
    capabilities: ["coding", "repair"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  const verifier = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Verifier",
    role: "Worker agent that runs repo-local validation and preserves failed validation output.",
    capabilities: ["testing", "verification"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  const curator = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Knowledge Curator",
    role: "Worker agent that updates operator-facing release notes and prepares knowledge sync evidence.",
    capabilities: ["documentation", "knowledge"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  await postJson("/api/sub-agents/set-entry", { id: entry.id });
  return {
    entryKitId: entryKit.id,
    workerKitId: workerKit.id,
    entryAgentId: entry.id,
    researcherAgentId: researcher.id,
    implementerAgentId: implementer.id,
    verifierAgentId: verifier.id,
    curatorAgentId: curator.id
  };
}

export async function getState(): Promise<RepoHelmState> {
  const response = await fetch(`${apiBase}/api/state`);
  if (!response.ok) {
    throw new Error(`/api/state failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<RepoHelmState>;
}

export async function getProjectKnowledge(projectId: string): Promise<ProjectKnowledgeView> {
  const response = await fetch(`${apiBase}/api/projects/${projectId}/knowledge`);
  if (!response.ok) {
    throw new Error(`/api/projects/${projectId}/knowledge failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<ProjectKnowledgeView>;
}
