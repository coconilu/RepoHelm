# golden-toolset-repo

QA fixture repository for the `golden-toolset-flow` scenario. It exercises the
worker's built-in tool set (issue #22 A–E) through a real BYOK tool-calling loop:

- `search_files` (regex + glob) locates the offer contract in `src/catalog.js`.
- `read_file` returns `assets/logo.png` as base64 + mediaType (vision input).
- `web_fetch` reads the contract version from a local docs endpoint.
- `write_todos` tracks the worker's plan.
- `start_process` / `read_process` run a verification command in the worktree.

The worker writes `src/generated-summary.md` capturing real values from each tool.

## Contract surface

| API | Consumer |
| --- | --- |
| `findOffer(code)` | `src/generated-summary.md` |
