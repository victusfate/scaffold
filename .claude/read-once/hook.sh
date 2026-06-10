#!/usr/bin/env bash
# read-once: PreToolUse hook for Claude Code Read tool
# Prevents redundant file reads within a session by tracking what's been read.
# When a file is re-read and hasn't changed (same mtime), blocks the read
# and tells Claude the content is already in context.
#
# Diff mode: When a file HAS changed since the last read, instead of allowing
# a full re-read, shows only what changed (the diff). Claude already has the
# old content in context — it just needs the delta. Saves 80-95% of tokens
# when iterating on files. Enable with READ_ONCE_DIFF=1.
#
# Compaction-aware: cache entries expire after READ_ONCE_TTL seconds
# (default 1200 = 20 minutes). After expiry, re-reads are allowed because
# Claude may have compacted the context and lost the earlier content.
#
# Install: Add to .claude/settings.json hooks.PreToolUse
# Savings: ~2000+ tokens per prevented re-read
#
# Config (env vars):
#   READ_ONCE_MODE=warn     "warn" (default) allows read with advisory, "deny" blocks it.
#                           warn mode prevents Edit deadlock and parallel read cascade failures.
#   READ_ONCE_TTL=1200      Seconds before a cached read expires (default: 1200)
#   READ_ONCE_DIFF=1        Show only diff when files change (default: 0)
#   READ_ONCE_DIFF_MAX=40   Max diff lines before falling back to full re-read (default: 40)
#   READ_ONCE_DISABLED=1    Disable the hook entirely

set -euo pipefail

# Allow disabling via env var
if [ "${READ_ONCE_DISABLED:-0}" = "1" ]; then
  exit 0
fi

# Read hook input from stdin
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only handle Read tool
if [ "$TOOL_NAME" != "Read" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
OFFSET=$(echo "$INPUT" | jq -r '.tool_input.offset // empty')
LIMIT=$(echo "$INPUT" | jq -r '.tool_input.limit // empty')

if [ -z "$FILE_PATH" ] || [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Partial reads (offset/limit) are never cached — user is exploring
# a large file piece by piece, each chunk is different content
if [ -n "$OFFSET" ] || [ -n "$LIMIT" ]; then
  exit 0
fi

# Session-scoped cache directory
CACHE_DIR="${HOME}/.claude/read-once"
mkdir -p "$CACHE_DIR"

# Mode: "warn" (default) allows read with advisory message, "deny" blocks it.
# warn mode fixes: Edit tool deadlock, parallel read cascade failures.
MODE="${READ_ONCE_MODE:-warn}"

# Diff mode config
DIFF_MODE="${READ_ONCE_DIFF:-0}"
DIFF_MAX="${READ_ONCE_DIFF_MAX:-40}"

# Snapshot directory for diff mode
if [ "$DIFF_MODE" = "1" ]; then
  SNAP_DIR="${CACHE_DIR}/snapshots"
  mkdir -p "$SNAP_DIR"
fi

# TTL: how long a cached read stays valid before we allow re-reads.
# Accounts for context compaction — after this many seconds, Claude
# may have lost the content from its working context.
TTL="${READ_ONCE_TTL:-1200}"

NOW=$(date +%s)

# Auto-cleanup: remove session caches older than 24h (runs at most once per hour)
CLEANUP_MARKER="${CACHE_DIR}/.last-cleanup"
LAST_CLEANUP=$(cat "$CLEANUP_MARKER" 2>/dev/null || echo 0)
# Tolerate corrupted marker — coerce non-numeric values to 0
if ! [[ "$LAST_CLEANUP" =~ ^[0-9]+$ ]]; then LAST_CLEANUP=0; fi

if [ $(( NOW - LAST_CLEANUP )) -gt 3600 ]; then
  find "$CACHE_DIR" -name 'session-*.jsonl' -mtime +1 -delete 2>/dev/null || true
  find "${CACHE_DIR}/snapshots" -type f -mtime +1 -delete 2>/dev/null || true
  # Keep stats.jsonl bounded: prune to 4999 lines so one more write stays ≤5000
  _stats="${CACHE_DIR}/stats.jsonl"
  if [ -f "$_stats" ]; then
    _lines=$(wc -l < "$_stats" | tr -d ' ')
    if [ "${_lines:-0}" -gt 5000 ]; then
      tail -n 4999 "$_stats" > "${_stats}.tmp" && mv "${_stats}.tmp" "$_stats" || rm -f "${_stats}.tmp"
    fi
  fi
  echo "$NOW" > "$CLEANUP_MARKER"
fi

# Session cache file (one per session)
# Portable hash: sha256sum (Linux) or shasum (macOS)
if command -v sha256sum >/dev/null 2>&1; then
  SESSION_HASH=$(echo -n "$SESSION_ID" | sha256sum | cut -c1-16)
else
  SESSION_HASH=$(echo -n "$SESSION_ID" | shasum -a 256 | cut -c1-16)
fi
CACHE_FILE="${CACHE_DIR}/session-${SESSION_HASH}.jsonl"
STATS_FILE="${CACHE_DIR}/stats.jsonl"

# Snapshot path for this file (used in diff mode)
if [ "$DIFF_MODE" = "1" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    PATH_HASH=$(echo -n "$FILE_PATH" | sha256sum | cut -c1-16)
  else
    PATH_HASH=$(echo -n "$FILE_PATH" | shasum -a 256 | cut -c1-16)
  fi
  SNAP_FILE="${SNAP_DIR}/${SESSION_HASH}-${PATH_HASH}"
fi

# Get current file mtime (portable macOS/Linux)
if [ ! -f "$FILE_PATH" ]; then
  # File doesn't exist — let Read handle the error
  exit 0
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
  CURRENT_MTIME=$(stat -f '%m' "$FILE_PATH" 2>/dev/null || echo "")
else
  CURRENT_MTIME=$(stat -c '%Y' "$FILE_PATH" 2>/dev/null || echo "")
fi

if [ -z "$CURRENT_MTIME" ]; then
  exit 0
fi

# Get file size for token estimation (~4 chars per token, line numbers add ~70%)
FILE_SIZE=$(wc -c < "$FILE_PATH" 2>/dev/null | tr -d ' ')
ESTIMATED_TOKENS=$(( (FILE_SIZE / 4) * 170 / 100 ))

# Check if we've seen this file before in this session.
# Use jq for safe lookup — handles paths containing quotes or other special chars.
CACHED_MTIME=""
CACHED_TS=""
if [ -f "$CACHE_FILE" ]; then
  LAST_ENTRY=$(jq -c --arg p "$FILE_PATH" 'select(.path == $p)' "$CACHE_FILE" 2>/dev/null | tail -1 || echo "")
  if [ -n "$LAST_ENTRY" ]; then
    CACHED_MTIME=$(echo "$LAST_ENTRY" | jq -r '.mtime // empty' 2>/dev/null || echo "")
    CACHED_TS=$(echo "$LAST_ENTRY" | jq -r '.ts // empty' 2>/dev/null || echo "")
  fi
fi

if [ -n "$CACHED_MTIME" ] && [ "$CACHED_MTIME" = "$CURRENT_MTIME" ]; then
  # File hasn't changed since last read. But has the cache expired?
  ENTRY_AGE=0
  if [ -n "$CACHED_TS" ]; then
    ENTRY_AGE=$(( NOW - CACHED_TS ))
  fi

  if [ "$ENTRY_AGE" -ge "$TTL" ]; then
    # Cache expired — allow re-read (context may have compacted)
    jq -cn --arg path "$FILE_PATH" --arg mtime "$CURRENT_MTIME" \
      --argjson ts "$NOW" --argjson tokens "$ESTIMATED_TOKENS" \
      '{path:$path,mtime:$mtime,ts:$ts,tokens:$tokens}' >> "$CACHE_FILE"
    jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
      --argjson tokens "$ESTIMATED_TOKENS" --arg session "$SESSION_HASH" \
      '{ts:$ts,path:$path,tokens:$tokens,session:$session,event:"expired"}' >> "$STATS_FILE"
    if [ "$DIFF_MODE" = "1" ]; then
      cp "$FILE_PATH" "$SNAP_FILE"
    fi
    exit 0
  fi

  # Cache hit — file unchanged and within TTL
  MINUTES_AGO=$(( ENTRY_AGE / 60 ))
  BASENAME=$(basename "$FILE_PATH")
  TTL_MIN=$(( TTL / 60 ))

  if [ "$MODE" = "deny" ]; then
    # Hard block — record tokens_saved for savings accounting
    jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
      --argjson tokens "$ESTIMATED_TOKENS" --arg session "$SESSION_HASH" \
      '{ts:$ts,path:$path,tokens_saved:$tokens,session:$session,event:"hit"}' >> "$STATS_FILE"

    SESSION_SAVED=$(jq -r --arg s "$SESSION_HASH" \
      'select(.session==$s and .event=="hit" and .tokens_saved != null) | .tokens_saved' \
      "$STATS_FILE" 2>/dev/null | paste -sd+ - | bc 2>/dev/null || echo "$ESTIMATED_TOKENS")

    # Cost estimate (Sonnet $3/MTok)
    COST_INFO=""
    if command -v python3 &>/dev/null && [ "${SESSION_SAVED:-0}" -gt 0 ]; then
      COST_INFO=$(echo "$SESSION_SAVED" | python3 -c "import sys; t=int(sys.stdin.read().strip()); print(' (~\$%.4f saved at Sonnet rates)' % (t*3/1000000))" 2>/dev/null || echo "")
    fi

    REASON="read-once: ${BASENAME} (~${ESTIMATED_TOKENS} tokens) already in context (read ${MINUTES_AGO}m ago, unchanged). Re-read allowed after ${TTL_MIN}m. Session savings: ~${SESSION_SAVED} tokens${COST_INFO}."
    jq -cn --arg r "$REASON" '{"decision":"block","reason":$r}'
  else
    # Warn mode (default) — allow read with advisory, no savings claims.
    # Prevents Edit tool deadlock and parallel read cascade failures.
    jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
      --arg session "$SESSION_HASH" \
      '{ts:$ts,path:$path,session:$session,event:"hit"}' >> "$STATS_FILE"

    REASON="read-once: ${BASENAME} already in context (read ${MINUTES_AGO}m ago, unchanged). Re-read allowed after ${TTL_MIN}m."
    jq -cn --arg r "$REASON" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",permissionDecisionReason:$r}}'
  fi
  exit 0
fi

# Cache miss or file changed
if [ -n "$CACHED_MTIME" ] && [ "$DIFF_MODE" = "1" ] && [ -f "$SNAP_FILE" ]; then
  # File changed + diff mode enabled + we have a snapshot
  # Compute diff and deny with just the changes if small enough
  DIFF_OUTPUT=$(diff -u "$SNAP_FILE" "$FILE_PATH" 2>/dev/null || true)
  DIFF_LINES=$(echo "$DIFF_OUTPUT" | wc -l | tr -d ' ')

  if [ -n "$DIFF_OUTPUT" ] && [ "$DIFF_LINES" -le "$DIFF_MAX" ]; then
    # Diff is small enough — deny with diff in the reason
    jq -cn --arg path "$FILE_PATH" --arg mtime "$CURRENT_MTIME" \
      --argjson ts "$NOW" --argjson tokens "$ESTIMATED_TOKENS" \
      '{path:$path,mtime:$mtime,ts:$ts,tokens:$tokens}' >> "$CACHE_FILE"
    cp "$FILE_PATH" "$SNAP_FILE"

    DIFF_TOKENS=$(( DIFF_LINES * 10 ))
    TOKENS_SAVED=$(( ESTIMATED_TOKENS - DIFF_TOKENS ))
    if [ "$TOKENS_SAVED" -lt 0 ]; then TOKENS_SAVED=0; fi

    jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
      --argjson saved "$TOKENS_SAVED" --arg session "$SESSION_HASH" \
      '{ts:$ts,path:$path,tokens_saved:$saved,session:$session,event:"diff"}' >> "$STATS_FILE"

    BASENAME=$(basename "$FILE_PATH")
    REASON=$(echo "$DIFF_OUTPUT" | python3 -c "
import sys, json
diff = sys.stdin.read()
basename = '${BASENAME}'
tokens_saved = ${TOKENS_SAVED}
reason = (f'read-once: {basename} changed since last read. You already have the previous version in context. '
          f'Here are only the changes (saving ~{tokens_saved} tokens):\n\n' + diff +
          '\n\nApply this diff mentally to your cached version of the file.')
print(reason)
" 2>/dev/null)

    if [ -n "$REASON" ]; then
      if [ "$MODE" = "deny" ]; then
        jq -cn --arg r "$REASON" '{"decision":"block","reason":$r}'
      else
        jq -cn --arg r "$REASON" \
          '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",permissionDecisionReason:$r}}'
      fi
      exit 0
    fi
    # Python failed — fall through to full re-read
  fi
  # Diff too large or Python failed — fall through to full re-read
fi

# Record the read
jq -cn --arg path "$FILE_PATH" --arg mtime "$CURRENT_MTIME" \
  --argjson ts "$NOW" --argjson tokens "$ESTIMATED_TOKENS" \
  '{path:$path,mtime:$mtime,ts:$ts,tokens:$tokens}' >> "$CACHE_FILE"

# Save snapshot for future diffs
if [ "$DIFF_MODE" = "1" ]; then
  cp "$FILE_PATH" "$SNAP_FILE"
fi

# Log the event
if [ -n "$CACHED_MTIME" ]; then
  EVENT="changed"
else
  EVENT="miss"
fi
jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
  --argjson tokens "$ESTIMATED_TOKENS" --arg session "$SESSION_HASH" --arg event "$EVENT" \
  '{ts:$ts,path:$path,tokens:$tokens,session:$session,event:$event}' >> "$STATS_FILE"

# Allow the read
exit 0
