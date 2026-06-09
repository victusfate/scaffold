#!/usr/bin/env bash
# Isolated tests for .claude/read-once/hook.sh — JSON validity, honest
# warn-mode messaging, deny-mode savings accounting, corrupted-state tolerance.
# Drives the hook with crafted stdin in a temp HOME; no harness required.
# Usage: bash scripts/test-read-once.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/.claude/read-once/hook.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
ok()    { echo "  PASS: $1"; ((pass++)) || true; }
ng()    { echo "  FAIL: $1"; ((fail++)) || true; }
check() { local desc="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$desc"; else ng "$desc"; fi; }

# Build hook stdin for a path + session.
hook_input() {
  jq -cn --arg p "$1" --arg s "$2" '{tool_name:"Read", tool_input:{file_path:$p}, session_id:$s}'
}

# Run the hook with isolated HOME; echoes stdout, returns exit code.
run_hook() {
  local input="$1"; shift
  echo "$input" | HOME="$WORK" "$@" bash "$HOOK"
}

STATS="$WORK/.claude/read-once/stats.jsonl"

# ── test 1: first read → silent allow, cache recorded ──────────────────────

echo "1. First read → silent allow"
F1="$WORK/plain.txt"; echo "content" > "$F1"
out=$(run_hook "$(hook_input "$F1" sess-1)" env READ_ONCE_MODE=warn); rc=$?
check "exit 0"           test "$rc" -eq 0
check "no output"        test -z "$out"
check "cache created"    ls "$WORK/.claude/read-once/"session-*.jsonl
check "cache line valid JSON" bash -c "jq -e . $WORK/.claude/read-once/session-*.jsonl"

# ── test 2: warn-mode cache hit → valid JSON, honest message ───────────────

echo "2. Warn-mode cache hit → advisory without savings claims"
out=$(run_hook "$(hook_input "$F1" sess-1)" env READ_ONCE_MODE=warn)
check "output is valid JSON"     bash -c "printf '%s' '$out' | jq -e ."
check "decision is allow"        bash -c "printf '%s' '$out' | jq -e '.hookSpecificOutput.permissionDecision == \"allow\"'"
check "no savings claim in warn" bash -c "! printf '%s' '$out' | grep -qi 'sav'"
check "no tokens_saved stat in warn" bash -c "! grep -q tokens_saved '$STATS'"

# ── test 3: deny-mode cache hit → block with savings accounting ────────────

echo "3. Deny-mode cache hit → block + tokens_saved stat"
F3="$WORK/deny.txt"; echo "content" > "$F3"
run_hook "$(hook_input "$F3" sess-3)" env READ_ONCE_MODE=deny > /dev/null
out=$(run_hook "$(hook_input "$F3" sess-3)" env READ_ONCE_MODE=deny)
check "output is valid JSON"  bash -c "printf '%s' '$out' | jq -e ."
check "decision is block"     bash -c "printf '%s' '$out' | jq -e '.decision == \"block\"'"
check "tokens_saved recorded" grep -q tokens_saved "$STATS"

# ── test 4: path containing a double quote → still valid JSON ──────────────

echo "4. Quote-bearing path → valid JSON everywhere"
F4="$WORK/we\"ird.txt"; echo "content" > "$F4"
run_hook "$(hook_input "$F4" sess-4)" env READ_ONCE_MODE=warn > /dev/null
out=$(run_hook "$(hook_input "$F4" sess-4)" env READ_ONCE_MODE=warn)
check "advisory is valid JSON"  bash -c "printf '%s' \"\$1\" | jq -e ." _ "$out"
check "cache lines all valid"   bash -c "jq -es . $WORK/.claude/read-once/session-*.jsonl"
check "stats lines all valid"   bash -c "jq -es . '$STATS'"

# ── test 5: corrupted .last-cleanup → hook still works ─────────────────────

echo "5. Corrupted .last-cleanup → tolerated"
echo "garbage-not-a-number" > "$WORK/.claude/read-once/.last-cleanup"
F5="$WORK/after-corrupt.txt"; echo "content" > "$F5"
rc=0
run_hook "$(hook_input "$F5" sess-5)" env READ_ONCE_MODE=warn > /dev/null 2>&1 || rc=$?
check "exit 0 despite corrupt marker" test "$rc" -eq 0

# ── test 6: stats.jsonl bounded by hourly cleanup ───────────────────────────

echo "6. stats.jsonl pruned by cleanup"
for i in $(seq 1 6000); do echo '{"ts":1,"event":"hit"}'; done > "$STATS"
echo "0" > "$WORK/.claude/read-once/.last-cleanup"   # force cleanup window
F6="$WORK/prune.txt"; echo "content" > "$F6"
run_hook "$(hook_input "$F6" sess-6)" env READ_ONCE_MODE=warn > /dev/null
lines=$(wc -l < "$STATS" | tr -d ' ')
check "stats pruned to <=5000 lines" test "$lines" -le 5000

# ── summary ────────────────────────────────────────────────────────────────

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
