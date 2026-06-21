#!/usr/bin/env bash
# read-once: PostCompact hook — clears session cache after context compaction.
# When Claude compacts the conversation, it loses file contents from context.
# This hook resets the read-once cache so those files can be re-read immediately,
# replacing the TTL-based workaround (which could be up to 20 minutes late).
#
# Install: Add to .claude/settings.json hooks.PostCompact
# See also: hook.sh (the PreToolUse hook that tracks reads)

set -euo pipefail

# Hard dependency: jq. Missing → do nothing rather than abort under set -e.
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

CACHE_DIR="${HOME}/.claude/read-once"
HASH_PREFIX_LEN=16  # hex chars kept from sha256; must match hook.sh
SHASUM_ALGO=256     # algorithm flag for shasum on macOS (-a 256 = sha256)

# Must hash session_id the same way hook.sh does
if command -v sha256sum >/dev/null 2>&1; then
  SESSION_HASH=$(echo -n "$SESSION_ID" | sha256sum | cut -c1-${HASH_PREFIX_LEN})
else
  SESSION_HASH=$(echo -n "$SESSION_ID" | shasum -a "$SHASUM_ALGO" | cut -c1-${HASH_PREFIX_LEN})
fi

CACHE_FILE="${CACHE_DIR}/session-${SESSION_HASH}.jsonl"
SAVED_FILE="${CACHE_DIR}/session-${SESSION_HASH}.saved"
STATS_FILE="${CACHE_DIR}/stats.jsonl"

# Count entries being cleared (for stats)
CLEARED=0
if [ -f "$CACHE_FILE" ]; then
  CLEARED=$(wc -l < "$CACHE_FILE" | tr -d ' ')
  rm -f "$CACHE_FILE"
fi

# Reset the running savings counter for this session
rm -f "$SAVED_FILE"

# Clear snapshots for this session (diff mode)
if [ -d "${CACHE_DIR}/snapshots" ]; then
  find "${CACHE_DIR}/snapshots" -name "${SESSION_HASH}-*" -delete 2>/dev/null || true
fi

# Log the compaction event
NOW=$(date +%s)
if [ "$CLEARED" -gt 0 ]; then
  echo "{\"ts\":${NOW},\"session\":\"${SESSION_HASH}\",\"event\":\"compact\",\"cleared\":${CLEARED}}" >> "$STATS_FILE"
fi

exit 0
