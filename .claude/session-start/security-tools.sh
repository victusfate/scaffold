#!/usr/bin/env bash
# security-tools.sh: SessionStart hook — installs the pinned security scanners in the background in a Claude
# Code cloud session (CLAUDE_CODE_REMOTE=true), so the pre-merge gate (docs/security-review.md) can run in a
# fresh container without anyone remembering to set it up. Locally it does nothing: install once by hand.
# Runs origin/main's copy of scripts/setup-security-tools.sh, never the branch's (it is a gate file), and logs
# to .tooling/security/setup.log. It is idempotent: an already-installed toolset is re-verified in seconds.
# Exits 0 always: a slow or failed install must never block a session. The gate fails closed on its own.

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --git-dir > /dev/null 2>&1 || exit 0
git fetch origin main --quiet 2> /dev/null
script=$(git show origin/main:scripts/setup-security-tools.sh 2> /dev/null) || exit 0

mkdir -p .tooling/security
log=.tooling/security/setup.log
tmp=$(mktemp -d) || exit 0
printf '%s\n' "$script" > "$tmp/setup-security-tools.sh"
nohup setsid bash -c 'bash "$1/setup-security-tools.sh"; echo "exit=$?"; rm -rf "$1"' _ "$tmp" > "$log" 2>&1 < /dev/null &
echo "security scanners installing in the background (log: $log)"
exit 0
