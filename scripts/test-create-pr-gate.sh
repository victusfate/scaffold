#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

FILE=skills/create-pr.md

[ -f "$FILE" ] || { echo "MISSING: $FILE"; exit 1; }

grep -q 'quality' "$FILE" \
  && ok "quality gate mentioned" || fail "no quality gate mention"

grep -qE 'Quality Scores|quality.*score|score.*table' "$FILE" \
  && ok "score table referenced" || fail "score table not referenced"

grep -qE '10/10|score.*10|all.*10|10 on all' "$FILE" \
  && ok "10/10 threshold stated" || fail "10/10 threshold not stated"

grep -qE 'quality.override|override' "$FILE" \
  && ok "override mechanism referenced" || fail "override mechanism not referenced"

# Gate (Step 5) must appear before Step 6 (PR body drafting)
gate_line=$(grep -n 'Step 5' "$FILE" | head -1 | cut -d: -f1)
step6_line=$(grep -n 'Step 6' "$FILE" | head -1 | cut -d: -f1)
if [ -n "$gate_line" ] && [ -n "$step6_line" ] && [ "$gate_line" -lt "$step6_line" ]; then
  ok "quality gate (Step 5) appears before PR body drafting (Step 6)"
else
  fail "quality gate must appear before PR body drafting"
fi

echo ""
echo "$PASS passed, $FAIL failed."
[ $FAIL -eq 0 ]
