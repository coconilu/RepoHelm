export interface RepoHelmState {
  workspaces: Array<{ id: string; name: string; projectIds: string[]; worktrees: Array<{ projectId: string; worktreePath: string; status: string }> }>;
  projects: Array<{ id: string; name: string; path: string; defaultBranch: string; health: { status: string } }>;
  quests: Array<{
    id: string;
    workspaceId: string;
    title: string;
    status: string;
    planPath?: string;
    worktrees: Array<{ projectId: string; worktreePath: string; status: string }>;
    changedFiles: Array<{ projectId: string; path: string; status: string; diff: string; worktreePath: string } | string>;
  }>;
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
 * deterministic CLI planning backend, but the worker uses a BYOK ModelKit whose
 * baseUrl points at the local fake LLM server — so step execution goes through
 * the REAL tool-calling loop (runWorkerWithFsTools) and exercises the built-in
 * tools (issue #22 A–E).
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
    role: "Entry supervisor used by the toolset flow to produce a single-step execution plan.",
    capabilities: ["planning"],
    modelKitId: entryKit.id,
    mode: "entry",
    permissions: { allowedTools: ["delegate"], deniedTools: [] }
  });
  const worker = await postJson<{ id: string }>("/api/sub-agents", {
    name: "QA Coder",
    role: "Worker agent that exercises the built-in tool set via the BYOK tool-calling loop.",
    capabilities: ["coding", "planning"],
    modelKitId: workerKit.id,
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] }
  });
  await postJson("/api/sub-agents/set-entry", { id: entry.id });
  return { entryKitId: entryKit.id, workerKitId: workerKit.id, entryAgentId: entry.id, workerAgentId: worker.id };
}

export async function getState(): Promise<RepoHelmState> {
  const response = await fetch(`${apiBase}/api/state`);
  if (!response.ok) {
    throw new Error(`/api/state failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<RepoHelmState>;
}
