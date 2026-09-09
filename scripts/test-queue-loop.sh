#!/usr/bin/env bash
# Tests for the loop-driver signals: tick/ready exit codes + the enqueue kick hint.
# Exit codes: 0 dispatched · 3 idle · 4 paused · 5 stopped.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export QUEUE_FILE="$TMP/queue.md"
Q() { node "$HERE/queue.ts" "$@"; }
add_id() { Q add "$1" | grep -o 'task-[0-9][0-9]*' | head -1; }   # add a task, echo its id

pass=0; fail=0
code() { Q "$@" >/dev/null 2>&1; echo $?; }        # capture exit code of a command
check() { if [ "$2" = "$3" ]; then echo "  pass  $1 ($3)"; pass=$((pass+1));
          else echo "  FAIL  $1 — got $2 want $3"; fail=$((fail+1)); fi; }
grep_check() { if echo "$2" | grep -q "$3"; then echo "  pass  $1"; pass=$((pass+1));
          else echo "  FAIL  $1"; fail=$((fail+1)); fi; }

echo "== tick exit codes =="
check "empty running → idle"     "$(code tick)" 3
t1=$(add_id "first task")
check "with work → dispatched"   "$(code tick)" 0
Q "done" "$t1" >/dev/null                # completes → auto-archives out of the queue
check "drained → idle"           "$(code tick)" 3

echo "== enqueue kick hint (running + idle) =="
grep_check "add hints to start"  "$(Q add 'another')" "start now"

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
# Clear whatever prior sections left pending/active so the cap math is exact.
for t in $(Q list | grep -o 'task-[0-9][0-9]*'); do Q "done" "$t" --skip-validate >/dev/null 2>&1; done
a=$(add_id "p1"); b=$(add_id "p2"); add_id "p3" >/dev/null
Q config maxParallel 2 >/dev/null
check "ready with slots → dispatched" "$(code ready)" 0
Q claim "$a" >/dev/null 2>&1
Q claim "$b" >/dev/null 2>&1
# two active at cap 2 → nothing more ready
check "ready at cap → idle"      "$(code ready)" 3

echo "== idle fallback cadence is config-driven =="
Q stop >/dev/null; Q start >/dev/null
grep_check "loop emits default idlePoll 20m" "$(Q loop)" "/loop 20m"
Q config idlePoll 15m >/dev/null
grep_check "loop reflects idlePoll change" "$(Q loop)" "/loop 15m"
grep_check "loop names all cadences"        "$(Q loop)" "busy → continue immediately"

echo "== idle terminates the loop when a Monitor is armed =="
grep_check "loop arms a Monitor first"      "$(Q loop)" "Monitor"
grep_check "loop terminates on idle"        "$(Q loop)" "stop:true"
grep_check "heartbeat is only the fallback" "$(Q loop)" "fall back"
grep_check "loop polls the signal command"  "$(Q loop)" "signal"
grep_check "loop: no fire on empty queue"   "$(Q loop)" "empty queue"
grep_check "loop isolates other sessions"   "$(Q loop)" "must never be stopped, reclaimed, interrupted, or signalled"

echo "== signal: pollable drain marker, silent on empty (no fire on empty queue) =="
S="$TMP/signal.md"
QS() { QUEUE_FILE="$S" node "$HERE/queue.ts" "$@"; }
codeS() { QS "$@" >/dev/null 2>&1; echo $?; }
missS() { if echo "$2" | grep -q "$3"; then echo "  FAIL  $1"; fail=$((fail+1));
          else echo "  pass  $1"; pass=$((pass+1)); fi; }
check "empty queue → signal idle (3)"     "$(codeS signal)" 3
missS "empty queue emits no marker"       "$(QS signal 2>/dev/null)" "DRAIN-WANTED"
QS add "s1" >/dev/null
check "drainable → signal dispatched (0)" "$(codeS signal)" 0
grep_check "drainable emits DRAIN-WANTED"  "$(QS signal)" "DRAIN-WANTED 1 pending"
sid=$(QS next | grep -o 'task-[0-9][0-9]*' | head -1); QS claim "$sid" >/dev/null 2>&1
check "active driver → signal idle (3)"    "$(codeS signal)" 3
missS "active driver emits no marker"      "$(QS signal 2>/dev/null)" "DRAIN-WANTED"
QS "done" "$sid" --skip-validate >/dev/null
check "completed task auto-archived"       "$(QS list | grep -c "$sid")" 0
check "drained → signal idle (3)"          "$(codeS signal)" 3

echo "== DRAIN-WANTED marker: non-empty + running ⇒ a driver is wanted =="
# Self-contained queue so it can't perturb the ID-sequenced sections above.
D="$TMP/drain.md"
QD() { QUEUE_FILE="$D" node "$HERE/queue.ts" "$@"; }
missing_check() { if echo "$2" | grep -q "$3"; then echo "  FAIL  $1"; fail=$((fail+1));
          else echo "  pass  $1"; pass=$((pass+1)); fi; }
grep_check "add emits DRAIN-WANTED"    "$(QD add 'd1')" "queue: DRAIN-WANTED 1 pending"
grep_check "second add updates count"  "$(QD add 'd2')" "queue: DRAIN-WANTED 2 pending"
grep_check "top re-emits DRAIN-WANTED" "$(QD top task-002)" "queue: DRAIN-WANTED"
QD stop >/dev/null
missing_check "stop suppresses marker (operator halt ≠ stall)" "$(QD add 'd3')" "DRAIN-WANTED"
grep_check "start re-attaches a driver" "$(QD start)" "queue: DRAIN-WANTED 3 pending"

echo "== stale ownership fails closed =="
S="$TMP/stale.md"
cat >"$S" <<'EOF'
# Work Queue

<!-- queue:config
status: running
leaseMinutes: 1
-->

- [>] task-001 — possibly live in another session
  - owner: another-session
  - started: 2020-01-01T00:00:00.000Z
EOF
QSTALE() { QUEUE_FILE="$S" node "$HERE/queue.ts" "$@"; }
codeSTALE() { QSTALE "$@" >/dev/null 2>&1; echo $?; }
check "stale lease → ownership conflict" "$(codeSTALE tick)" 6
grep_check "conflicting task stays active" "$(QSTALE list)" "▶ task-001"

echo
echo "queue-loop: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
