#!/usr/bin/env bash
# PostToolUse hook: run typecheck after editing .ts / .tsx files.
#
# RepoHelm-specific behavior:
#   - Skip node_modules, worktrees (.repohelm/worktrees/), and dist outputs.
#   - If the edited file lives in packages/core, rebuild @repohelm/core first
#     so server/web typecheck against the fresh build (CLAUDE.md requires this).
#   - Non-zero exit is fine for PostToolUse: output is fed back to Claude as
#     feedback so it can fix the type error; the edit itself is NOT rolled back.

set -uo pipefail

# Hook payload arrives on stdin as JSON.
FILE_PATH=$(jq -r '.tool_input.file_path // empty')

case "$FILE_PATH" in
  "")
    exit 0
    ;;
  */node_modules/*|*/.repohelm/worktrees/*|*/dist/*|*/build/*)
    exit 0
    ;;
  *.ts|*.tsx)
    ;;
  *)
    exit 0
    ;;
esac

# Core must be built before server/web can typecheck correctly.
if [[ "$FILE_PATH" == */packages/core/* ]]; then
  echo "[typecheck-hook] core changed → rebuilding @repohelm/core..."
  if ! pnpm --filter @repohelm/core build >/dev/null 2>&1; then
    echo "[typecheck-hook] ⚠ core build failed; running typecheck anyway"
  fi
fi

echo "[typecheck-hook] running: pnpm typecheck (trigger: $FILE_PATH)"
if pnpm typecheck 2>&1 | tail -40; then
  echo "[typecheck-hook] ✓ typecheck passed"
else
  echo "[typecheck-hook] ✗ typecheck failed — please fix the errors above"
fi
