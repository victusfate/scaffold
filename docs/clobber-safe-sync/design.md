# Design: clobber-safe sync + capability-source readiness

## Problem

`bin/sync-from-scaffold.sh` silently overwrites a target file on first sync
when no base SHA exists and the file already differs. A brand-new consumer
with a committed `CLAUDE.md` that runs `bootstrap.sh` loses it without warning.
`bootstrap.sh` compounds this by auto-running the full sync immediately.

## Canonical vocabulary

| Term | Meaning |
|---|---|
| **push model** | scaffold's own `sync-from-scaffold.sh` + `scaffold-files.txt` + `sync-scaffold.yml` path |
| **pull model** | victus-style: consumer curls allowlisted files at a pinned ref through its own clobber guard |
| **no-base overwrite** | the destructive branch: no `scaffold-sync-sha`, target exists and differs, file is silently replaced |
| **sidecar** | `<file>.scaffold-new` — the incoming version written for deliberate review instead of blind overwrite |
| **keep list** | `.scaffold-keep` — consumer-side file listing paths/globs scaffold must never write |
| **consumer-owned entry point** | `CLAUDE.md` — each consumer's personal wiring; scaffold must not push it |

## Decisions

### D1 — Keep `CLAUDE.md` in the manifest as a template starting point

scaffold is a GitHub template repo; new consumers need a `CLAUDE.md` to start
from. With C2's no-base sidecar in place, a consumer who has already customized
their `CLAUDE.md` won't have it silently overwritten on first sync — the sidecar
protects them. Consumers who want permanent protection can add `CLAUDE.md` to
`.scaffold-keep`.

### D2 — No silent first-sync overwrite

When no base SHA exists and target already exists and differs:
- Write incoming to `<file>.scaffold-new` (sidecar).
- Report under "Review (new upstream version saved alongside):".
- Only auto-write when the target is absent entirely.
- Exit code signals "review needed" (same exit 1 as conflicts).

### D3 — `.scaffold-keep` consumer ignore list

An optional `.scaffold-keep` at the repo root (one path or glob per line).
Any match is always skipped — even as a new file — and reported under
"Kept (consumer-owned):". Producer-side twin of victus's owned/guarded guard.
Comments (`#`) and blank lines are ignored.

### D4 — Non-destructive bootstrap

`bootstrap.sh` installs tooling (the sync script), then stops. Prints the
command to run the first sync manually. `--run` restores old auto-sync behavior.
Installing `.github/workflows/sync-scaffold.yml` is opt-in via `--with-workflow`.

### D5 — Release tagging (C4)

Start tagging meaningful changes (semver, e.g. `v1.0`). Consumers pin to a
tag instead of moving `main`. Document in README.

## Scenarios

**First sync, target exists and differs, no base**
- Before: target silently overwritten.
- After: sidecar written, target unchanged, exit 1, message prompts review.

**Path in `.scaffold-keep`**
- Before: no such mechanism.
- After: file always skipped regardless of new/existing, reported as "Kept".

**Three-way merge (base SHA present)**
- Unchanged. Existing behavior preserved.

**Bootstrap on a repo with a committed `CLAUDE.md`**
- Before: sync runs immediately, `CLAUDE.md` silently overwritten.
- After: bootstrap installs tooling, prints next-step command, `CLAUDE.md` untouched.
