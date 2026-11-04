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

# ── test 10: file dropped from manifest, pristine → pruned ────────────────

echo "10. Dropped upstream + pristine → removed downstream"
S="$WORK/s10"; C="$WORK/c10"
make_scaffold "$S" "AGENTS.md" "old.mjs"
make_consumer "$C"
out=""; sync_into out "$C" "$S" || true        # first sync — get both files + SHA
(cd "$C" && git add -A && git commit -q -m "synced")
# Upstream drops old.mjs from the manifest and the tree
(cd "$S" && printf '%s\n' "AGENTS.md" > .github/scaffold-files.txt \
  && git rm -q old.mjs && git add -A && git commit -q -m "drop old.mjs")

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0"                 test "$rc" -eq 0
check "pristine orphan removed" test ! -f "$C/old.mjs"
check "kept file untouched"     test -f "$C/AGENTS.md"
check "Removed in output"       test -n "$(echo "$out" | grep 'Removed')"

# ── test 11: dropped but consumer-modified → kept, not deleted ────────────

echo "11. Dropped upstream + locally modified → kept"
S="$WORK/s11"; C="$WORK/c11"
make_scaffold "$S" "AGENTS.md" "old.mjs"
make_consumer "$C"
out=""; sync_into out "$C" "$S" || true
(cd "$C" && git add -A && git commit -q -m "synced")
echo "my edits" >> "$C/old.mjs"               # consumer customized it
(cd "$C" && git add old.mjs && git commit -q -m "customize")
(cd "$S" && printf '%s\n' "AGENTS.md" > .github/scaffold-files.txt \
  && git rm -q old.mjs && git add -A && git commit -q -m "drop old.mjs")

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0"               test "$rc" -eq 0
check "modified orphan kept"  test -f "$C/old.mjs"
check "edit preserved"        grep -q "my edits" "$C/old.mjs"
check "Kept in output"        test -n "$(echo "$out" | grep 'Kept (dropped')"

# ── test 12: dropped + .scaffold-keep → kept ──────────────────────────────

echo "12. Dropped upstream + .scaffold-keep → kept"
S="$WORK/s12"; C="$WORK/c12"
make_scaffold "$S" "AGENTS.md" "old.mjs"
make_consumer "$C"
out=""; sync_into out "$C" "$S" || true
(cd "$C" && git add -A && git commit -q -m "synced")
echo "old.mjs" > "$C/.scaffold-keep"
(cd "$S" && printf '%s\n' "AGENTS.md" > .github/scaffold-files.txt \
  && git rm -q old.mjs && git add -A && git commit -q -m "drop old.mjs")

out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0"            test "$rc" -eq 0
check "keep-listed orphan kept" test -f "$C/old.mjs"

# ── test 13: --dry-run previews deletion but writes nothing ───────────────

echo "13. --dry-run → reports would-remove, deletes nothing, no SHA change"
S="$WORK/s13"; C="$WORK/c13"
make_scaffold "$S" "AGENTS.md" "old.mjs"
make_consumer "$C"
out=""; sync_into out "$C" "$S" || true
(cd "$C" && git add -A && git commit -q -m "synced")
sha_before=$(cat "$C/.github/scaffold-sync-sha")
(cd "$S" && printf '%s\n' "AGENTS.md" > .github/scaffold-files.txt \
  && git rm -q old.mjs && git add -A && git commit -q -m "drop old.mjs")

rc=0
out=$(cd "$C" && SCAFFOLD_URL="$S" bash "$SYNC" --dry-run 2>&1) || rc=$?
check "exit 0"                  test "$rc" -eq 0
check "file NOT deleted"        test -f "$C/old.mjs"
check "Would remove in output"  test -n "$(echo "$out" | grep 'Would remove')"
check "SHA unchanged"           test "$(cat "$C/.github/scaffold-sync-sha")" = "$sha_before"

# ── AGENTS.local.md: compose + verify ───────────────────────────────────────

echo "L1. AGENTS.local.md present → AGENTS.md = scaffold text + local block"
S="$WORK/sl1"; C="$WORK/cl1"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"
printf 'project rule one\nproject rule two\n' > "$C/AGENTS.local.md"
out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "exit 0"                         test "$rc" -eq 0
check "starts with scaffold text"      test "$(head -1 "$C/AGENTS.md")" = "scaffold:AGENTS.md"
check "carries the local rules"        grep -q "project rule two" "$C/AGENTS.md"
check "begin marker once"              test "$(grep -c 'BEGIN AGENTS.local.md' "$C/AGENTS.md")" -eq 1
check "verify-local passes"            bash -c "cd '$C' && bash '$SYNC' --verify-local"
(cd "$C" && git add -A && git commit -q -m "sync")

echo "L2. Re-sync is idempotent; scaffold update recomposes"
out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "no change on re-sync"           test -z "$(cd "$C" && git status --porcelain AGENTS.md)"
(cd "$S" && echo "scaffold:AGENTS.md v2" > AGENTS.md && git commit -qam "v2")
out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "upstream part updated"          grep -q "scaffold:AGENTS.md v2" "$C/AGENTS.md"
check "local block kept"               grep -q "project rule one" "$C/AGENTS.md"
check "no conflict reported"           test -z "$(echo "$out" | grep Conflicts)"
(cd "$C" && git add -A && git commit -q -m "sync v2")

echo "L3. verify-local catches a hand-edited block or a stale re-sync"
sed -i 's/project rule one/hand edit/' "$C/AGENTS.md"
check "hand-edited block fails"        bash -c "! (cd '$C' && bash '$SYNC' --verify-local)"
(cd "$C" && git checkout -q AGENTS.md)
echo "project rule three" >> "$C/AGENTS.local.md"
check "stale block fails"              bash -c "! (cd '$C' && bash '$SYNC' --verify-local)"

echo "L4. No AGENTS.local.md → AGENTS.md syncs exactly as before"
S="$WORK/sl4"; C="$WORK/cl4"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"
out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "plain scaffold AGENTS.md"       test "$(cat "$C/AGENTS.md")" = "scaffold:AGENTS.md"
check "verify-local is a no-op"        bash -c "cd '$C' && bash '$SYNC' --verify-local"

echo "L5. .scaffold-keep on AGENTS.md wins over AGENTS.local.md"
S="$WORK/sl5"; C="$WORK/cl5"
make_scaffold "$S" "AGENTS.md"
make_consumer "$C"
echo "my own agents" > "$C/AGENTS.md"; echo "AGENTS.md" > "$C/.scaffold-keep"; echo "local" > "$C/AGENTS.local.md"
(cd "$C" && git add -A && git commit -q -m "own")
out=""; rc=0; sync_into out "$C" "$S" || rc=$?
check "kept AGENTS.md untouched"       test "$(cat "$C/AGENTS.md")" = "my own agents"

echo "R1. Conflicts remain blocked until explicitly accepting committed resolutions"
S="$WORK/sr1"; C="$WORK/cr1"
make_scaffold "$S" "model.ts" "db.ts"
make_consumer "$C"
out=""; sync_into out "$C" "$S"
sha_before=$(cat "$C/.github/scaffold-sync-sha")
(cd "$C" && git add -A && git commit -qm "synced")
printf 'consumer model\n' > "$C/model.ts"
printf 'consumer db\n' > "$C/db.ts"
(cd "$C" && git add -A && git commit -qm "consumer changes")
printf 'upstream model\n' > "$S/model.ts"
printf 'upstream db\n' > "$S/db.ts"
(cd "$S" && git add -A && git commit -qm "upstream changes")
rc=0; sync_into out "$C" "$S" || rc=$?
check "conflict exits 1" test "$rc" -eq 1
check "conflict does not save SHA" test "$(cat "$C/.github/scaffold-sync-sha")" = "$sha_before"
check "resolution instructions name flag" test -n "$(echo "$out" | grep -- --mark-resolved)"
(cd "$C" && git add -A && git commit -qm "unresolved markers")
rc=0
out=$(cd "$C" && SCAFFOLD_URL="$S" bash "$SYNC" --mark-resolved model.ts) || rc=$?
check "committed markers rejected" test "$rc" -ne 0
printf 'consumer model\nupstream model\n' > "$C/model.ts"
printf 'consumer db\nupstream db\n' > "$C/db.ts"
rc=0
out=$(cd "$C" && SCAFFOLD_URL="$S" bash "$SYNC" --mark-resolved model.ts) || rc=$?
check "uncommitted resolution rejected" test "$rc" -ne 0
(cd "$C" && git add model.ts)
rc=0
out=$(cd "$C" && SCAFFOLD_URL="$S" bash "$SYNC" --mark-resolved model.ts) || rc=$?
check "staged resolution rejected" test "$rc" -ne 0
(cd "$C" && git add -A && git commit -qm "resolved both sides")
rc=0
out=$(cd "$C" && SCAFFOLD_URL="$S" bash "$SYNC" --dry-run --mark-resolved model.ts --mark-resolved db.ts) || rc=$?
check "dry-run accepts repeated resolutions" test "$rc" -eq 0
check "dry-run leaves SHA alone" test "$(cat "$C/.github/scaffold-sync-sha")" = "$sha_before"
check "dry-run leaves resolution alone" test -z "$(cd "$C" && git diff -- model.ts db.ts)"
rc=0
out=$(cd "$C" && SCAFFOLD_URL="$S" bash "$SYNC" --mark-resolved model.ts --mark-resolved db.ts) || rc=$?
check "committed resolutions accepted" test "$rc" -eq 0
check "SHA advances to upstream" test "$(cat "$C/.github/scaffold-sync-sha")" = "$(cd "$S" && git rev-parse HEAD)"
check "no re-merge of resolved files" test -z "$(cd "$C" && git diff -- model.ts db.ts)"
rc=0; sync_into out "$C" "$S" || rc=$?
check "next retry is up to date" test "$rc" -eq 0
check "up-to-date output" test -n "$(echo "$out" | grep 'Already up to date')"

echo "R2. Invalid resolution arguments fail before modifying managed files"
make_consumer "$WORK/cr2"
C="$WORK/cr2"
for args in missing unmanaged; do
  rc=0
  if [ "$args" = missing ]; then
    out=$(cd "$C" && SCAFFOLD_URL="$S" bash "$SYNC" --mark-resolved) || rc=$?
  else
    out=$(cd "$C" && SCAFFOLD_URL="$S" bash "$SYNC" --mark-resolved ../outside.ts) || rc=$?
  fi
  check "$args argument rejected" test "$rc" -ne 0
  check "$args does not write managed files" test ! -e "$C/model.ts"
  check "$args does not save SHA" test ! -e "$C/.github/scaffold-sync-sha"
done

# ── summary ────────────────────────────────────────────────────────────────

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
