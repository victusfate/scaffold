#!/usr/bin/env bash
# Integration test for `queue worktree` git operations against a throwaway repo.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
QUEUE_TS="$HERE/queue.ts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
check() { if eval "$2"; then echo "  pass  $1"; pass=$((pass+1)); else echo "  FAIL  $1"; fail=$((fail+1)); fi; }

# A minimal git repo that carries a copy of the queue scripts so scripts/queue.ts
# resolves ROOT to this repo (worktrees land under its .agent/queue/wt).
cd "$TMP"
git init -q
git config user.email t@t.t; git config user.name t
mkdir scripts
cp "$HERE/queue.ts" "$HERE/queue-model.ts" scripts/
echo "seed" > file.txt
git add -A; git commit -qm init
BASE="$(git rev-parse --abbrev-ref HEAD)"

run() { node scripts/queue.ts "$@"; }

run add "Parallel task one" >/dev/null
run add "Parallel task two" >/dev/null
run config maxParallel 2 >/dev/null

echo "== worktree add creates an isolated checkout on queue/<id> =="
run worktree add task-001 >/dev/null
check "worktree dir exists"        '[ -d "$TMP/.agent/queue/wt/task-001" ]'
check "branch queue/task-001 made" 'git show-ref --verify --quiet refs/heads/queue/task-001'
check "task records worktree path" 'run show task-001 | grep -q "worktree: .agent/queue/wt/task-001"'
check "task records branch"        'run show task-001 | grep -q "branch: queue/task-001"'

echo "== the worktree is a real, independent working tree =="
check "worktree is registered"     'git worktree list | grep -q "wt/task-001"'
( cd "$TMP/.agent/queue/wt/task-001" && echo hi > new.txt && git add -A && git commit -qm work )
check "commit isolated to branch"  '! git log "$BASE" --oneline | grep -q work'
check "commit on task branch"      'git log queue/task-001 --oneline | grep -q work'

echo "== a second task gets its own worktree (parallel) =="
run worktree add task-002 >/dev/null
check "second worktree exists"     '[ -d "$TMP/.agent/queue/wt/task-002" ]'
check "two linked worktrees"       '[ "$(git worktree list | grep -c wt/)" -eq 2 ]'

echo "== worktree remove tears it down and clears the field =="
run worktree remove task-001 >/dev/null
check "worktree dir gone"          '[ ! -d "$TMP/.agent/queue/wt/task-001" ]'
check "field cleared"              '! run show task-001 | grep -q "worktree:"'

echo
echo "queue-worktree: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
