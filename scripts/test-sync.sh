#!/usr/bin/env bash
# Isolated tests for bin/sync-from-scaffold.sh clobber-safe behaviors.
# Creates a local mock scaffold repo as the remote; no network required.
# Usage: bash scripts/test-sync.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC="$ROOT/bin/sync-from-scaffold.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
ok()    { echo "  PASS: $1"; ((pass++)) || true; }
ng()    { echo "  FAIL: $1"; ((fail++)) || true; }
check() { local desc="$1"; shift; if "$@" 2>/dev/null; then ok "$desc"; else ng "$desc"; fi; }

# ── helpers ────────────────────────────────────────────────────────────────

# Create a mock scaffold repo with the given list of files.
# Each file gets content "scaffold:<path>".
make_scaffold() {
  local dir="$1"; shift
  mkdir -p "$dir/.github"
  (cd "$dir" && git init -q && git config commit.gpgsign false \
    && git config user.email "t@t" && git config user.name T)
  printf '%s\n' "$@" > "$dir/.github/scaffold-files.txt"
  for f in "$@"; do
    mkdir -p "$dir/$(dirname "$f")"
    echo "scaffold:$f" > "$dir/$f"
  done
  (cd "$dir" && git add . && git commit -q -m "init" && git branch -m main)
}

# Create a bare consumer repo (no scaffold remote yet).
make_consumer() {
  local dir="$1"
  mkdir -p "$dir"
  (cd "$dir" && git init -q && git config commit.gpgsign false \
    && git config user.email "t@t" && git config user.name T \
    && git commit --allow-empty -q -m "init")
}

# Run sync in consumer dir; captures combined output into the named variable.
# Returns the exit code of the sync script.
# Usage: sync_into <varname> <consumer_dir> <scaffold_dir>
sync_into() {
  local _var="$1" _c="$2" _s="$3" _rc=0
  local _out
  _out=$(cd "$_c" && SCAFFOLD_URL="$_s" bash "$SYNC" 2>&1) || _rc=$?
  printf -v "$_var" '%s' "$_out"
  return $_rc
}

# ── test 1: new file is written ────────────────────────────────────────────

echo "1. New file — absent in consumer → written"
S="$WORK/s1"; C="$WORK/c1"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0"            test "$rc" -eq 0
check "AGENTS.md written" test -f "$C/AGENTS.md"
check "content correct"   grep -q "scaffold:AGENTS.md" "$C/AGENTS.md"
check "no sidecar"        test ! -f "$C/AGENTS.md.scaffold-new"

# ── test 2: identical file → nothing done ─────────────────────────────────

echo "2. Identical file → skipped silently"
S="$WORK/s2"; C="$WORK/c2"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"
cp "$S/AGENTS.md" "$C/AGENTS.md"
(cd "$C" && git add AGENTS.md && git commit -q -m "add")

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0"          test "$rc" -eq 0
check "not in output"   test -z "$(echo "$out" | grep 'AGENTS\.md')"
check "no sidecar"      test ! -f "$C/AGENTS.md.scaffold-new"

# ── test 3: no base SHA, target differs → sidecar, original untouched ─────

echo "3. No base SHA + target differs → sidecar written, original untouched, exit 1"
S="$WORK/s3"; C="$WORK/c3"
make_scaffold "$S" "CLAUDE.md"
make_consumer "$C"
echo "my custom CLAUDE" > "$C/CLAUDE.md"
(cd "$C" && git add CLAUDE.md && git commit -q -m "my claude")

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 1"                   test "$rc" -eq 1
check "original untouched"       grep -q "my custom CLAUDE" "$C/CLAUDE.md"
check "sidecar created"          test -f "$C/CLAUDE.md.scaffold-new"
check "sidecar has scaffold ver" grep -q "scaffold:CLAUDE.md" "$C/CLAUDE.md.scaffold-new"
check "Review in output"         test -n "$(echo "$out" | grep 'Review')"

# ── test 4: .scaffold-keep blocks existing file ───────────────────────────

echo "4. .scaffold-keep — existing file always skipped"
S="$WORK/s4"; C="$WORK/c4"
make_scaffold "$S" "AGENTS.md" "CLAUDE.md"
make_consumer "$C"
echo "my custom CLAUDE" > "$C/CLAUDE.md"
(cd "$C" && git add CLAUDE.md && git commit -q -m "my claude")
echo "CLAUDE.md" > "$C/.scaffold-keep"

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0"             test "$rc" -eq 0
check "original untouched" grep -q "my custom CLAUDE" "$C/CLAUDE.md"
check "no sidecar"         test ! -f "$C/CLAUDE.md.scaffold-new"
check "Kept in output"     test -n "$(echo "$out" | grep 'Kept')"

# ── test 5: .scaffold-keep blocks new file ────────────────────────────────

echo "5. .scaffold-keep — new file also blocked"
S="$WORK/s5"; C="$WORK/c5"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"
echo "AGENTS.md" > "$C/.scaffold-keep"

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0"          test "$rc" -eq 0
check "file not written" test ! -f "$C/AGENTS.md"
check "Kept in output"   test -n "$(echo "$out" | grep 'Kept')"

# ── test 6: uncommitted local edit → skipped ──────────────────────────────

echo "6. Uncommitted local edit → skipped"
S="$WORK/s6"; C="$WORK/c6"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"
out=""; sync_into out "$C" "$S" || true    # first sync — write + save SHA
# Commit the synced file so git tracks it; then dirty it without staging
(cd "$C" && git add AGENTS.md && git commit -q -m "synced")
echo "dirty local change" >> "$C/AGENTS.md"
echo "scaffold:AGENTS.md v2" > "$S/AGENTS.md"
(cd "$S" && git add AGENTS.md && git commit -q -m "update")

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "Skipped in output"  test -n "$(echo "$out" | grep 'Skipped')"
check "local edit intact"  grep -q "dirty local change" "$C/AGENTS.md"

# ── test 7: three-way merge, clean → merged ───────────────────────────────

echo "7. Three-way merge (base SHA present, clean) → merged"
S="$WORK/s7"; C="$WORK/c7"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"
out=""; sync_into out "$C" "$S" || true    # first sync — establishes SHA

check "sha file created" test -f "$C/.github/scaffold-sync-sha"

# Consumer adds a line at top; scaffold adds a line at bottom (no overlap)
{ echo "consumer line"; cat "$C/AGENTS.md"; } > "$C/AGENTS.md.tmp" \
  && mv "$C/AGENTS.md.tmp" "$C/AGENTS.md"
(cd "$C" && git add AGENTS.md && git commit -q -m "consumer edit")

echo "scaffold extra line" >> "$S/AGENTS.md"
(cd "$S" && git add AGENTS.md && git commit -q -m "scaffold update")

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0 (clean merge)"    test "$rc" -eq 0
check "consumer line preserved" grep -q "consumer line"       "$C/AGENTS.md"
check "scaffold line merged in" grep -q "scaffold extra line" "$C/AGENTS.md"
check "no sidecar"              test ! -f "$C/AGENTS.md.scaffold-new"

# ── test 8: run from a subdirectory → operates on the repo root ───────────

echo "8. Run from subdirectory → files land at repo root"
S="$WORK/s8"; C="$WORK/c8"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"
mkdir -p "$C/sub/dir"

rc=0
out=$(cd "$C/sub/dir" && SCAFFOLD_URL="$S" bash "$SYNC" 2>&1) || rc=$?
check "exit 0"                 test "$rc" -eq 0
check "file at repo root"      test -f "$C/AGENTS.md"
check "file NOT in subdir"     test ! -f "$C/sub/dir/AGENTS.md"
check "sha file at repo root"  test -f "$C/.github/scaffold-sync-sha"

# ── test 9: manifest read failure → abort, SHA not saved ──────────────────

echo "9. Manifest missing upstream → non-zero exit, SHA file not written"
S="$WORK/s9"; C="$WORK/c9"
make_scaffold "$S" "AGENTS.md"
(cd "$S" && git rm -q .github/scaffold-files.txt && git commit -q -m "drop manifest")
make_consumer "$C"

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exits non-zero"     test "$rc" -ne 0
check "SHA file not saved" test ! -f "$C/.github/scaffold-sync-sha"
check "error mentions manifest" test -n "$(echo "$out" | grep -i 'manifest')"

# ── summary ────────────────────────────────────────────────────────────────

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
