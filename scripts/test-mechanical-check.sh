#!/usr/bin/env bash
# Tests for check-quality-mechanical.sh using fixture files.
set -euo pipefail
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

SCRIPT=scripts/check-quality-mechanical.sh

[ -f "$SCRIPT" ] || { echo "MISSING: $SCRIPT"; exit 1; }
[ -x "$SCRIPT" ] || { echo "NOT EXECUTABLE: $SCRIPT"; exit 1; }

FIXTURES=$(mktemp -d)
trap 'rm -rf "$FIXTURES"' EXIT
FIXTURE_LINE_COUNT=260   # deliberately over the 250-line limit

# Fixture: clean file (≤250 lines, no magic numbers, no commented-out code)
CLEAN="$FIXTURES/clean.js"
printf 'const MAX_RETRIES = 3;\nfunction run() { return MAX_RETRIES; }\n' > "$CLEAN"

# Fixture: file over 250 lines
LONG="$FIXTURES/long.js"
for i in $(seq 1 "$FIXTURE_LINE_COUNT"); do printf 'const x%d = %d;\n' "$i" "$i"; done > "$LONG"

# Fixture: file with magic number
MAGIC="$FIXTURES/magic.js"
printf 'function timeout() { return 86400; }\n' > "$MAGIC"

# Fixture: file with commented-out code block
COMMENTED="$FIXTURES/commented.js"
printf '// function old() {\n//   return 1;\n// }\nfunction current() {}\n' > "$COMMENTED"

# Clean file should pass
if bash "$SCRIPT" "$CLEAN" > /dev/null 2>&1; then
  ok "clean file passes"
else
  fail "clean file should pass"
fi

# Long file should fail
if bash "$SCRIPT" "$LONG" > /dev/null 2>&1; then
  fail "long file should fail"
else
  ok "long file (>250 lines) fails"
fi

# Long file error includes filename:line citation
output=$(bash "$SCRIPT" "$LONG" 2>&1 || true)
if echo "$output" | grep -qE '(long\.js|long):'; then
  ok "long file citation includes filename"
else
  fail "long file error must include filename:line citation"
fi

# Magic number should fail
if bash "$SCRIPT" "$MAGIC" > /dev/null 2>&1; then
  fail "magic number file should fail"
else
  ok "magic number file fails"
fi

# Magic number error includes filename:line citation
output=$(bash "$SCRIPT" "$MAGIC" 2>&1 || true)
if echo "$output" | grep -qE '(magic\.js|magic):'; then
  ok "magic number citation includes filename"
else
  fail "magic number error must include filename:line citation"
fi

# Commented-out code block should fail
if bash "$SCRIPT" "$COMMENTED" > /dev/null 2>&1; then
  fail "commented-out code file should fail"
else
  ok "commented-out code block fails"
fi

# Commented-out code error includes filename:line citation
output=$(bash "$SCRIPT" "$COMMENTED" 2>&1 || true)
if echo "$output" | grep -qE '(commented\.js|commented):'; then
  ok "commented-out code citation includes filename"
else
  fail "commented-out code error must include filename:line citation"
fi

echo ""
echo "$PASS passed, $FAIL failed."
[ $FAIL -eq 0 ]
