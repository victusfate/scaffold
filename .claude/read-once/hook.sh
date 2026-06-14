#!/usr/bin/env bash
# read-once: PreToolUse hook for Claude Code Read tool
# Prevents redundant file reads within a session by tracking what's been read.
# When a file is re-read and hasn't changed (same content hash), warns (or, in
# deny mode, blocks) the read since the content is already in context.
#
# Change detection uses a content hash (sha256), not mtime. mtime has 1-second
# granularity (two edits in the same second look unchanged) and lies under
# git checkout / touch / clock skew. Hash is the reliable signal.
#
# Diff mode (ON by default): When a file HAS changed since the last read,
# instead of allowing a full re-read, shows only what changed (the diff). Claude
# already has the old content in context — it just needs the delta. Saves 80-95%
# of tokens when iterating on files. Disable with READ_ONCE_DIFF=0.
#   NOTE: diff mode writes full file snapshots to ~/.claude/read-once/snapshots/.
#   That duplicates file content (including secrets) at rest outside the repo.
#   For repos with sensitive files, set READ_ONCE_DIFF=0 (and consider
#   READ_ONCE_MODE=warn), or scope where the hook runs.
#
# Compaction-aware: the PostCompact hook (compact.sh) clears this session's
# cache the moment context is compacted. As a backstop, cache entries also
# expire after READ_ONCE_TTL seconds (default 1200 = 20 minutes) — this applies
# to BOTH unchanged-file and diff branches, so a stale "apply this diff" is
# never sent against content that has aged out of context.
#
# Modes & savings (be honest about this):
#   deny (default) — blocks the re-read. Saves ~ESTIMATED_TOKENS, but can fight
#                    the Edit tool (Edit wants a fresh Read). Paired with diff
#                    mode below, a changed file returns only its delta.
#   warn           — allows the read with an advisory string. The full file
#                    still comes back, so warn saves NO tokens. It is a nudge
#                    that avoids the Edit deadlock + parallel-read cascades.
#   READ_ONCE_DIFF=1 (default) — sends only the delta on changed files. Real
#                    savings under deny; under warn it is advisory-only.
#
# Install (PreToolUse on Read). Use an absolute path via $CLAUDE_PROJECT_DIR and
# guard for the file's existence so a bare/relative path can't break Read:
#   "command": "f=\"$CLAUDE_PROJECT_DIR/.claude/read-once/hook.sh\"; [ -f \"$f\" ] && bash \"$f\" || exit 0"
#
# Config (env vars):
#   READ_ONCE_MODE=deny     "deny" (default) blocks the re-read, "warn" allows it with advisory.
#   READ_ONCE_TTL=1200      Seconds before a cached read expires (default: 1200)
#   READ_ONCE_DIFF=1        Show only diff when files change (default: 1; set 0 to disable)
#   READ_ONCE_DIFF_MAX=40   Max diff lines before falling back to full re-read (default: 40)
#   READ_ONCE_DISABLED=1    Disable the hook entirely

set -euo pipefail

# Allow disabling via env var
if [ "${READ_ONCE_DISABLED:-0}" = "1" ]; then
  exit 0
fi

# Hard dependency: jq. If it's missing, do nothing rather than letting
# set -e abort mid-hook and interfere with the Read.
command -v jq >/dev/null 2>&1 || exit 0

# Read hook input from stdin
INPUT=$(cat)

# Parse every field we need in a single jq pass (@sh = safe shell quoting).
PARSED=$(printf '%s' "$INPUT" | jq -r '
  "TOOL_NAME="  + (.tool_name            // "" | tostring | @sh),
  "FILE_PATH="  + (.tool_input.file_path // "" | tostring | @sh),
  "SESSION_ID=" + (.session_id           // "" | tostring | @sh),
  "OFFSET="     + (.tool_input.offset    // "" | tostring | @sh),
  "LIMIT="      + (.tool_input.limit     // "" | tostring | @sh)
' 2>/dev/null) || exit 0
eval "$PARSED"

# Only handle Read tool
if [ "${TOOL_NAME:-}" != "Read" ]; then
  exit 0
fi

if [ -z "${FILE_PATH:-}" ] || [ -z "${SESSION_ID:-}" ]; then
  exit 0
fi

# Partial reads (offset/limit) are never cached — user is exploring
# a large file piece by piece, each chunk is different content
if [ -n "${OFFSET:-}" ] || [ -n "${LIMIT:-}" ]; then
  exit 0
fi

# Session-scoped cache directory
CACHE_DIR="${HOME}/.claude/read-once"
mkdir -p "$CACHE_DIR"

# Mode: "deny" (default) blocks the re-read so savings are real; "warn" allows
# the read with only an advisory (saves nothing). deny can fight the Edit tool
# (Edit wants a fresh Read) — set READ_ONCE_MODE=warn if that deadlock bites.
MODE="${READ_ONCE_MODE:-deny}"

# Diff mode config — on by default. Pairs with deny so a changed file returns
# only its delta instead of the whole file. See the secrets-at-rest note above.
DIFF_MODE="${READ_ONCE_DIFF:-1}"
DIFF_MAX="${READ_ONCE_DIFF_MAX:-40}"

# Snapshot directory for diff mode
if [ "$DIFF_MODE" = "1" ]; then
  SNAP_DIR="${CACHE_DIR}/snapshots"
  mkdir -p "$SNAP_DIR"
fi

# TTL: how long a cached read stays valid before we allow re-reads.
# Backstop to the PostCompact hook — after this many seconds, assume Claude
# may have lost the content from its working context.
TTL="${READ_ONCE_TTL:-1200}"

NOW=$(date +%s)

# ── portable hashing ────────────────────────────────────────────────────────
# sha256sum (Linux) or shasum -a 256 (macOS); first 16 hex chars is plenty.
hash_str() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -c1-16
  else
    printf '%s' "$1" | shasum -a 256 | cut -c1-16
  fi
}
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -c1-16
  else
    shasum -a 256 "$1" 2>/dev/null | cut -c1-16
  fi
}

# ── portable advisory lock around cache writes ──────────────────────────────
# flock on Linux; mkdir spin-lock elsewhere (macOS has no flock). Best-effort:
# never block the Read forever — give up after a few seconds and proceed.
LOCKFILE="${CACHE_DIR}/.lock"
LOCKDIR="${CACHE_DIR}/.lock.d"
_have_flock=0
command -v flock >/dev/null 2>&1 && _have_flock=1
_locked=0
acquire_lock() {
  [ "$_locked" = "1" ] && return 0
  if [ "$_have_flock" = "1" ]; then
    exec 9>"$LOCKFILE" 2>/dev/null || { _locked=1; return 0; }
    flock -w 5 9 2>/dev/null || true
    _locked=1
  else
    local i=0
    while [ "$i" -lt 50 ]; do
      if mkdir "$LOCKDIR" 2>/dev/null; then _locked=1; return 0; fi
      sleep 0.1; i=$((i + 1))
    done
    # Presumed-stale lock — break it and proceed.
    rm -rf "$LOCKDIR" 2>/dev/null || true
    mkdir "$LOCKDIR" 2>/dev/null || true
    _locked=1
  fi
}
release_lock() {
  [ "$_locked" = "1" ] || return 0
  if [ "$_have_flock" = "1" ]; then
    exec 9>&- 2>/dev/null || true
  else
    rmdir "$LOCKDIR" 2>/dev/null || true
  fi
  _locked=0
}
trap release_lock EXIT

# Session cache file (one per session)
SESSION_HASH=$(hash_str "$SESSION_ID")
CACHE_FILE="${CACHE_DIR}/session-${SESSION_HASH}.jsonl"
STATS_FILE="${CACHE_DIR}/stats.jsonl"
SAVED_FILE="${CACHE_DIR}/session-${SESSION_HASH}.saved"

# O(1) running savings counter — avoids re-scanning stats.jsonl on every deny.
# Returns the new running total. Caller must already hold the lock.
add_saved() {
  local prev cur
  prev=$(cat "$SAVED_FILE" 2>/dev/null || echo 0)
  [[ "$prev" =~ ^[0-9]+$ ]] || prev=0
  cur=$(( prev + ${1:-0} ))
  echo "$cur" > "$SAVED_FILE"
  echo "$cur"
}

# Auto-cleanup: remove session caches older than 24h (runs at most once per hour)
CLEANUP_MARKER="${CACHE_DIR}/.last-cleanup"
LAST_CLEANUP=$(cat "$CLEANUP_MARKER" 2>/dev/null || echo 0)
# Tolerate corrupted marker — coerce non-numeric values to 0
if ! [[ "$LAST_CLEANUP" =~ ^[0-9]+$ ]]; then LAST_CLEANUP=0; fi

if [ $(( NOW - LAST_CLEANUP )) -gt 3600 ]; then
  acquire_lock
  find "$CACHE_DIR" -name 'session-*.jsonl' -mtime +1 -delete 2>/dev/null || true
  find "$CACHE_DIR" -name 'session-*.saved' -mtime +1 -delete 2>/dev/null || true
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
  release_lock
fi

# Snapshot path for this file (used in diff mode)
if [ "$DIFF_MODE" = "1" ]; then
  PATH_HASH=$(hash_str "$FILE_PATH")
  SNAP_FILE="${SNAP_DIR}/${SESSION_HASH}-${PATH_HASH}"
fi

# File must exist — otherwise let Read surface the error
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Content hash is the change signal; size drives the token estimate.
CURRENT_HASH=$(hash_file "$FILE_PATH")
if [ -z "$CURRENT_HASH" ]; then
  exit 0
fi

# Token estimation (~4 chars per token, line numbers add ~70%)
FILE_SIZE=$(wc -c < "$FILE_PATH" 2>/dev/null | tr -d ' ')
ESTIMATED_TOKENS=$(( (FILE_SIZE / 4) * 170 / 100 ))

# Check if we've seen this file before in this session.
# Use jq for safe lookup — handles paths containing quotes or other special chars.
CACHED_HASH=""
CACHED_TS=""
if [ -f "$CACHE_FILE" ]; then
  LAST_ENTRY=$(jq -c --arg p "$FILE_PATH" 'select(.path == $p)' "$CACHE_FILE" 2>/dev/null | tail -1 || echo "")
  if [ -n "$LAST_ENTRY" ]; then
    CACHED_HASH=$(echo "$LAST_ENTRY" | jq -r '.hash // empty' 2>/dev/null || echo "")
    CACHED_TS=$(echo "$LAST_ENTRY" | jq -r '.ts // empty' 2>/dev/null || echo "")
  fi
fi

# Record a read into the session cache (and snapshot in diff mode). Holds lock.
record_read() {
  acquire_lock
  jq -cn --arg path "$FILE_PATH" --arg hash "$CURRENT_HASH" \
    --argjson size "${FILE_SIZE:-0}" --argjson ts "$NOW" --argjson tokens "$ESTIMATED_TOKENS" \
    '{path:$path,hash:$hash,size:$size,ts:$ts,tokens:$tokens}' >> "$CACHE_FILE"
  if [ "$DIFF_MODE" = "1" ]; then
    cp "$FILE_PATH" "$SNAP_FILE"
  fi
}

if [ -n "$CACHED_HASH" ] && [ "$CACHED_HASH" = "$CURRENT_HASH" ]; then
  # File content unchanged since last read. But has the cache expired?
  ENTRY_AGE=0
  if [ -n "$CACHED_TS" ]; then
    ENTRY_AGE=$(( NOW - CACHED_TS ))
  fi

  if [ "$ENTRY_AGE" -ge "$TTL" ]; then
    # Cache expired — allow re-read (context may have compacted)
    record_read
    jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
      --argjson tokens "$ESTIMATED_TOKENS" --arg session "$SESSION_HASH" \
      '{ts:$ts,path:$path,tokens:$tokens,session:$session,event:"expired"}' >> "$STATS_FILE"
    exit 0
  fi

  # Cache hit — file unchanged and within TTL
  MINUTES_AGO=$(( ENTRY_AGE / 60 ))
  BASENAME=$(basename "$FILE_PATH")
  TTL_MIN=$(( TTL / 60 ))

  if [ "$MODE" = "deny" ]; then
    # Hard block — record tokens_saved and bump the O(1) running counter.
    acquire_lock
    jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
      --argjson tokens "$ESTIMATED_TOKENS" --arg session "$SESSION_HASH" \
      '{ts:$ts,path:$path,tokens_saved:$tokens,session:$session,event:"hit"}' >> "$STATS_FILE"
    SESSION_SAVED=$(add_saved "$ESTIMATED_TOKENS")

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
    acquire_lock
    jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
      --arg session "$SESSION_HASH" \
      '{ts:$ts,path:$path,session:$session,event:"hit"}' >> "$STATS_FILE"

    REASON="read-once: ${BASENAME} already in context (read ${MINUTES_AGO}m ago, unchanged). Re-read allowed after ${TTL_MIN}m."
    jq -cn --arg r "$REASON" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",permissionDecisionReason:$r}}'
  fi
  exit 0
fi

# Cache miss or file changed. Diff mode only fires when the prior read is still
# within TTL — otherwise the "old version" Claude holds may be gone, so a diff
# would be applied against stale content. Fall through to a full re-read instead.
if [ -n "$CACHED_HASH" ] && [ "$DIFF_MODE" = "1" ] && [ -f "$SNAP_FILE" ]; then
  ENTRY_AGE=0
  if [ -n "$CACHED_TS" ]; then
    ENTRY_AGE=$(( NOW - CACHED_TS ))
  fi

  if [ "$ENTRY_AGE" -lt "$TTL" ]; then
    # File changed + diff mode + fresh snapshot — show just the delta if small.
    DIFF_OUTPUT=$(diff -u "$SNAP_FILE" "$FILE_PATH" 2>/dev/null || true)
    DIFF_LINES=$(echo "$DIFF_OUTPUT" | wc -l | tr -d ' ')

    if [ -n "$DIFF_OUTPUT" ] && [ "$DIFF_LINES" -le "$DIFF_MAX" ]; then
      record_read

      DIFF_TOKENS=$(( DIFF_LINES * 10 ))
      TOKENS_SAVED=$(( ESTIMATED_TOKENS - DIFF_TOKENS ))
      if [ "$TOKENS_SAVED" -lt 0 ]; then TOKENS_SAVED=0; fi

      acquire_lock
      jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
        --argjson saved "$TOKENS_SAVED" --arg session "$SESSION_HASH" \
        '{ts:$ts,path:$path,tokens_saved:$saved,session:$session,event:"diff"}' >> "$STATS_FILE"
      add_saved "$TOKENS_SAVED" > /dev/null

      BASENAME=$(basename "$FILE_PATH")
      REASON=$(echo "$DIFF_OUTPUT" | python3 -c "
import sys
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
  # Prior read aged out of TTL — fall through to full re-read
fi

# Record the read (cache + snapshot)
record_read

# Log the event
if [ -n "$CACHED_HASH" ]; then
  EVENT="changed"
else
  EVENT="miss"
fi
acquire_lock
jq -cn --argjson ts "$NOW" --arg path "$FILE_PATH" \
  --argjson tokens "$ESTIMATED_TOKENS" --arg session "$SESSION_HASH" --arg event "$EVENT" \
  '{ts:$ts,path:$path,tokens:$tokens,session:$session,event:$event}' >> "$STATS_FILE"

# Allow the read
exit 0
