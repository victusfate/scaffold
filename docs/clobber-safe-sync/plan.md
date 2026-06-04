# Plan: clobber-safe sync

Vertical slices — each cut through all affected layers.

## Slice 1 — C1: remove CLAUDE.md from manifest

Files: `.github/scaffold-files.txt`
- Remove the `CLAUDE.md` line.

Test: `grep -c '^CLAUDE\.md$' .github/scaffold-files.txt` returns 0.

## Slice 2 — C2a: no-base sidecar (first-sync safety)

Files: `bin/sync-from-scaffold.sh`
- Add `review=()` array alongside `updated`, `skipped`, `conflicts`.
- In the `else` branch (no base available): write to `${file}.scaffold-new`
  instead of overwriting; push to `review`.
- Add "Review (new upstream version saved alongside):" output block.
- Exit 1 when `${#review[@]} -gt 0` (same level as conflicts).

Test (manual/documented):
  Simulate: copy script to temp dir, create a differ target file with no SHA,
  run sync — target unchanged, sidecar exists.

## Slice 3 — C2b: `.scaffold-keep` ignore list

Files: `bin/sync-from-scaffold.sh`
- Add `kept=()` array.
- At top of `sync_file`, before all other checks: read `.scaffold-keep` if
  present, match `$file` against each non-comment non-blank line using bash
  glob (`[[ "$file" == $pattern ]]`). If match, push to `kept` and return 0.
- Add "Kept (consumer-owned):" output block.

Test (manual/documented):
  Create `.scaffold-keep` with `CLAUDE.md`, run sync — `CLAUDE.md` appears
  in "Kept", not "Updated" or sidecar.

## Slice 4 — C3: non-destructive bootstrap

Files: `bin/bootstrap.sh`
- Parse `--run` and `--with-workflow` flags.
- Make workflow install the default (preserves current behavior) but gated by
  `--with-workflow` only if user passes it; otherwise skip.
  Actually per brief: "opt-in", so default is NOT install workflow. Install
  sync script always; workflow only with `--with-workflow`.
- At the end: print next-step instructions. With `--run`, run the sync.

## Slice 5 — Section 5: doc updates

Files: `README.md`, `bin/bootstrap.sh` header, `bin/sync-from-scaffold.sh`
header, `skills/sync-scaffold.md` and all emitted forms.
- README: add "Syncing from scaffold" section covering new behaviors.
- Script headers: reflect new flags and behaviors.
- sync-scaffold skill: note bootstrap no longer auto-syncs; surface sidecar
  review step.

## Slice 6 — C4: tag + README pinning note

- After all slices: tag `v1.0` at this commit.
- README: add pinning instructions.
