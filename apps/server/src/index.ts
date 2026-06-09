import { serve } from "@hono/node-server";
import { RepoHelmService, SqliteStateStore, SqliteWikiStore } from "@repohelm/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { execFile, spawn } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

function resolveRootDir() {
  if (process.env.REPOHELM_ROOT) {
    return resolve(process.env.REPOHELM_ROOT);
  }
  const cwd = process.cwd();
  if (basename(cwd) === "server" && basename(dirname(cwd)) === "apps") {
    return resolve(cwd, "../..");
  }
  return cwd;
}

const rootDir = resolveRootDir();
const stateRootDir = process.env.REPOHELM_STATE_ROOT ? resolve(process.env.REPOHELM_STATE_ROOT) : rootDir;
const worktreeRootDir = process.env.REPOHELM_WORKTREE_ROOT
  ? resolve(process.env.REPOHELM_WORKTREE_ROOT)
  : stateRootDir === rootDir
    ? join(rootDir, ".repohelm", "worktrees")
    : join(stateRootDir, "worktrees");
const knowledgeRootDir = process.env.REPOHELM_KNOWLEDGE_ROOT
  ? resolve(process.env.REPOHELM_KNOWLEDGE_ROOT)
  : stateRootDir === rootDir
    ? join(rootDir, ".repohelm", "knowledge")
    : join(stateRootDir, "knowledge");
const port = Number(process.env.REPOHELM_PORT ?? 4300);
const service = new RepoHelmService(new SqliteStateStore(stateRootDir), rootDir, {
  knowledgeRootDir,
  worktreeRootDir,
  wikiStore: new SqliteWikiStore(stateRootDir)
});

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"]
  })
);

const workspaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  worktreeRoot: z.string().optional()
});

const updateWorkspaceSchema = workspaceSchema.partial();

const projectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  role: z.enum(["frontend", "backend", "documentation", "library", "infra", "unknown"]).optional(),
  defaultBranch: z.string().optional(),
  validationCommand: z.string().optional()
});

const updateProjectSchema = projectSchema.partial();

const workspaceLinkSchema = z.object({
  projectId: z.string().min(1)
});

const engineSchema = z.object({
  mode: z.enum(["cli", "byok"]).optional(),
  cliId: z.string().optional(),
  cliModels: z.record(z.string(), z.string()).optional(),
  byokProviders: z
    .record(
      z.string(),
      z.object({
        provider: z.string().optional(),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
        apiKey: z.string().optional()
      })
    )
    .optional(),
  activeByokProviderId: z.string().optional(),
  embeddingModelKitId: z.string().optional()
});

const providerModelsSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  refresh: z.boolean().optional()
});

const securityPolicySchema = z.object({
  commandApprovalMode: z.enum(["allowlist", "manual"]).optional(),
  allowedCommands: z.array(z.string()).optional(),
  fileScopes: z.array(z.string()).optional(),
  networkScopes: z.array(z.string()).optional(),
  secretsPolicy: z.enum(["redact-env", "deny"]).optional(),
  sandboxRuntime: z.enum(["local", "external"]).optional()
});

const questSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  requirement: z.string().min(1),
  agentBackendId: z.enum(["mock", "codex-cli", "claude-code", "opencode", "openai-compatible"]).optional(),
  entrySubAgentId: z.string().optional(),
  affectedProjectIds: z.array(z.string()).optional(),
  autoApprovePlan: z.boolean().optional()
});

const enhanceRequirementSchema = z.object({
  text: z.string().min(1)
});

const createModelKitSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: z.enum(["cli", "byok"]),
  backendId: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string().min(1),
  config: z.any(),
  costTier: z.enum(["free", "low", "medium", "high"]).optional(),
  performanceProfile: z.enum(["fast", "balanced", "accurate"]).optional()
});

const updateModelKitSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  config: z.any().optional(),
  costTier: z.enum(["free", "low", "medium", "high"]).optional(),
  performanceProfile: z.enum(["fast", "balanced", "accurate"]).optional()
});

const testModelSchema = z.object({
  type: z.enum(["cli", "byok"]),
  backendId: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  name: z.string().min(1),
  costTier: z.enum(["free", "low", "medium", "high"]).optional(),
  performanceProfile: z.enum(["fast", "balanced", "accurate"]).optional()
});

// Sub-agent Schema 定义
const createSubAgentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  role: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  modelKitId: z.string().min(1),
  mode: z.enum(["entry", "worker"]).optional(),
  permissions: z.object({
    allowedTools: z.array(z.string()),
    deniedTools: z.array(z.string()),
    maxSteps: z.number().optional()
  }).optional(),
  promptTemplate: z.string().optional()
});

const updateSubAgentSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  capabilities: z.array(z.string()).optional(),
  modelKitId: z.string().min(1).optional(),
  mode: z.enum(["entry", "worker"]).optional(),
  permissions: z.object({
    allowedTools: z.array(z.string()),
    deniedTools: z.array(z.string()),
    maxSteps: z.number().optional()
  }).optional(),
  promptTemplate: z.string().optional()
});

const setEntrySchema = z.object({
  id: z.string().min(1)
});

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    name: "RepoHelm API",
    rootDir,
    stateRootDir,
    worktreeRootDir,
    knowledgeRootDir
  })
);

app.get("/api/state", async (context) => {
  const state = await service.getState();
  return context.json(state);
});

app.get("/api/agent-backends", async (context) => {
  const backends = await service.listAgentBackends();
  return context.json(backends);
});

app.get("/api/clis", async (context) => {
  const clis = await service.listLocalClis(false);
  return context.json(clis);
});

app.post("/api/clis/rescan", async (context) => {
  const clis = await service.listLocalClis(true);
  return context.json(clis);
});

app.post("/api/clis/:id/test", async (context) => {
  const result = await service.testLocalCli(context.req.param("id"));
  return context.json(result);
});

app.get("/api/providers", async (context) => {
  const providers = await service.listProviders();
  return context.json(providers);
});

// POST (not GET) so the API key stays out of the URL/query string.
app.post("/api/providers/:id/models", async (context) => {
  const input = providerModelsSchema.parse(await context.req.json().catch(() => ({})));
  const result = await service.listProviderModels({
    providerId: context.req.param("id"),
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    refresh: input.refresh
  });
  return context.json(result);
});

// POST so the API key stays out of the URL/query string.
app.post("/api/providers/:id/test", async (context) => {
  const input = providerModelsSchema.parse(await context.req.json().catch(() => ({})));
  const result = await service.testProvider({
    providerId: context.req.param("id"),
    baseUrl: input.baseUrl,
    apiKey: input.apiKey
  });
  return context.json(result);
});

app.get("/api/engine", async (context) => {
  const engine = await service.getEngine();
  return context.json(engine);
});

app.patch("/api/engine", async (context) => {
  const input = engineSchema.parse(await context.req.json());
  const engine = await service.updateEngine(input);
  return context.json(engine);
});

app.get("/api/capabilities", async (context) => {
  const capabilities = await service.listCapabilities();
  return context.json(capabilities);
});

app.get("/api/security-policy", async (context) => {
  const policy = await service.getSecurityPolicy();
  return context.json(policy);
});

app.patch("/api/security-policy", async (context) => {
  const input = securityPolicySchema.parse(await context.req.json());
  const policy = await service.updateSecurityPolicy(input);
  return context.json(policy);
});

app.get("/api/audit-log", async (context) => {
  const auditLog = await service.listAuditLog();
  return context.json(auditLog);
});

app.get("/api/product-readiness", async (context) => {
  const readiness = await service.getProductReadiness(context.req.query("workspaceId"));
  return context.json(readiness);
});

app.get("/api/workspaces/:id/knowledge", async (context) => {
  const knowledge = await service.searchKnowledge(context.req.param("id"), context.req.query("q") ?? "");
  return context.json(knowledge);
});

const knowledgeErrorStatus = (error: unknown): 404 | 400 =>
  error instanceof Error && error.message === "Project not found" ? 404 : 400;

app.get("/api/projects/:id/knowledge", async (context) => {
  try {
    const view = await service.getProjectKnowledge(context.req.param("id"));
    return context.json(view);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, knowledgeErrorStatus(error));
  }
});

app.post("/api/projects/:id/knowledge/sync", async (context) => {
  try {
    const view = await service.syncProjectKnowledge(context.req.param("id"));
    return context.json(view);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, knowledgeErrorStatus(error));
  }
});

const knowledgeBranchSchema = z.object({ knowledgeBranch: z.string().min(1) });

app.patch("/api/projects/:id/knowledge", async (context) => {
  try {
    const input = knowledgeBranchSchema.parse(await context.req.json());
    const project = await service.setProjectKnowledgeBranch(context.req.param("id"), input.knowledgeBranch);
    return context.json(project);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, knowledgeErrorStatus(error));
  }
});

app.get("/api/worktrees", async (context) => {
  const worktrees = await service.listWorktrees(context.req.query("workspaceId"));
  return context.json(worktrees);
});

app.post("/api/workspaces", async (context) => {
  const input = workspaceSchema.parse(await context.req.json());
  const workspace = await service.createWorkspace(input);
  return context.json(workspace, 201);
});

app.patch("/api/workspaces/:id", async (context) => {
  const input = updateWorkspaceSchema.parse(await context.req.json());
  const workspace = await service.updateWorkspace(context.req.param("id"), input);
  return context.json(workspace);
});

app.post("/api/projects", async (context) => {
  const input = projectSchema.parse(await context.req.json());
  const project = await service.createProject(input);
  return context.json(project, 201);
});

app.post("/api/workspaces/:id/links", async (context) => {
  const input = workspaceLinkSchema.parse(await context.req.json());
  const workspace = await service.linkProjectToWorkspace(context.req.param("id"), input.projectId);
  return context.json(workspace, 201);
});

app.delete("/api/workspaces/:id/links/:projectId", async (context) => {
  const workspace = await service.unlinkProjectFromWorkspace(
    context.req.param("id"),
    context.req.param("projectId")
  );
  return context.json(workspace);
});

app.patch("/api/projects/:id", async (context) => {
  const input = updateProjectSchema.parse(await context.req.json());
  const project = await service.updateProject(context.req.param("id"), input);
  return context.json(project);
});

app.delete("/api/projects/:id", async (context) => {
  const state = await service.removeProject(context.req.param("id"));
  return context.json(state);
});

app.post("/api/projects/:id/check", async (context) => {
  const project = await service.checkProjectHealth(context.req.param("id"));
  return context.json(project);
});

app.post("/api/pick-directory", async (context) => {
  if (process.platform !== "darwin") {
    return context.json({ path: null, error: "目录选择器目前仅支持 macOS。" });
  }
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      "try",
      "-e",
      'POSIX path of (choose folder with prompt "选择仓库目录")',
      "-e",
      "end try"
    ]);
    const path = stdout.trim();
    return context.json({ path: path ? path.replace(/\/+$/, "") : null });
  } catch {
    return context.json({ path: null });
  }
});

app.get("/api/branches", async (context) => {
  const path = context.req.query("path");
  if (!path) {
    return context.json({ branches: [], defaultBranch: "main" });
  }
  try {
    const result = await service.listBranches(path);
    return context.json(result);
  } catch {
    return context.json({ branches: [], defaultBranch: "main" });
  }
});

app.post("/api/projects/:id/open-directory", async (context) => {
  const state = await service.getState();
  const project = state.projects.find((item) => item.id === context.req.param("id"));
  if (!project) {
    return context.json({ error: "Project not found" }, 404);
  }
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(opener, [project.path], { detached: true, stdio: "ignore" }).unref();
  return context.json({ ok: true });
});

app.post("/api/workspaces/:id/worktrees/:projectId/open-directory", async (context) => {
  const state = await service.getState();
  const workspace = state.workspaces.find((item) => item.id === context.req.param("id"));
  if (!workspace) {
    return context.json({ error: "Workspace not found" }, 404);
  }
  const worktree = workspace.worktrees.find((item) => item.projectId === context.req.param("projectId"));
  if (!worktree) {
    return context.json({ error: "Worktree not found" }, 404);
  }
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(opener, [worktree.worktreePath], { detached: true, stdio: "ignore" }).unref();
  return context.json({ ok: true });
});

app.post("/api/quests", async (context) => {
  const input = questSchema.parse(await context.req.json());
  const quest = await service.createQuest(input);
  return context.json(quest, 201);
});

app.post("/api/quests/:id/run", async (context) => {
  const quest = await service.runQuest(context.req.param("id"));
  return context.json(quest);
});

app.post("/api/assist/enhance-requirement", async (context) => {
  try {
    const body = enhanceRequirementSchema.parse(await context.req.json());
    const requirement = await service.enhanceRequirement(body.text);
    return context.json({ requirement });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post("/api/quests/:id/retry", async (context) => {
  const quest = await service.retryQuest(context.req.param("id"));
  return context.json(quest);
});

app.post("/api/quests/:id/cleanup", async (context) => {
  const quest = await service.cleanupQuestWorktrees(context.req.param("id"));
  return context.json(quest);
});

app.post("/api/quests/:id/deliver", async (context) => {
  const quest = await service.deliverQuest(context.req.param("id"));
  return context.json(quest);
});

app.post("/api/quests/:id/capabilities/:capabilityId/accept", async (context) => {
  const quest = await service.acceptCapabilityRecommendation(context.req.param("id"), context.req.param("capabilityId"));
  return context.json(quest);
});

app.post("/api/quests/:id/capabilities/:capabilityId/dismiss", async (context) => {
  const quest = await service.dismissCapabilityRecommendation(context.req.param("id"), context.req.param("capabilityId"));
  return context.json(quest);
});

app.post("/api/quests/:id/approve-plan", async (context) => {
  try {
    const quest = await service.approvePlan(context.req.param("id"));
    return context.json(quest);
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

const rejectPlanSchema = z.object({ reason: z.string().optional() });

app.post("/api/quests/:id/reject-plan", async (context) => {
  try {
    const input = rejectPlanSchema.parse(await context.req.json().catch(() => ({})));
    const quest = await service.rejectPlan(context.req.param("id"), input.reason);
    return context.json(quest);
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

app.get("/api/quests/:id/plan", async (context) => {
  const plan = await service.getQuestPlan(context.req.param("id"));
  if (!plan) {
    return context.json({ error: "No plan found" }, 404);
  }
  return context.json(plan);
});

// POST /api/model-kits - 创建 ModelKit
app.post("/api/model-kits", async (context) => {
  const input = createModelKitSchema.parse(await context.req.json());
  try {
    const modelKit = await service.createModelKit(input);
    return context.json(modelKit, 201);
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

// PATCH /api/model-kits/:id - 更新 ModelKit
app.patch("/api/model-kits/:id", async (context) => {
  const input = updateModelKitSchema.parse(await context.req.json());
  try {
    const modelKit = await service.updateModelKit(context.req.param("id"), input);
    return context.json(modelKit);
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

// DELETE /api/model-kits/:id - 删除 ModelKit
app.delete("/api/model-kits/:id", async (context) => {
  try {
    await service.deleteModelKit(context.req.param("id"));
    return context.json({ ok: true });
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

// GET /api/model-kits - 列出所有 ModelKits
app.get("/api/model-kits", async (context) => {
  const modelKits = await service.listModelKits();
  return context.json(modelKits);
});

// POST /api/model-kits/test-and-save - 测试并保存 ModelKit
app.post("/api/model-kits/test-and-save", async (context) => {
  const input = testModelSchema.parse(await context.req.json());
  try {
    const modelKit = await service.testAndSaveModelKit(input);
    return context.json(modelKit, 201);
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

// POST /api/sub-agents - 创建 Sub-agent
app.post("/api/sub-agents", async (context) => {
  const input = createSubAgentSchema.parse(await context.req.json());
  try {
    const subAgent = await service.createSubAgent(input);
    return context.json(subAgent, 201);
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

// PATCH /api/sub-agents/:id - 更新 Sub-agent
app.patch("/api/sub-agents/:id", async (context) => {
  const input = updateSubAgentSchema.parse(await context.req.json());
  try {
    const subAgent = await service.updateSubAgent(context.req.param("id"), input);
    return context.json(subAgent);
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

// DELETE /api/sub-agents/:id - 删除 Sub-agent
app.delete("/api/sub-agents/:id", async (context) => {
  try {
    await service.deleteSubAgent(context.req.param("id"));
    return context.json({ ok: true });
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

// GET /api/sub-agents - 列出所有 Sub-agents
app.get("/api/sub-agents", async (context) => {
  const modeFilter = context.req.query("mode");
  const subAgents = await service.listSubAgents();
  if (modeFilter === "entry" || modeFilter === "worker") {
    return context.json(subAgents.filter((agent) => agent.mode === modeFilter));
  }
  return context.json(subAgents);
});

// POST /api/sub-agents/set-entry - 设置入口 Sub-agent
app.post("/api/sub-agents/set-entry", async (context) => {
  const input = setEntrySchema.parse(await context.req.json());
  try {
    await service.setEntrySubAgent(input.id);
    return context.json({ ok: true });
  } catch (error) {
    return context.json({ error: String(error) }, 400);
  }
});

// GET /api/sub-agents/entry - 获取入口 Sub-agent
app.get("/api/sub-agents/entry", async (context) => {
  const entrySubAgent = await service.getEntrySubAgent();
  return context.json(entrySubAgent ?? null);
});

app.onError((error, context) => {
  console.error(error);
  return context.json(
    {
      error: error instanceof Error ? error.message : "Unknown error"
    },
    500
  );
});

service
  .getState()
  .then(() => service.ensureBuiltInSubAgents())
  .catch((error) => {
    console.warn("[startup] ensureBuiltInSubAgents skipped:", error instanceof Error ? error.message : String(error));
  });

const SERVE_RETRIES = 5;
const SERVE_RETRY_DELAY_MS = 500;

async function startServer() {
  let lastError;
  for (let attempt = 1; attempt <= SERVE_RETRIES; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = serve({ fetch: app.fetch, port }, (info) => {
          console.log(`RepoHelm API listening on http://localhost:${info.port}`);
          resolve();
        });
        server.once("error", reject);
      });
      return;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt === SERVE_RETRIES) {
        throw error;
      }
      console.warn(
        `[startup] port ${port} still busy (attempt ${attempt}/${SERVE_RETRIES}), retrying in ${SERVE_RETRY_DELAY_MS}ms`,
      );
      await new Promise((r) => setTimeout(r, SERVE_RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

startServer().catch((error) => {
  console.error("[startup] failed to start server:", error);
  process.exit(1);
});
