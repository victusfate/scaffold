# Branch versioning: bump in `create-pr`, tag on merge

How this repo versions releases without a CI bump job, an extra token, or a
direct push to `main`. Portable to any repo with a `package.json` and a
PR-based merge flow (e.g. `victusfate/ricochet`).

## The problem it solves

The obvious design — a GitHub Actions job that bumps `package.json` after merge
— fights two platform rules at once:

1. **Branch ruleset on `main`.** "Protect main" blocks direct pushes and
   force-pushes. A workflow running as `github-actions[bot]` is not an admin, so
   its push to `main` is rejected.
2. **Anti-recursion on `GITHUB_TOKEN`.** A push made with the default
   `GITHUB_TOKEN` does **not** trigger new workflow runs. So if a bot bumps the
   version on the PR branch, the bump commit never gets a `verify` run — its
   check shows `action_required` and never completes, and the required status
   check blocks the merge forever.

Workarounds exist (a dedicated bot account, a fine-grained PAT) but they all add
a credential to manage. We wanted none.

## The technique

Move the bump out of CI and into the **`create-pr` skill**, which runs under the
human's credentials.

```
commits on branch ──▶ create-pr skill ──▶ verify (CI) ──▶ merge ──▶ release.yml
  (conventional)        bumps package.json    runs on        to        tags
                        on the branch,        the bump       main      v<version>
                        commits it            commit
```

Because the bump commit is pushed by a person (not `GITHUB_TOKEN`):

- `verify` runs on it normally — no anti-recursion stall.
- No push to `main` ever happens for the bump — it rides in with the PR merge,
  so the branch ruleset is never hit.
- No bot account and no PAT.

Tagging stays in `release.yml`, which fires on push to `main` and pushes only a
tag (`v<version>`) — a tag push is not blocked by the ruleset.

## What `create-pr` does (Step 3 of the skill)

1. Skip if a `chore(release):` bump already exists in `origin/main..HEAD`
   (idempotent across re-runs).
2. Read the **base** version from `origin/main:package.json` — not the branch —
   so a branch cut from an older main still bumps relative to the current
   release.
3. Compute the next version from the branch's conventional commits via
   `scripts/compute-bump.mjs` (`BREAKING`/`!:` → major, `feat:` → minor,
   `fix:` → patch, else none). If `none`, skip.
4. `npm version <next> --no-git-tag-version`, then commit
   `chore(release): bump version to <next>` — staging only `package.json`
   (and `package-lock.json` if present). No tag.

The full step text lives in `skills/create-pr.md`.

## Porting to another repo

- Hoist or copy the `create-pr` skill. The bump step degrades gracefully: it
  skips silently when there is no `package.json`, and falls back to the inline
  bump rule when `scripts/compute-bump.mjs` is absent (so you can copy the skill
  without the script).
- Keep a `release.yml` that tags on merge to `main` (reads `package.json`,
  skips if the tag exists, pushes `v<version>`).
- Delete any post-merge CI bump job — it is what this replaces.
