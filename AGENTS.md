# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

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

## Commit Style

Imperative, concise, no scope prefix: `Add feature X`, `Fix bug Y`, `Update Z`.
