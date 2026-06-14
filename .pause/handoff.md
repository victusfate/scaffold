# Pause handoff — read-once hook hardening

**When:** 2026-06-14
**Branch:** `fix/read-once-hardening` (off `main`)

## Goal

Harden the `read-once` Claude Code hook (synced from `victusfate/scaffold`)
against the correctness/robustness issues surfaced in a detailed code review.
Land here so it propagates downstream.

## Active artifacts

- `.claude/read-once/hook.sh` — **rewritten.** Main hook. All planned changes in.
- `.claude/read-once/compact.sh` — **patched.** jq guard + clears new `.saved`
  counter on compaction.
- `scripts/test-read-once.sh` — **extended.** 21 assertions, all passing.

No `docs/<slug>/` feature folder — treated as a hardening pass on existing
scripts, not a chain feature.

## Done this session

Implemented the review's recommended low-risk/high-value set in `hook.sh`:

- **jq guard** — `command -v jq || exit 0` (both hook.sh and compact.sh), so a
  missing jq under `set -euo pipefail` can't abort mid-hook and break Read.
- **Content-hash change detection** — replaced unreliable mtime compare with
  sha256 (`hash_file`). Cache entries now store `hash`+`size` instead of `mtime`.
  Fixes same-second edits, git-checkout/touch/clock-skew false signals.
- **TTL-aware diff branch** — the changed/diff path now checks `ENTRY_AGE < TTL`
  and falls through to a full re-read when the prior read aged out (was the
  silent-wrong-edit bug at old line 215).
- **Portable lock** — `flock` on Linux, `mkdir` spin-lock fallback on macOS
  (no flock here). Wraps cache/stats writes + the cleanup `tail>tmp&&mv` race.
- **Single jq parse** — one `jq @sh` + `eval` instead of 5 jq calls per read.
- **O(1) running savings counter** — `session-<hash>.saved` file; deny mode no
  longer re-scans all of stats.jsonl per hit. compact.sh resets it.
- **Doc/header honesty** — header now states warn mode saves NO tokens, documents
  snapshot-secrets-at-rest risk, and gives the `$CLAUDE_PROJECT_DIR` + existence-
  guard install line.

Tests added: #7 touch keeps hit (hash), #8 diff within TTL emits delta,
#9 diff with expired TTL falls through to full read.

## Verification

`bash scripts/test-read-once.sh` → **21 passed, 0 failed** (last run this session).

## Next steps

1. (optional) Re-run tests to confirm: `bash scripts/test-read-once.sh`
2. Commit is already made by /pause. Open the PR:
   `/create-pr` (creates PR + subscribes to activity atomically).
3. PR title suggestion: `fix(read-once): harden hook — content-hash, TTL-aware
   diff, jq guard, portable lock`.
4. After merge: `git checkout main && git pull origin main`.

## Open questions

- Review's item #7 ("is the juice worth the squeeze, given the harness already
  de-dupes reads and warn-default saves nothing?") — left for scaffold owner.
  Not addressed in code; worth a line in the PR description.
- Pre-Edit read detection (never block a likely pre-Edit read) — **not done**,
  deferred as a bigger design change.

## How to resume

`/resume` from any device (reads this file), or `claude -c` here for full
conversation history (richer, this machine only).
