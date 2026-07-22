#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

SL=.claude/statusline.sh
INSTALLER=bin/install-statusline.sh
SKILL=skills/statusline.md
MANIFEST=.github/scaffold-files.txt

for f in "$SL" "$INSTALLER" "$SKILL" .claude/skills/statusline/SKILL.md \
         .cursor/rules/statusline.mdc .agents/skills/statusline/SKILL.md \
         .agent/workflows/statusline.md; do
  [ -f "$f" ] && ok "$f exists" || fail "$f missing"
done
[ -x "$SL" ] && ok "statusline.sh is executable" || fail "statusline.sh not executable"
[ -x "$INSTALLER" ] && ok "installer is executable" || fail "installer not executable"

if ! command -v jq >/dev/null 2>&1; then
  echo "  (jq not on PATH — skipping behavior assertions)"
  echo ""; echo "$PASS passed, $FAIL failed."; [ $FAIL -eq 0 ]; exit $?
fi

# statusline.sh: with rate-limit data — truncates ctx, rounds 5h
out=$(echo '{"model":{"display_name":"Opus 4.8"},"context_window":{"used_percentage":42.7},"rate_limits":{"five_hour":{"used_percentage":13.6}}}' | bash "$SL")
echo "$out" | grep -q 'Opus 4.8' && ok "statusline shows the model" || fail "model missing: $out"
echo "$out" | grep -q '42% ctx'  && ok "statusline truncates context %" || fail "ctx wrong: $out"
echo "$out" | grep -q '5h 14%'   && ok "statusline rounds the 5h %" || fail "rate wrong: $out"

# statusline.sh: without rate-limit data — em-dash fallback
out2=$(echo '{"model":{"display_name":"Sonnet"},"context_window":{"used_percentage":5}}' | bash "$SL")
echo "$out2" | grep -q '5h —' && ok "statusline falls back to 5h — when no rate data" || fail "no dash: $out2"

# installer: merges into ~/.claude/settings.json without clobbering existing keys
TMPHOME=$(mktemp -d)
mkdir -p "$TMPHOME/.claude"
printf '{"existingKey":"keep-me"}' > "$TMPHOME/.claude/settings.json"
HOME="$TMPHOME" bash "$INSTALLER" >/dev/null
[ -x "$TMPHOME/.claude/statusline.sh" ] && ok "installer writes an executable ~/.claude/statusline.sh" || fail "installer script missing"
jq -e '.existingKey == "keep-me"' "$TMPHOME/.claude/settings.json" >/dev/null \
  && ok "installer preserves existing settings keys" || fail "installer clobbered existing keys"
jq -e '.statusLine.type == "command"' "$TMPHOME/.claude/settings.json" >/dev/null \
  && ok "installer adds the statusLine command key" || fail "installer did not add statusLine"

# installer: creates settings.json when absent
TMPHOME2=$(mktemp -d)
HOME="$TMPHOME2" bash "$INSTALLER" >/dev/null
jq -e '.statusLine' "$TMPHOME2/.claude/settings.json" >/dev/null \
  && ok "installer creates settings.json when absent" || fail "installer did not create settings.json"
rm -rf "$TMPHOME" "$TMPHOME2"

# Skill wiring: wrapper @-include, manifest, resolver
grep -q '@../../../skills/statusline.md' .claude/skills/statusline/SKILL.md \
  && ok "Claude wrapper @-includes skill body" || fail "Claude wrapper missing @-include"
for path in 'skills/statusline.md' '.claude/statusline.sh' 'bin/install-statusline.sh' '.claude/skills/statusline/SKILL.md'; do
  grep -qF "$path" "$MANIFEST" && ok "manifest lists $path" || fail "manifest missing $path"
done
grep -q '| statusline |' .claude/skills/RESOLVER.md \
  && ok "RESOLVER.md has statusline entry" || fail "RESOLVER.md missing statusline entry"

echo ""
echo "$PASS passed, $FAIL failed."
[ $FAIL -eq 0 ]
