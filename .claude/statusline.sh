#!/usr/bin/env bash
# Claude Code statusLine — model, context-window %, and 5-hour rate-limit %.
# Reads the statusLine JSON payload on stdin; requires jq on PATH.
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "[statusline: jq not found]"; exit 0; }

input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name // "?"')
ctx=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
rate=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')

if [ -n "$rate" ]; then
  printf '[%s] %s%% ctx · 5h %.0f%%\n' "$model" "$ctx" "$rate"
else
  # 5h data is Pro/Max-only and only appears after the first API response
  printf '[%s] %s%% ctx · 5h —\n' "$model" "$ctx"
fi
