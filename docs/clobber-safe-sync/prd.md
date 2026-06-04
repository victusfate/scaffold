# PRD: clobber-safe sync + capability-source readiness

## Goal

Make `sync-from-scaffold.sh` and `bootstrap.sh` safe for push-based consumers
to run without risk of silent data loss, while keeping the push model fully
functional.

## Changes

### C1 — Remove `CLAUDE.md` from manifest

File: `.github/scaffold-files.txt`
Remove the `CLAUDE.md` line. No other changes to the manifest.

Acceptance: `CLAUDE.md` absent from manifest; syncing into a repo with a
custom `CLAUDE.md` leaves it untouched.

### C2 — Clobber-safe sync

File: `bin/sync-from-scaffold.sh`

1. **No-base sidecar.** When `scaffold-sync-sha` is absent and the target
   file exists and differs, write the incoming version to `<file>.scaffold-new`.
   Report under "Review (new upstream version saved alongside):". Exit 1.
   Only auto-write when the target is absent.

2. **`.scaffold-keep` ignore list.** Before any other checks in `sync_file`,
   read `.scaffold-keep` (if present). One path or glob per line; `#` and
   blank lines ignored. A matching path is skipped unconditionally and reported
   under "Kept (consumer-owned):".

3. All existing behaviors (new-file write, identical skip, uncommitted-edit
   skip, three-way merge) are preserved unchanged.

Acceptance:
- First sync, target exists and differs, no base: target unchanged, sidecar
  created, exit 1.
- Path in `.scaffold-keep`: never written, even as new file.
- Three-way merge path (base SHA present): unchanged.

### C3 — Non-destructive bootstrap

File: `bin/bootstrap.sh`

1. Do not run the sync as the last step by default.
2. Add `--run` flag to restore old behavior (install + sync immediately).
3. Add `--with-workflow` flag to opt in to installing `sync-scaffold.yml`.
   Default: install the workflow (preserve current behavior for the workflow,
   but print a note about it).
4. After install, print the command to run the first sync manually.

Acceptance: `curl ... bootstrap.sh | bash` on a fresh repo adds the tooling,
prints next steps, and changes no tracked content until the user runs the sync.

### C4 — Release tag

Create `v1.0` tag at the merge commit. Add pinning instructions to README.

### Section 5 — Doc updates

- `README.md`: consumer-owned `CLAUDE.md` rule, `.scaffold-keep`, non-
  destructive bootstrap, `*.scaffold-new` review flow, `--run`/`--with-workflow`
  flags, pinning to a tag.
- `bin/bootstrap.sh` and `bin/sync-from-scaffold.sh` header comments: reflect
  new behavior.
- `skills/sync-scaffold.md` (and emitted forms): bootstrap path no longer
  mutates committed files; surface the `*.scaffold-new` review step.

## Non-goals

- Do not remove the push model.
- Do not build victus's pull tooling.
- Phase B (registry/frontmatter/index) out of scope.
- Workstream B (shared authoring rules) ships as a separate PR.
