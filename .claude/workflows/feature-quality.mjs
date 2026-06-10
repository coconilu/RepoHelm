export const meta = {
  name: 'feature-quality',
  description:
    'Two-pipeline quality gate for RepoHelm: after a feature or fix is implemented, run the TDD agent (test writer) and the code-reviewer agent in parallel against the change, then synthesize a go/no-go verdict. Invoke with `/feature-quality` after finishing non-trivial work.',
  phases: [
    { title: 'Scope', detail: 'Detect git diff and summarize what changed' },
    { title: 'Verify', detail: 'Parallel TDD test pass + code review' },
    { title: 'Verdict', detail: 'Synthesize final go/no-go from both reports' },
  ],
}

// --- Phase 1: Scope ---------------------------------------------------------
// Let a lightweight agent detect the change so downstream agents share a
// consistent view of "what was modified". Uses git diff against HEAD, which
// covers both staged and unstaged changes.
phase('Scope')

const scope = await agent(
  'You are scoping a change for a quality gate.\n\n' +
    '1. Run `git diff --name-only HEAD` and `git diff --stat HEAD` to detect changed files.\n' +
    '2. If nothing changed vs HEAD, also try `git diff --name-only --cached` (staged-only).\n' +
    '3. Categorize each file by package: core (packages/core/), server (apps/server/), web (apps/web/), other.\n' +
    '4. Return a concise summary (≤15 lines) with:\n' +
    '   - list of changed files grouped by package\n' +
    '   - one-line description of the likely intent of the change\n' +
    '   - a "risk tag": LOW (docs/config only) | MEDIUM (single package) | HIGH (cross-package or touches service.ts / App.tsx / store.ts / orchestrator.ts)\n\n' +
    'Do NOT make edits. Read-only.',
  { label: 'scoper', phase: 'Scope' }
)

if (!scope) {
  log('⚠ Scoper agent returned no output — aborting workflow.')
  return { verdict: 'ABORT', reason: 'scoper produced no output' }
}

log(`Scope detected:\n${scope}`)

// If everything changed is docs/config, skip the heavy pipeline.
if (/\bLOW\b/.test(scope) && !/\b(MEDIUM|HIGH)\b/.test(scope)) {
  log('Change is LOW risk (docs/config only) — skipping TDD + review pipeline.')
  return { verdict: 'APPROVE', reason: 'LOW risk change, pipeline skipped', scope }
}

// --- Phase 2: Verify (parallel) --------------------------------------------
// TDD agent and code-reviewer run concurrently against the SAME stable scope.
// The implementation is assumed complete before this workflow starts — TDD
// agent writes regression/coverage tests only, not new feature code.
phase('Verify')

const [tddResult, reviewResult] = await parallel([
  () =>
    agent(
      'You are running as the TDD agent for RepoHelm on a change whose implementation is ALREADY COMPLETE.\n\n' +
        `## Change scope\n${scope}\n\n` +
        '## Your job (tests only — do not modify feature code)\n' +
        '1. Inspect the changed files and identify what new behavior needs test coverage.\n' +
        '2. Write failing tests in the appropriate `*.test.ts` files (vitest, colocated with source for core/server).\n' +
        '3. Run the relevant test command:\n' +
        '   - core unit tests: `pnpm --filter @repohelm/core test`\n' +
        '   - server unit tests: `pnpm --filter @repohelm/server test`\n' +
        '   - e2e: `pnpm test:e2e` (only if the change touches cross-package flows)\n' +
        '4. If a test fails because of a real bug in the feature code, STOP and report it as a BLOCKER — do not fix the feature code yourself.\n' +
        '5. If a test fails because your test was wrong, fix the test and retry.\n\n' +
        '## Output\n' +
        '- List of tests added (file:line)\n' +
        '- Pass/fail status of each\n' +
        '- Any BLOCKER findings (real bugs uncovered)\n' +
        '- Coverage gaps you noticed but did not address\n',
      { label: 'tdd', phase: 'Verify', agentType: 'repohelm-test-agent' }
    ),
  () =>
    agent(
      'You are running as the code-reviewer for RepoHelm on a completed change.\n\n' +
        `## Change scope\n${scope}\n\n` +
        '## Your job\n' +
        '1. Inspect the changed files via `git diff HEAD` and read surrounding context.\n' +
        '2. Review per your code-reviewer instructions (correctness, state mutation safety, REST type drift, Tailwind v4 tokens, orchestrator tool loop, import conventions).\n' +
        '3. Return numbered findings with severity (blocker / warn / nit) and file:line.\n' +
        '4. End with exactly one of: `VERDICT: APPROVE` | `VERDICT: REQUEST_CHANGES` | `VERDICT: BLOCK`.\n\n' +
        'Read-only — do NOT make edits.\n',
      { label: 'reviewer', phase: 'Verify', agentType: 'code-reviewer' }
    ),
])

// --- Phase 3: Verdict -------------------------------------------------------
// Synthesize both reports into a single final verdict the user can act on.
phase('Verdict')

const verdict = await agent(
  'You are the final synthesizer for a RepoHelm quality gate.\n\n' +
    `## Change scope\n${scope}\n\n` +
    `## TDD agent report\n${tddResult ?? '(no output — agent may have failed)'}\n\n` +
    `## Code reviewer report\n${reviewResult ?? '(no output — agent may have failed)'}\n\n` +
    '## Verdict rules (apply in order)\n' +
    '1. If either agent returned no output → VERDICT: BLOCK (cannot assess quality).\n' +
    '2. If reviewer said `VERDICT: BLOCK` → final VERDICT: BLOCK.\n' +
    '3. If TDD agent reported any BLOCKER findings (real bugs in feature code) → final VERDICT: BLOCK.\n' +
    '4. If reviewer said `VERDICT: REQUEST_CHANGES` → final VERDICT: REQUEST_CHANGES.\n' +
    '5. If TDD agent has failing tests that could not be fixed → final VERDICT: REQUEST_CHANGES.\n' +
    '6. Otherwise → final VERDICT: APPROVE.\n\n' +
    '## Output format (strict)\n' +
    '### Final Verdict: <APPROVE | REQUEST_CHANGES | BLOCK>\n\n' +
    '### Summary\n' +
    '2-3 sentences on what the change does and the overall quality assessment.\n\n' +
    '### Key Findings\n' +
    '- Bulleted list of the most important items from both agents (≤8 bullets). Skip nits if verdict is APPROVE.\n\n' +
    '### Recommended Next Steps\n' +
    '- Numbered list of concrete actions the user should take before merging. Empty list if APPROVE with no caveats.\n',
  { label: 'synthesizer', phase: 'Verdict' }
)

return {
  scope,
  tdd: tddResult ?? '(no output)',
  review: reviewResult ?? '(no output)',
  verdict: verdict ?? '(synthesizer produced no output)',
}
