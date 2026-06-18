# Handoff — linter-setup feature

**Branch:** `claude/linter-setup`
**PR:** https://github.com/victusfate/scaffold/pull/48 (open, CI running)
**Date:** 2026-06-18

## What was built

Language-linter setup for scaffold consumer repos. When a consumer runs
`/sync-scaffold`, it now detects languages and suggests `/add-linter`. The
`/add-linter` skill prompts once per language and emits config + workflow files.

### Files added
- `tools/linter-setup/registry.mjs` — 9-language registry (JS, Python, Go, Rust, Ruby, Shell, Elixir, Zig, Mojo)
- `tools/linter-setup/detect.mjs` — git ls-files + extension map → `{ language, state }[]`
- `tools/linter-setup/emit.mjs` — clobber-safe file emission (written / sidecar / skipped)
- `tools/linter-setup/run` — CLI: `--detect-only` outputs JSON, full mode reads languages from stdin
- `tools/linter-setup/test` — 101 unit tests (registry, detection, emit)
- `tools/linter-setup/test-integration` — 33 integration scenarios
- `lib/linters/<lang>/` — config templates + workflows for all 9 languages
- `scripts/test-linter-setup.sh` — bash grep assertions (41 checks)
- `skills/add-linter.md` + all harness wrappers
- `.claude/skills/RESOLVER.md` — `add-linter` entry added

### Files modified
- `tools/sync/run.mjs` — linter hint appended after sync completes
- `package.json` — linter-setup tests wired into `npm test` and `npm run test:integration`
- `.github/scaffold-files.txt` — add-linter skill registered

## Test status
- `npm test`: all passing (101 unit + 41 bash + RESOLVER 19 skills)
- `npm run test:integration`: 33/33 passing
- CI on PR #48: running at pause time (verify in_progress, integration + mechanical queued)

## Next steps (for laptop session)
1. Wait for CI on PR #48 — if green, merge
2. Manual testing in a real consumer repo:
   - Run `/add-linter` in a repo with `.js` + `.py` files → confirm prompts + files written
   - Run with existing `eslint.config.mjs` (no scaffold marker) → confirm sidecar, original untouched
   - Run `/sync-scaffold` in a Go repo → confirm hint appears at end of output
3. If CI fails, the session is subscribed to PR #48 — check for webhook notifications

## State
Nothing in flight — branch is fully committed and pushed. Clean working tree.
