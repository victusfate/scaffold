#!/usr/bin/env bash
# Tests for the loop-driver signals: tick/ready exit codes + the enqueue kick hint.
# Exit codes: 0 dispatched · 3 idle · 4 paused · 5 stopped.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export QUEUE_FILE="$TMP/queue.md"
Q() { node "$HERE/queue.ts" "$@"; }

pass=0; fail=0
code() { Q "$@" >/dev/null 2>&1; echo $?; }        # capture exit code of a command
check() { if [ "$2" = "$3" ]; then echo "  pass  $1 ($3)"; pass=$((pass+1));
          else echo "  FAIL  $1 — got $2 want $3"; fail=$((fail+1)); fi; }
grep_check() { if echo "$2" | grep -q "$3"; then echo "  pass  $1"; pass=$((pass+1));
          else echo "  FAIL  $1"; fail=$((fail+1)); fi; }

echo "== tick exit codes =="
check "empty running → idle"     "$(code tick)" 3
Q add "first task" >/dev/null
check "with work → dispatched"   "$(code tick)" 0
Q done task-001 >/dev/null
check "drained → idle"           "$(code tick)" 3

echo "== enqueue kick hint (running + idle) =="
grep_check "add hints to start"  "$(Q add 'another')" "start now"
Q done task-002 >/dev/null

echo "== stopped vs paused codes =="
Q stop >/dev/null
check "manual stop → stopped"    "$(code tick)" 5
Q start >/dev/null
Q pause --minutes 60 >/dev/null
check "future pause → paused"    "$(code tick)" 4
check "ready also paused"        "$(code ready)" 4

echo "== paused past resumeAt auto-resumes + dispatches =="
Q add "work after resume" >/dev/null
Q pause --until 2020-01-01T00:00:00.000Z >/dev/null
check "past pause → dispatched"  "$(code tick)" 0
check "queue now running"        "$(Q list | grep -c 'running')" 1

echo "== ready exit codes under parallel cap =="
Q start >/dev/null
Q done task-003 >/dev/null            # finish the one auto-resumed above
Q add "p1" >/dev/null; Q add "p2" >/dev/null; Q add "p3" >/dev/null  # task-004/005/006
Q config maxParallel 2 >/dev/null
check "ready with slots → dispatched" "$(code ready)" 0
Q claim task-004 >/dev/null 2>&1
Q claim task-005 >/dev/null 2>&1
# two active at cap 2 → nothing more ready
check "ready at cap → idle"      "$(code ready)" 3

echo
echo "queue-loop: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
