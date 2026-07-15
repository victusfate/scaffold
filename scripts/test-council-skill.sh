#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

SKILL=skills/council.md
CLAUDE_WRAPPER=.claude/skills/council/SKILL.md
CURSOR_MIRROR=.cursor/rules/council.mdc
ANTIGRAVITY_SKILL=.agents/skills/council/SKILL.md
ANTIGRAVITY_WORKFLOW=.agent/workflows/council.md
MANIFEST=.github/scaffold-files.txt

for f in "$SKILL" "$CLAUDE_WRAPPER" "$CURSOR_MIRROR" "$ANTIGRAVITY_SKILL" "$ANTIGRAVITY_WORKFLOW"; do
  [ -f "$f" ] && ok "$f exists" || fail "$f missing"
done

# The five advisor personas must all be present
for persona in Contrarian 'First-Principles' Expansionist Outsider Executor; do
  grep -q "$persona" "$SKILL" \
    && ok "advisor persona present: $persona" || fail "advisor persona missing: $persona"
done

# Core mechanics
grep -qiE 'parallel|concurrent' "$SKILL" \
  && ok "advisors run in parallel" || fail "parallel advisor execution not described"

grep -qiE 'peer review|anonymize|anonymized' "$SKILL" \
  && ok "anonymized peer review described" || fail "peer review round not described"

grep -qi 'chairman' "$SKILL" \
  && ok "chairman synthesis described" || fail "chairman synthesis not described"

grep -qiE 'isolated subagent|isolated context' "$SKILL" \
  && ok "isolated-subagent execution described" || fail "isolated-subagent model not described"

# Chairman output structure
grep -qi 'Where the council agrees' "$SKILL" \
  && ok "output: agreements section" || fail "output missing agreements section"
grep -qi 'Where the council clashes' "$SKILL" \
  && ok "output: clashes section" || fail "output missing clashes section"
grep -qiE 'one thing to do first|do first' "$SKILL" \
  && ok "output: concrete next step" || fail "output missing concrete next step"

# When NOT to use guard (avoid ceremony on factual/low-stakes)
grep -qiE 'not use|do not use|factual|low.?stakes' "$SKILL" \
  && ok "when-not-to-use guard present" || fail "when-not-to-use guard missing"

# Wrapper + manifest + resolver wiring
grep -q '@../../../skills/council.md' "$CLAUDE_WRAPPER" \
  && ok "Claude wrapper @-includes skill body" || fail "Claude wrapper missing @-include"

for path in 'skills/council.md' '.claude/skills/council/SKILL.md' '.cursor/rules/council.mdc' '.agents/skills/council/SKILL.md' '.agent/workflows/council.md'; do
  grep -qF "$path" "$MANIFEST" \
    && ok "manifest lists $path" || fail "manifest missing $path"
done

grep -q '| council |' .claude/skills/RESOLVER.md \
  && ok "RESOLVER.md has council entry" || fail "RESOLVER.md missing council entry"

echo ""
echo "$PASS passed, $FAIL failed."
[ $FAIL -eq 0 ]
