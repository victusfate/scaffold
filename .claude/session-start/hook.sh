#!/usr/bin/env bash
# session-start: SessionStart hook for Claude Code
# Enables the pre-commit gate in cloud sessions, then fetches origin/main silently
# and warns if the working branch is behind.
# Exits 0 always — a fetch failure must never block a session.

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Not a git repo? Nothing to do.
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

# Cloud sessions get the pre-commit gate without anyone remembering to opt in.
# Locally, enabling hooks stays your choice: git config core.hooksPath .githooks
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ -f .githooks/pre-commit ] &&
  [ -z "$(git config core.hooksPath)" ]; then
  git config core.hooksPath .githooks
fi

# Fetch origin/main quietly; ignore network errors.
git fetch origin main --quiet 2>/dev/null || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
[ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ] && exit 0

BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "0")
[ "$BEHIND" = "0" ] && exit 0

if [ "$BRANCH" = "main" ]; then
  echo "⚠  main is $BEHIND commit(s) behind origin/main — run: git pull origin main"
else
  echo "⚠  '$BRANCH' is $BEHIND commit(s) behind origin/main — rebase before new feature work: git rebase origin/main"
fi
