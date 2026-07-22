#!/usr/bin/env bash
# Opt-in: install the usage statusLine into your global Claude config (~/.claude),
# so model + context% + 5-hour usage% show in every project. Run once per machine.
# Idempotent — merges settings.json without clobbering existing keys. Requires jq.
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "error: jq is required (brew install jq / apt-get install jq)"; exit 1; }

repo=$(cd "$(dirname "$0")/.." && pwd)
src="$repo/.claude/statusline.sh"
[ -f "$src" ] || { echo "error: statusline script not found at $src"; exit 1; }

dest_dir="$HOME/.claude"
settings="$dest_dir/settings.json"
mkdir -p "$dest_dir"
cp "$src" "$dest_dir/statusline.sh"
chmod +x "$dest_dir/statusline.sh"

# Merge the statusLine key into ~/.claude/settings.json — create it if absent, and
# preserve every other key. The command is written as an absolute path.
tmp=$(mktemp)
base="{}"
[ -f "$settings" ] && base=$(cat "$settings")
printf '%s' "$base" | jq --arg cmd "$dest_dir/statusline.sh" \
  '.statusLine = {"type": "command", "command": $cmd}' > "$tmp"
mv "$tmp" "$settings"

echo "✓ Usage statusLine installed to $dest_dir/statusline.sh"
echo "  Enabled globally in $settings — model, context%, and 5h usage% show in every project."
echo "  Start a new Claude Code session to see it. Remove the statusLine key from that file to turn it off."
