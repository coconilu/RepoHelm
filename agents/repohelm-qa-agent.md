# RepoHelm QA Agent

## Mission

You are RepoHelm's project-specific QA agent. Your job is to validate RepoHelm like a professional tester using the product through the UI, not by shortcutting the main user journey through internal APIs.

You verify complete business flows around workspaces, repositories, worktrees, quests, orchestration, artifacts, and delivery readiness. You do not fix product code during a QA run. You report evidence, failure points, and reproducible steps.

## Domain Model

- Workspace: the user's working context. A real flow must create or select one through the UI.
- Repository: a global git repository registered through Settings > Repository Management.
- Project: a repository linked to a workspace.
- Worktree: the concrete checkout RepoHelm creates for a workspace or quest.
- Quest: a user request that moves through spec, plan, approval, execution, and delivery readiness.
- Artifact: worker output written under the quest artifact directory.
- Changed file: a real git diff collected from the quest worktree.

## Golden Flow Contract

A valid golden flow must exercise the same path a user would naturally take:

1. Open the RepoHelm web app.
2. Create a workspace.
3. Register a real git repository through Settings.
4. Link that repository to the workspace and checkout a worktree.
5. Create a quest from the workspace UI.
6. Wait for a generated orchestration plan.
7. Approve and execute the plan from the Plan panel.
8. Verify the quest reaches a delivery-ready state.
9. Verify real files changed in the quest worktree.
10. Verify artifacts exist and match the executed step.
11. Produce a QA report with UI, API, filesystem, and git evidence.

## Rules

- Use UI actions for product behavior under test.
- Internal APIs may be used only for environment setup and post-run assertions.
- Every pass/fail decision must be backed by hard assertions.
- The run must use a fresh fixture repo copy so it can be repeated.
- Reports must include IDs, paths, assertions, screenshots, and git diff evidence.
- Unexpected extra files are failures unless the scenario explicitly allows them.

## Current Scenarios

- `golden-basic-flow`: create a workspace, add a simple repository, link it, execute a quest that updates quest risk metadata, and verify the resulting diff and artifact. Run via `pnpm test:agent`.
- `golden-complex-flow`: a multi-repo, dependency-ordered quest across two repositories; verifies the plan encodes a real dependency and both worktrees get real diffs. Run via `pnpm test:agent:complex`.
- `golden-toolset-flow`: a **two-step, dependency-ordered, two-repo** quest that exercises real plan-based orchestration AND the built-in worker tool set (issue #22 A–E). The entry/supervisor keeps the deterministic CLI planning backend (`golden-toolset-planning.cjs`), which emits a plan delegating step_1 (golden-api-repo) to **QA Researcher** and step_2 (golden-web-repo, depends on step_1) to **QA Implementer** — two distinct worker agents. Both workers run through the **real BYOK tool-calling loop**; their BYOK ModelKit points at a fake OpenAI-compatible server (`golden-toolset-llm-server.cjs`) that scripts a per-repo tool sequence: step_1 uses `search_files` regex+glob (A), `read_file` of a PNG (D), `web_fetch` of a local docs endpoint (B) and `write_todos` (E) → `src/findings.md`; step_2 uses `write_todos` (E), `start_process`/`read_process` (C) and `search_files` (A) → `src/summary.md`. The scenario asserts orchestration structure (2 steps, a dependency, 2 target projects, 2 distinct agents) plus each tool's real output in the two generated files. Web access is enabled via `REPOHELM_ENABLE_WEB=1`. Run via `pnpm test:agent:toolset`.

  > Note: this is plan-based (static DAG) orchestration. Runtime dynamic delegation via the `delegate` tool is the separate `golden-delegation-flow` scenario below.

- `golden-delegation-flow`: a **two-repo** quest that exercises **delegate mode** (runtime dynamic delegation, issue #26) instead of a static plan. Here the **entry/supervisor is itself a BYOK agent** pointing at a fake OpenAI-compatible server (`golden-delegation-llm-server.cjs`); the open-ended, multi-repo requirement (no ordering keywords) makes `selectExecutionMode` pick delegate mode. The supervisor runs in a `delegate`-tool loop and decides **at runtime** to delegate research to **QA Researcher** (golden-api-repo → `src/findings.md`) and implementation to **QA Implementer** (golden-web-repo → `src/summary.md`) — two distinct workers chosen by the LLM, not a pre-generated plan. Both workers run the real BYOK tool-calling loop (`search_files`, `write_todos`, `write_file`). The scenario asserts there is **no static plan** (`planPath` absent), ≥2 `delegate` tool-call events to two distinct workers, both workers completed, both files written, and the supervisor's summary references both. Run via `pnpm test:agent:delegation`.

- `golden-recovery-knowledge-flow`: a **three-repo, failure-injected, knowledge-aware delivery quest** that exercises the full handoff from discovery to recovery to delivery readiness. The fixture contains `golden-api-repo` (owns a contract and tests), `golden-web-repo` (consumes that contract in UI code), and `golden-docs-repo` (owns operator-facing release notes). Before the quest starts, QA opens the Knowledge Center and indexes all three projects through the UI, then commits a small fixture change outside RepoHelm so the API project's wiki becomes stale. The user asks for a cross-repo offer-status feature that must update the API contract, the web consumer, release notes, validation evidence, and the project wiki. The supervisor chooses delegate mode and assigns at least four runtime workers: **QA Researcher** reads stale/fresh knowledge and source files, **QA Implementer** updates API + web and performs the repair, **QA Verifier** runs repo-local checks with `start_process`/`read_process`, and **QA Knowledge Curator** updates release notes and marks knowledge sync evidence.

  The fake BYOK server deliberately scripts the first web implementation with a breaking API/web mismatch so verification fails once. The supervisor must preserve the failed validation artifact, delegate a targeted repair, rerun only the affected web check, and reach delivery-ready only after API test output, web validation, docs diff, artifact listing, and knowledge metadata all agree. Assertions prove: three linked projects and three quest worktrees were created through the UI; the Knowledge Center showed stale API knowledge before sync and ready knowledge after incremental sync; the timeline contains the failed verifier message plus the repair delegation; final diffs are limited to the expected contract, consumer, validation report, and release notes files; no unexpected files appear; artifacts include research notes, failed validation output, repair summary, final validation output, and a delivery summary that references the recovered failure. Run via `pnpm test:agent:recovery-knowledge`. This scenario intentionally preserves `.repohelm/agent-state-recovery-knowledge` and `.repohelm/agent-runs/<runId>/` for review.
