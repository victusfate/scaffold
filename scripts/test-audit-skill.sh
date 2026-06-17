#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

SKILL=skills/audit.md
CLAUDE_WRAPPER=.claude/skills/audit/SKILL.md
CURSOR_MIRROR=.cursor/rules/audit.mdc
ANTIGRAVITY_SKILL=.agents/skills/audit/SKILL.md
ANTIGRAVITY_WORKFLOW=.agent/workflows/audit.md
MANIFEST=.github/scaffold-files.txt

for f in "$SKILL" "$CLAUDE_WRAPPER" "$CURSOR_MIRROR" "$ANTIGRAVITY_SKILL" "$ANTIGRAVITY_WORKFLOW"; do
  [ -f "$f" ] && ok "$f exists" || fail "$f missing"
done

grep -q '@../lib/code-quality-rubric.md' "$SKILL" \
  && ok "audit.md @-includes shared rubric" || fail "audit.md must @-include lib/code-quality-rubric.md"

grep -qE 'rank|worst|score' "$SKILL" \
  && ok "ranked output described" || fail "ranked output format not described"

grep -qE '\-\-fix|--fix' "$SKILL" \
  && ok "--fix flag described" || fail "--fix flag not described"

grep -q 'quality-override' "$SKILL" \
  && ok "inline override pragma referenced" || fail "inline override pragma not referenced"

grep -qE 'preceding line|line above|accepted override|suppress' "$SKILL" \
  && ok "preceding-line suppression described" || fail "preceding-line suppression not described"

grep -q '@../../../skills/audit.md' "$CLAUDE_WRAPPER" \
  && ok "Claude wrapper @-includes skill body" || fail "Claude wrapper missing @-include"

grep -q 'audit' "$CLAUDE_WRAPPER" \
  && ok "Claude wrapper references audit" || fail "Claude wrapper does not reference audit"

grep -q 'skills/audit.md' "$MANIFEST" \
  && ok "skills/audit.md in scaffold manifest" || fail "skills/audit.md not in scaffold manifest"

grep -q '.claude/skills/audit/SKILL.md' "$MANIFEST" \
  && ok "Claude wrapper in scaffold manifest" || fail "Claude wrapper not in scaffold manifest"

grep -q '.cursor/rules/audit.mdc' "$MANIFEST" \
  && ok "Cursor mirror in scaffold manifest" || fail "Cursor mirror not in scaffold manifest"

# RESOLVER entry
grep -q 'audit' .claude/skills/RESOLVER.md \
  && ok "RESOLVER.md has audit entry" || fail "RESOLVER.md missing audit entry"

echo ""
echo "$PASS passed, $FAIL failed."
[ $FAIL -eq 0 ]
