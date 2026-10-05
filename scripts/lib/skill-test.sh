#!/usr/bin/env bash
# skill-test.sh — shared assertions for prompt-skill acceptance tests.
# Source it from a scripts/test-<name>-skill.sh, call the helpers, then `finish`.
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

# has <file> <extended-regex> <label> — case-insensitive grep assertion.
has() { grep -qiE "$2" "$1" && ok "$3" || fail "$3"; }

# assert_registered <name> — canonical body, four harness wrappers that include it,
# sync-manifest entries, and a RESOLVER row.
assert_registered() {
  local n=$1 path
  for path in "skills/$n.md" ".claude/skills/$n/SKILL.md" ".cursor/rules/$n.mdc" \
              ".agents/skills/$n/SKILL.md" ".agent/workflows/$n.md"; do
    [ -f "$path" ] && ok "$path exists" || fail "$path missing"
    grep -qxF "$path" .github/scaffold-files.txt \
      && ok "manifest lists $path" || fail "manifest missing $path"
  done
  grep -qF "@../../../skills/$n.md" ".claude/skills/$n/SKILL.md" 2>/dev/null \
    && ok "Claude wrapper @-includes skill body" || fail "Claude wrapper missing @-include"
  grep -qF "@../../skills/$n.md" ".cursor/rules/$n.mdc" 2>/dev/null \
    && ok "Cursor rule @-includes skill body" || fail "Cursor rule missing @-include"
  grep -qF "skills/$n.md" ".agents/skills/$n/SKILL.md" 2>/dev/null \
    && ok "agents wrapper links skill body" || fail "agents wrapper missing link"
  grep -qF "| $n |" .claude/skills/RESOLVER.md \
    && ok "RESOLVER.md has $n entry" || fail "RESOLVER.md missing $n entry"
}

finish() { echo ""; echo "$PASS passed, $FAIL failed."; [ "$FAIL" -eq 0 ]; }
