#!/usr/bin/env bash
# ensure-plugins.sh — install every Claude Code plugin this repo DECLARES but hasn't installed.
#
# WHY: scaffold's .claude/settings.json declares plugins in `enabledPlugins` (e.g.
# modern-web-guidance@claude-plugins-official). Declaring is not installing: Claude Code only
# offers the install when a repo is first trusted, so a plugin that arrives later via
# sync-from-scaffold.sh stays "enabled" but missing — /reload-plugins then reports a load error
# and the plugin's skill never appears. This closes that gap; sync-from-scaffold.sh runs it.
#
#   bash bin/ensure-plugins.sh            # install missing declared plugins (project scope)
#   bash bin/ensure-plugins.sh --check    # report only; exit 2 if any are missing
#
# Non-fatal by design: without the `claude` CLI (Codex/Cursor/pi-only machines) or node, it
# prints what to do and exits 0. After an install, run /reload-plugins in any open session.
set -u
CHECK=0; [ "${1:-}" = --check ] && CHECK=1
SETTINGS="${ENSURE_PLUGINS_SETTINGS:-.claude/settings.json}"
[ -f "$SETTINGS" ] || exit 0
command -v node >/dev/null 2>&1 || { echo "ensure-plugins: node not found; skipping plugin check"; exit 0; }
declared="$(node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const [id, on] of Object.entries(s.enabledPlugins || {})) if (on) console.log(id);
' "$SETTINGS")"
[ -n "$declared" ] || exit 0
if ! command -v claude >/dev/null 2>&1; then
	echo "ensure-plugins: Claude Code CLI not found. To use the declared plugins in Claude Code, run:"
	while read -r p; do echo "  claude plugin install $p --scope project"; done <<<"$declared"
	exit 0
fi
installed="$(claude plugin list 2>/dev/null)"
missing=()
while read -r p; do
	grep -qF "$p" <<<"$installed" || missing+=("$p")
done <<<"$declared"
[ ${#missing[@]} -eq 0 ] && { echo "ensure-plugins: all declared plugins installed"; exit 0; }
if [ "$CHECK" = 1 ]; then
	echo "ensure-plugins: declared but not installed:"; printf '  %s\n' "${missing[@]}"
	exit 2
fi
for p in "${missing[@]}"; do
	if claude plugin install "$p" --scope project >/dev/null 2>&1; then
		echo "ensure-plugins: installed $p (project scope)"
	else
		echo "ensure-plugins: could not install $p — run: claude plugin install $p --scope project"
	fi
done
echo "ensure-plugins: run /reload-plugins in any open Claude Code session to load them."
exit 0
