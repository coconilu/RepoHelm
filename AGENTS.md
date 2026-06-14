# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

> **Companion to `CLAUDE.md`.** This file is the concise quickstart (structure, build, commands, gotchas). `CLAUDE.md` holds the comprehensive architecture detail (the `RepoHelmService` spine, orchestrator, engine config, REST/web layers, sub-agent model selection). Keep the two in sync: when you change commands, monorepo structure, or the knowledge/engine model, update **both** files. For full product direction see `docs/architecture.md`; for milestone status see `MILESTONES.md`.

## Monorepo Structure

pnpm workspace (`pnpm@10.33.4`) with three packages:
- `@repohelm/core` → `packages/core` — domain logic, store, agents, git, knowledge
- `@repohelm/server` → `apps/server` — Hono API server (port 4300)
- `@repohelm/web` → `apps/web` — React 19 + Vite 7 + Tailwind 4 UI (port 5173)

## Build Order

`@repohelm/core` **must be built first** — server and web depend on its compiled `dist/` output. The root `build`, `typecheck`, and `dev` scripts handle this automatically. If running commands per-package, always build core first:

```bash
pnpm --filter @repohelm/core build
```

## Commands

- `pnpm dev` — runs predev port killer, then starts server + web concurrently
- `pnpm typecheck` — builds core, then typechecks server and web
- `pnpm test` — vitest in `@repohelm/core` only
- `pnpm test:e2e` — Playwright; auto-starts dev server, uses `.repohelm/e2e` as isolated state dir
- `pnpm test:all` — typecheck + unit + e2e

## E2E Gotchas

Playwright config clears all proxy env vars (`NO_PROXY`, `HTTP_PROXY`, etc.) to bypass corporate proxies. The webServer command wipes `.repohelm/e2e` before each run. Do **not** reuse dev state for e2e.

## Tech Stack

- TypeScript: ES2022 target, ESNext modules, Bundler resolution, strict mode
- Server: Hono + Zod + tsx (dev) / tsc (build)
- Web: React 19, Tailwind CSS 4, Radix UI, Motion, cmdk, lucide-react
- State: SQLite (`.repohelm/state.sqlite`) with auto-migration from legacy JSON
- Knowledge: repo-bound Repo Wiki. Each Project owns 6 Markdown wiki pages under `.repohelm/knowledge/<projectId>/` (overview/architecture/modules/key-flows/conventions/decisions; Markdown = source of truth) plus chunk embeddings in `wiki_pages`/`wiki_embeddings` tables (same sqlite file, WAL). Opening the knowledge panel lazily compares the tracked branch HEAD to `lastIndexedSha`; new commits offer an incremental update. Indexing needs a BYOK chat ModelKit; vector retrieval needs `engine.embeddingModelKitId` (else keyword fallback). `REPOHELM_FAKE_MODELS=1` (+ `REPOHELM_FAKE_CHAT_JSON`) returns canned model output for e2e.

## Architecture (high level)

`packages/core/src/service.ts` — `RepoHelmService` is the central facade; nearly every domain operation is a method here, and the server constructs one instance. It composes specialized collaborators in `packages/core/src`: `store.ts` (SQLite whole-state persistence), `git.ts` (real worktree lifecycle), `agent.ts` (backend registry), `cli.ts` (local CLI detection), `providers.ts` (BYOK provider/model fetching), `llm.ts` (OpenAI-compatible client driven by a ModelKit), `orchestrator.ts` (deterministic state machine + lead-agent dynamic decisions over an approved plan), `planning.ts` (plan + task contracts), `repo-wiki.ts`/`wiki-store.ts`/`vector.ts` (repo-bound knowledge base). The server (`apps/server`) is a thin Zod-validated REST layer; the web app (`apps/web`) is a typed fetch client + component tree. **Engine config** selects `mode: "cli"` (local CLI) vs BYOK providers; ModelKits bundle provider/model/apiKey.

See `CLAUDE.md` for the full breakdown and the sub-agent model-selection guidance.

## Docs Maintenance (anti-drift)

When a change alters commands, monorepo structure, the engine/model config, the knowledge model, or the agent execution flow, update the docs in the **same** PR:

- Commands / structure / tech stack → both `AGENTS.md` and `CLAUDE.md`.
- New or changed product capability → `MILESTONES.md` (and `README.md` if it affects the capability list).
- Architecture direction or boundaries → `docs/architecture.md`.
- Keep `docs/README.md` (the docs index) current when adding/moving/removing a doc.

## Commit Style

Imperative, concise, no scope prefix: `Add feature X`, `Fix bug Y`, `Update Z`.

## Quality Gate: Dual-Agent Pipeline

When finishing a non-trivial feature or fix (anything touching `service.ts`, `App.tsx`, orchestrator, store, or adding a new REST route), dispatch **both** of these subagents in parallel before claiming the work is done:

1. **`repohelm-test-agent`** (TDD): writes failing tests first, then verifies they pass after implementation.
2. **`code-reviewer`**: read-only review of the changed paths — correctness, type drift at REST boundary, state mutation safety, Tailwind v4 token usage.

Run them in the same message so they execute concurrently. Synthesize both outputs before reporting back. If `code-reviewer` returns `VERDICT: BLOCK`, do not commit — address blockers first.

For trivial changes (typo fixes, docs-only, single-line config tweaks), the dual pipeline is overkill — skip it.
