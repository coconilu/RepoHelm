import { serve } from "@hono/node-server";
import { JsonStateStore, RepoHelmService } from "@repohelm/core";
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
  : join(stateRootDir, "worktrees");
const port = Number(process.env.REPOHELM_PORT ?? 4300);
const service = new RepoHelmService(new JsonStateStore(stateRootDir), rootDir, { worktreeRootDir });

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"]
  })
);

const workspaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional()
});

const projectSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  role: z.enum(["frontend", "backend", "documentation", "library", "infra", "unknown"]).optional(),
  defaultBranch: z.string().optional()
});

const questSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  requirement: z.string().min(1),
  affectedProjectIds: z.array(z.string()).optional()
});

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    name: "RepoHelm API",
    rootDir,
    stateRootDir,
    worktreeRootDir
  })
);

app.get("/api/state", async (context) => {
  const state = await service.getState();
  return context.json(state);
});

app.post("/api/workspaces", async (context) => {
  const input = workspaceSchema.parse(await context.req.json());
  const workspace = await service.createWorkspace(input);
  return context.json(workspace, 201);
});

app.post("/api/projects", async (context) => {
  const input = projectSchema.parse(await context.req.json());
  const project = await service.createProject(input);
  return context.json(project, 201);
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
