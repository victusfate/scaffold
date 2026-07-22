## Purpose

Turn the usage **statusLine** on (or off) without editing any config by hand —
model + context-window % + 5-hour usage % shown in every project. Opt-in and
global: it lives in your `~/.claude`, so run it once per machine. This skill just
drives `bin/install-statusline.sh`; it does not reimplement the install.

## Usage

- `/statusline` — enable it (the default).
- `/statusline off` — disable it (remove the `statusLine` key from
  `~/.claude/settings.json`; the script file is left in place).

## Steps

**Enable (default):**
1. Confirm `jq` is on PATH (`command -v jq`). If missing, tell the user to
   install it (`brew install jq` / `apt-get install jq`) and stop.
2. Run `bash bin/install-statusline.sh`. It copies `.claude/statusline.sh` into
   `~/.claude/`, and merges the `statusLine` key into `~/.claude/settings.json`
   **without clobbering** other keys (creating the file if absent).
3. Report the paths it wrote and note: **start a new Claude Code session** to see
   it (the statusLine is read at session start).

**Disable (`off`):**
1. If `~/.claude/settings.json` exists, remove just the key:
   `tmp=$(mktemp); jq 'del(.statusLine)' ~/.claude/settings.json > "$tmp" && mv "$tmp" ~/.claude/settings.json`
2. Report that it's off and that a new session will drop the statusLine. Leave
   `~/.claude/statusline.sh` in place (harmless; re-enable is instant).

## Notes

- Requires `jq` (used both by the installer's merge and by the statusLine script).
- Global by design (`~/.claude`) so it applies in every project; idempotent —
  safe to run again.
- On-demand alternatives that need no setup: `/context` and `/usage`.
