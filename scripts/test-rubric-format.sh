#!/usr/bin/env bash
set -euo pipefail

RUBRIC="lib/code-quality-rubric.md"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local pattern="$2"
  if grep -qE "$pattern" "$RUBRIC" 2>/dev/null; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "Rubric format check: $RUBRIC"

check "file exists"                      "."
check "persona preamble present"         "thoughtful senior engineer|joy to read|asks nothing unnecessary"
check "Quality dimension heading"        "^## 1\. Quality"
check "Readability dimension heading"    "^## 2\. Readability"
check "Encapsulation dimension heading"  "^## 3\. Encapsulation"
check "Clarity dimension heading"        "^## 4\. Clarity"
check "citation requirement stated"      "filename:line|cite.*line|citation"
check "score formula present"            "Score.*10|10.*violation|Σ"
check "weight declarations present"      "minor|major|critical"
check "common failure table present"     "^\| .* \| .* \| .*\|"
check "parameter count criterion"        "parameter|param"
check "reader load criterion"            "reader|cognitive|hold.*mind"
check "inline override section present"  "[Ii]nline override"
check "inline pragma comment form"       "//[[:space:]]*quality-override"
check "mechanical criteria not overridable inline" "overridden inline|inline.*cannot be overridden"
check "malformed pragma flagged as Clarity violation" "malformed pragma|malformed.*\[Clarity"

echo ""
echo "$PASS passed, $FAIL failed."
[ "$FAIL" -eq 0 ]
