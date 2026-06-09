#!/usr/bin/env bash
# Isolated tests for bin/bootstrap.sh flags and non-destructive default.
# Points SCAFFOLD_URL at a local mock scaffold repo; no network required.
# Usage: bash scripts/test-bootstrap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP="$ROOT/bin/bootstrap.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
ok()    { echo "  PASS: $1"; ((pass++)) || true; }
ng()    { echo "  FAIL: $1"; ((fail++)) || true; }
check() { local desc="$1"; shift; if "$@" 2>/dev/null; then ok "$desc"; else ng "$desc"; fi; }

# ── mock scaffold repo ─────────────────────────────────────────────────────

SCAFFOLD="$WORK/scaffold-origin"
mkdir -p "$SCAFFOLD/.github/workflows" "$SCAFFOLD/bin"
(cd "$SCAFFOLD" && git init -q && git config commit.gpgsign false \
  && git config user.email "t@t" && git config user.name T)

# Minimal sync script that prints a marker when run
cat > "$SCAFFOLD/bin/sync-from-scaffold.sh" <<'SYNCEOF'
#!/usr/bin/env bash
echo "SYNC_RAN"
exit 0
SYNCEOF
chmod +x "$SCAFFOLD/bin/sync-from-scaffold.sh"

echo "name: sync-scaffold" > "$SCAFFOLD/.github/workflows/sync-scaffold.yml"
printf 'bin/sync-from-scaffold.sh\n' > "$SCAFFOLD/.github/scaffold-files.txt"

(cd "$SCAFFOLD" && git add . && git commit -q -m "init" && git branch -m main)

# ── helper: fresh consumer repo ───────────────────────────────────────────

make_consumer() {
  local dir="$1"
  mkdir -p "$dir"
  (cd "$dir" && git init -q && git config commit.gpgsign false \
    && git config user.email "t@t" && git config user.name T \
    && git commit --allow-empty -q -m "init")
}

# ── test 1: default — no sync, no workflow ────────────────────────────────

echo "1. Default (no flags) — installs sync script, no sync run, no workflow"
C="$WORK/c1"
make_consumer "$C"

out=$(cd "$C" && SCAFFOLD_URL="$SCAFFOLD" bash "$BOOTSTRAP" 2>&1)
check "sync script installed"   test -x "$C/bin/sync-from-scaffold.sh"
check "workflow NOT installed"  test ! -f "$C/.github/workflows/sync-scaffold.yml"
check "sync did NOT run"        test -z "$(echo "$out" | grep 'SYNC_RAN')"
check "next-step hint printed"  test -n "$(echo "$out" | grep 'sync-from-scaffold.sh')"

# ── test 2: --run flag — sync executes ────────────────────────────────────

echo "2. --run flag — sync executes after install"
C="$WORK/c2"
make_consumer "$C"

out=$(cd "$C" && SCAFFOLD_URL="$SCAFFOLD" bash "$BOOTSTRAP" --run 2>&1)
check "sync script installed"  test -x "$C/bin/sync-from-scaffold.sh"
check "sync DID run"           test -n "$(echo "$out" | grep 'SYNC_RAN')"

# ── test 3: --with-workflow flag — workflow installed ─────────────────────

echo "3. --with-workflow flag — workflow file installed"
C="$WORK/c3"
make_consumer "$C"

(cd "$C" && SCAFFOLD_URL="$SCAFFOLD" bash "$BOOTSTRAP" --with-workflow >/dev/null 2>&1)
check "workflow installed"     test -f "$C/.github/workflows/sync-scaffold.yml"
check "sync script installed"  test -x "$C/bin/sync-from-scaffold.sh"

# ── test 4: non-git dir → error ───────────────────────────────────────────

echo "4. Non-git directory → error, exit non-zero"
C="$WORK/c4-nogit"
mkdir -p "$C"

rc=0
(cd "$C" && SCAFFOLD_URL="$SCAFFOLD" bash "$BOOTSTRAP" 2>/dev/null) || rc=$?
check "exits non-zero"  test "$rc" -ne 0

# ── test 5: idempotent — re-run does not error on existing scaffold remote ─

echo "5. Idempotent — re-running does not error on existing scaffold remote"
C="$WORK/c5"
make_consumer "$C"

(cd "$C" && SCAFFOLD_URL="$SCAFFOLD" bash "$BOOTSTRAP" >/dev/null 2>&1)
rc=0
(cd "$C" && SCAFFOLD_URL="$SCAFFOLD" bash "$BOOTSTRAP" >/dev/null 2>&1) || rc=$?
check "second run exit 0"  test "$rc" -eq 0

# ── test 6: run from a subdirectory → installs at repo root ───────────────

echo "6. Run from subdirectory → bin/ lands at repo root"
C="$WORK/c6"
make_consumer "$C"
mkdir -p "$C/sub/dir"

rc=0
(cd "$C/sub/dir" && SCAFFOLD_URL="$SCAFFOLD" bash "$BOOTSTRAP" >/dev/null 2>&1) || rc=$?
check "exit 0"                test "$rc" -eq 0
check "sync script at root"   test -x "$C/bin/sync-from-scaffold.sh"
check "bin NOT in subdir"     test ! -d "$C/sub/dir/bin"

# ── test 7: unknown flag → rejected ───────────────────────────────────────

echo "7. Unknown flag → error, exit non-zero"
C="$WORK/c7"
make_consumer "$C"

rc=0
(cd "$C" && SCAFFOLD_URL="$SCAFFOLD" bash "$BOOTSTRAP" --bogus >/dev/null 2>&1) || rc=$?
check "unknown flag exits non-zero"  test "$rc" -ne 0

# ── summary ───────────────────────────────────────────────────────────────

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
