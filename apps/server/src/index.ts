import { serve } from "@hono/node-server";
import { RepoHelmService, SqliteStateStore } from "@repohelm/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";

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
const service = new RepoHelmService(new SqliteStateStore(stateRootDir), rootDir, { knowledgeRootDir, worktreeRootDir });

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
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  role: z.enum(["frontend", "backend", "documentation", "library", "infra", "unknown"]).optional(),
  defaultBranch: z.string().optional(),
  validationCommand: z.string().optional()
});

const updateProjectSchema = projectSchema.omit({ workspaceId: true }).partial();

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
  affectedProjectIds: z.array(z.string()).optional()
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

app.get("/api/workspaces/:id/knowledge", async (context) => {
  const knowledge = await service.searchKnowledge(context.req.param("id"), context.req.query("q") ?? "");
  return context.json(knowledge);
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

app.post("/api/quests", async (context) => {
  const input = questSchema.parse(await context.req.json());
  const quest = await service.createQuest(input);
  return context.json(quest, 201);
});

app.post("/api/quests/:id/run", async (context) => {
  const quest = await service.runQuest(context.req.param("id"));
  return context.json(quest);
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

app.onError((error, context) => {
  console.error(error);
  return context.json(
    {
      error: error instanceof Error ? error.message : "Unknown error"
    },
    500
  );
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`RepoHelm API listening on http://localhost:${info.port}`);
});
