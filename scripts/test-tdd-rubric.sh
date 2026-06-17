#!/usr/bin/env bash
set -euo pipefail
TDD="skills/tdd.md"
PASS=0; FAIL=0

check() {
  local desc="$1"; local pattern="$2"
  if grep -qE "$pattern" "$TDD" 2>/dev/null; then
    echo "  ✓ $desc"; PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"; FAIL=$((FAIL + 1))
  fi
}

echo "TDD rubric integration check: $TDD"
check "@-include of rubric present"           "@\.\./lib/code-quality-rubric"
check "rubric loaded before GREEN"            "rubric|quality.*before|generative"
check "REFACTOR as confirmation framing"      "confirm|confirmation|already"
check "per-slice score display"               "score.*slice|slice.*score|dimension.*score|Quality Scores"
check "auto-fix threshold stated"             "30 line|30-line|auto.fix"
check "surface threshold stated"              "surface|block.*arch|architectural"
echo ""; echo "$PASS passed, $FAIL failed."; [ "$FAIL" -eq 0 ]
