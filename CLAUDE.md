# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> A companion `AGENTS.md` exists with overlapping guidance. Keep the two in sync when you change commands or structure.

## What RepoHelm is

RepoHelm is an MVP prototype of an "Agentic Quest workspace": a virtual workspace can link multiple local repos, and a **Quest** turns one request into an auditable, isolated, verifiable, deliverable multi-project task (spec → plan → git worktree → agent execution → review → commit/PR handoff). The UI and most docs are in Chinese; code identifiers are English.

## Key documentation

- `docs/architecture.md` — product direction, boundaries, non-goals (Chinese).
- `MILESTONES.md` — milestone tracking: what's Done / Partial / Planned / Later (Chinese).
- `TODO.md` — open-source project health items: CI, contributing guide, issue templates (Chinese).
- `MODEL_FETCHING.md` — design doc for live provider/model list fetching via BYOK REST + CLI mapping.

## Monorepo layout

pnpm workspace (`pnpm@10.33.4`), three packages:

- `@repohelm/core` → `packages/core` — all domain logic. **No web/server deps.**
- `@repohelm/server` → `apps/server` — Hono REST API (port 4300), thin layer over core.
- `@repohelm/web` → `apps/web` — React 19 + Vite 7 + Tailwind 4 UI (port 5173).

**`@repohelm/core` must be built first** — server and web import its compiled `dist/`. The root `dev`/`build`/`typecheck` scripts already do this; if you run per-package commands manually, run `pnpm --filter @repohelm/core build` first.

## Commands

- `pnpm dev` — kills stale dev ports, builds core, runs server + web concurrently.
- `pnpm build` — builds core → server → web in order.
- `pnpm typecheck` — builds core, then typechecks server and web.
- `pnpm test` — vitest unit tests in `@repohelm/core` only.
- `pnpm test:e2e` — Playwright; auto-starts the dev server. Single test: `pnpm test:e2e -g "pattern"` or pass a file path.
- `pnpm test:all` — typecheck + unit + e2e.

Run a single core unit test: `pnpm --filter @repohelm/core test -t "test name"` (vitest).

### E2E gotchas
- Playwright config wipes all proxy env vars (`NO_PROXY`, `HTTP_PROXY`, …) to bypass corporate proxies, and resets `.repohelm/e2e` as an isolated state dir before each run. **Never reuse local dev state for e2e.**

## Architecture (the parts that span files)

### `RepoHelmService` is the spine
`packages/core/src/service.ts` (~1800 lines) is the central facade — every domain operation (workspaces, projects, quests, worktrees, knowledge, capabilities, security policy, engine/model config, sub-agents) is a method here. The server constructs **one** instance and routes call into it. When adding a feature, the method almost always belongs on this service, not in the server.

It composes specialized collaborators, all in `packages/core/src`:
- `store.ts` — `SqliteStateStore` persists the **entire** `RepoHelmState` to `.repohelm/state.sqlite`, auto-migrating from legacy `.repohelm/state.json`. State is read-modify-write of the whole blob; the service serializes mutations through a `_mutationQueue` promise chain to avoid clobbering.
- `git.ts` — `GitWorktreeManager`: real `git worktree add` / cleanup / retry / delivery commit.
- `agent.ts` — `AgentBackendRegistry`: pluggable execution backends (built-in mock + external CLIs wired via `REPOHELM_*` env vars).
- `cli.ts` — `LocalCliRegistry`: detects locally installed coding CLIs (claude-code, codex, opencode, …), lists their models, runs a tiny real connectivity "ping".
- `providers.ts` — `ProviderRegistry`: OpenAI-compatible provider definitions + live model fetching (see `MODEL_FETCHING.md`).
- `llm.ts` — OpenAI-compatible chat/tool-call client driven by a **ModelKit** (resolves baseUrl/model/apiKey).
- `orchestrator.ts` — `SubAgentOrchestrator`: runs an entry sub-agent in a tool-calling loop (`MAX_TOOL_LOOP_ITERATIONS`), delegating to other sub-agents via the `delegate` tool (`tools/delegate.ts`).
- `planning.ts` — generates the orchestration plan that the user approves/rejects before a Quest runs.
- `knowledge.ts` / `quest-workspace.ts` — per-quest workspace scaffolding + the per-repo Markdown writer (`writeWikiPage`).
- `repo-wiki.ts` / `wiki-store.ts` / `vector.ts` — repo-bound knowledge base. Each Project owns 6 structured wiki pages (`overview/architecture/modules/key-flows/conventions/decisions`) under `.repohelm/knowledge/<projectId>/` (Markdown = source of truth) plus chunk embeddings. `RepoWikiManager` supports bootstrap (full index), incremental (diff `lastIndexedSha..HEAD` → LLM rewrites only affected pages), and search (embed query → cosine top-k, keyword fallback when no embedding ModelKit). `WikiStore` persists pages + `float[]` vectors in `wiki_pages`/`wiki_embeddings` SQLite tables (WAL). Indexing needs a BYOK chat ModelKit; vector retrieval needs `engine.embeddingModelKitId`. Service methods: `getProjectKnowledge`/`syncProjectKnowledge`/`setProjectKnowledgeBranch`/`searchProjectKnowledge`.
- `tools/` — tool implementations consumed by the orchestrator's tool-calling loop. `delegate.ts` is the sub-agent delegation tool; `fs.ts` is the filesystem tool used by mock agents inside worktrees.
- `types.ts` — single source of truth for all domain types; `index.ts` re-exports everything.

### Engine config: two execution modes
`EngineConfig` (in state) selects how agents run: `mode: "cli"` (use a detected local CLI + its model) vs BYOK providers (`byokProviders`, an active one selected). **ModelKits** bundle provider/model/apiKey for LLM calls. Sub-agents reference ModelKits. This is the integration point for model access — see `MODEL_FETCHING.md` for the provider/model fetch design.

### Server is a thin Zod-validated REST layer
`apps/server/src/index.ts` (~600 lines) defines ~50 `/api/*` routes, each validating input with Zod and delegating to the service. Root/state/worktree/knowledge dirs are resolved from `REPOHELM_ROOT` / `REPOHELM_STATE_ROOT` / `REPOHELM_WORKTREE_ROOT` / `REPOHELM_KNOWLEDGE_ROOT` (defaults under `.repohelm/`). CORS is locked to the Vite dev origin.

### Web is a typed API client + component tree
`apps/web/src/App.tsx` (~3400 lines) is the main UI shell; `apps/web/src/api.ts` (~600 lines) is the typed fetch client. Vite proxies `/api` → `http://localhost:4300`. Sub-components live in `apps/web/src/components/`: `CommandPalette.tsx`, `KnowledgeCenter.tsx`, `MarkdownView.tsx`, `MermaidDiagram.tsx`, `Select.tsx`. **UI styling is token-driven** (Tailwind v4 + CSS custom properties in `theme.css`/`styles.css`, Linear-inspired, dark by default) — change appearance via tokens, don't hardcode colors.

## Agent backend env vars
Real backends are opt-in via env before starting the server:
`REPOHELM_CODEX_COMMAND`, `REPOHELM_CLAUDE_COMMAND`, `REPOHELM_OPENCODE_COMMAND`, `REPOHELM_OPENAI_BASE_URL` / `_MODEL` / `_API_KEY`, `REPOHELM_ENABLE_GH_PR=1`. External CLIs execute **inside the Quest worktree** and read standardized input JSON from `REPOHELM_AGENT_INPUT`.

For tests/e2e: `REPOHELM_FAKE_MODELS=1` (+ `REPOHELM_FAKE_CHAT_JSON`) returns canned model output instead of hitting real LLM endpoints.

## Conventions
- TypeScript: ES2022 target, ESNext modules, Bundler resolution, strict. ESM throughout — **import local modules with the `.js` extension** (`./service.js`), matching existing code.
- Commit style: imperative, concise, no scope prefix (`Add feature X`, `Fix bug Y`).
- Tests are colocated (`*.test.ts`) and run with vitest (core/server) or Playwright (`e2e/`).

### Sub-agent model selection
When dispatching sub-agents (via `Agent` tool), choose model by task type:

| Task type | Model | Examples |
|-----------|-------|----------|
| Read/search/collect info | `sonnet` | Explore agents, grep, file reading |
| Mechanical implementation from a plan | `sonnet` | Write code/tests per spec, commit |
| Write plans, decompose tasks, judge dependencies | `opus` | writing-plans skill output |
| Architecture design, trade-off analysis | `opus` | Brainstorming design sections, approach comparison |
| Code review, spec audit, consistency check | `opus` | Finding bugs, verifying type consistency across files |

**Rule of thumb:** sonnet executes the plan; opus draws the plan and audits it. Never use sonnet for tasks that require broad codebase judgment or multi-file coordination decisions.
