#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

FILE=skills/code-quality-review.md

[ -f "$FILE" ] || { echo "MISSING: $FILE"; exit 1; }

grep -q '@../lib/code-quality-rubric.md' "$FILE" \
  && ok "@-includes shared rubric" || fail "missing @-include of rubric"

grep -q 'Quality Scores' "$FILE" \
  && ok "score table heading present" || fail "missing 'Quality Scores' heading"

grep -q 'quality-override' "$FILE" \
  && ok "override syntax referenced" || fail "missing override syntax"

grep -qE 'inline override|preceding line|// quality-override|suppress' "$FILE" \
  && ok "inline pragma awareness described" || fail "inline pragma awareness not described"

grep -q '10/10\|score.*10\|10 on all\|all.*10' "$FILE" \
  && ok "10/10 gate threshold stated" || fail "missing 10/10 gate threshold"

grep -qE 'auto.?fix|auto fix' "$FILE" \
  && ok "auto-fix mode described" || fail "missing auto-fix mode"

echo ""
echo "$PASS passed, $FAIL failed."
[ $FAIL -eq 0 ]
