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
FIXTURE_LINE_COUNT=510   # deliberately over the 500-line limit

# Fixture: clean file (≤500 lines, no magic numbers, no commented-out code)
CLEAN="$FIXTURES/clean.js"
printf 'const MAX_RETRIES = 3;\nfunction run() { return MAX_RETRIES; }\n' > "$CLEAN"

# Fixture: file over 500 lines — comment lines only, no magic-number or commented-code violations
LONG="$FIXTURES/long.js"
for _ in $(seq 1 "$FIXTURE_LINE_COUNT"); do printf '// padding\n'; done > "$LONG"

# Fixture: file with magic number
MAGIC="$FIXTURES/magic.js"
printf 'function timeout() { return 86400; }\n' > "$MAGIC"

# Fixture: file with commented-out code block
COMMENTED="$FIXTURES/commented.js"
printf '// function old() {\n//   return 1;\n// }\nfunction current() {}\n' > "$COMMENTED"

# Fixture: digits inside a quoted string are data (e.g. a grep pattern), not a magic number
QUOTED="$FIXTURES/quoted.sh"
printf 'grep -qE "Score.*10|10 on all" "$f"\n' > "$QUOTED"

# Fixture: magic number suppressed by pragma on the preceding line
PRAGMA="$FIXTURES/pragma.js"
printf '// quality-ok: magic-number — milliseconds in a day is self-documenting\nconst delay = 86400;\n' > "$PRAGMA"

# Fixture: test file — assertion literals are specs, not thresholds
TESTFILE="$FIXTURES/foo.test.js"
printf 'expect(result).toBe(86400);\n' > "$TESTFILE"

# Fixture: return/exit with a bare number — protocol-defined, not a threshold
RETURN="$FIXTURES/handler.js"
printf 'function notFound() {\n  return 404;\n}\nfunction ok() {\n  return 200;\n}\n' > "$RETURN"

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
  ok "long file (>500 lines) fails"
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

# Digits inside a quoted string should NOT be flagged as a magic number
if bash "$SCRIPT" "$QUOTED" > /dev/null 2>&1; then
  ok "digits inside a quoted string are not a magic number"
else
  fail "quoted-string digits should not be flagged as a magic number"
fi

# quality-ok: magic-number pragma suppresses the violation on the next line
if bash "$SCRIPT" "$PRAGMA" > /dev/null 2>&1; then
  ok "quality-ok: magic-number pragma suppresses violation"
else
  fail "pragma-suppressed magic number should pass"
fi

# Test files are fully skipped — assertion literals are specs, not thresholds
if bash "$SCRIPT" "$TESTFILE" > /dev/null 2>&1; then
  ok "test file magic numbers are not flagged"
else
  fail "magic numbers in test files should not be flagged"
fi

# return/exit with a bare number should NOT be flagged — protocol-defined values
if bash "$SCRIPT" "$RETURN" > /dev/null 2>&1; then
  ok "return/exit values are not flagged as magic numbers"
else
  fail "return/exit values should not be flagged as magic numbers"
fi

echo ""
echo "$PASS passed, $FAIL failed."
[ $FAIL -eq 0 ]
