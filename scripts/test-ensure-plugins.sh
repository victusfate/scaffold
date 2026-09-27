#!/usr/bin/env bash
# Tests for bin/ensure-plugins.sh with a fake `claude` CLI on PATH (no network, no real install).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf -- "${WORK:?}"' EXIT
pass=0; fail=0
ok() { echo "  PASS: $1"; pass=$((pass + 1)); }
ng() { echo "  FAIL: $1"; fail=$((fail + 1)); }

mkdir -p "$WORK/bin" "$WORK/repo/.claude"
cat > "$WORK/bin/claude" <<'FAKE'
#!/usr/bin/env bash
state="${FAKE_CLAUDE_STATE:?}"
case "$1 $2" in
  "plugin list") cat "$state" 2>/dev/null ;;
  "plugin install") echo "  ❯ $3" >> "$state" ;;
esac
FAKE
chmod +x "$WORK/bin/claude"
cat > "$WORK/repo/.claude/settings.json" <<'JSON'
{ "enabledPlugins": { "modern-web-guidance@claude-plugins-official": true, "off@x": false } }
JSON
export FAKE_CLAUDE_STATE="$WORK/state"
cd "$WORK/repo"

# 1. --check reports the missing declared plugin and exits 2; disabled plugins are ignored.
set +e; out="$(PATH="$WORK/bin:$PATH" bash "$ROOT/bin/ensure-plugins.sh" --check)"; rc=$?; set -e
if [ "$rc" = 2 ] && grep -q "modern-web-guidance" <<<"$out" && ! grep -q "off@x" <<<"$out"; then
  ok "--check flags the missing enabled plugin only"; else ng "--check (rc=$rc): $out"; fi
# 2. default mode installs it.
out="$(PATH="$WORK/bin:$PATH" bash "$ROOT/bin/ensure-plugins.sh")"
if grep -q "installed modern-web-guidance@claude-plugins-official" <<<"$out"; then ok "installs missing plugin"; else ng "install: $out"; fi
# 3. idempotent: second run reports all installed.
out="$(PATH="$WORK/bin:$PATH" bash "$ROOT/bin/ensure-plugins.sh")"
if grep -q "all declared plugins installed" <<<"$out"; then ok "idempotent re-run"; else ng "re-run: $out"; fi
# 4. no claude CLI → prints the command, exits 0.
mkdir -p "$WORK/nodeonly"; ln -s "$(command -v node)" "$WORK/nodeonly/node"
set +e; out="$(PATH="$WORK/nodeonly:/usr/bin:/bin" bash "$ROOT/bin/ensure-plugins.sh")"; rc=$?; set -e
if [ "$rc" = 0 ] && grep -q "claude plugin install modern-web-guidance" <<<"$out"; then ok "no CLI → guidance, exit 0"; else ng "no CLI (rc=$rc): $out"; fi

echo "$pass passed, $fail failed."
[ "$fail" -eq 0 ]
