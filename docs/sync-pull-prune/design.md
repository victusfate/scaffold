# Design: file transfer + pruning for the pull path (`bin/sync-from-scaffold.sh`)

## Problem

scaffold has **two** consumer sync mechanisms:

1. **The pull path** — `bin/sync-from-scaffold.sh`, git-based, reads
   `.github/scaffold-files.txt` (the manifest) and copies the listed files into
   the consumer. This is what real template consumers (e.g. ricochet) run.
2. **The npx path** — `tools/sync/run.ts`, policy-based (`.sync/policy.yaml`),
   with a managed-file ledger (`.sync/managed`) that prunes orphans (#56) and a
   removed-files hint (#57).

The pull path is purely **additive**: it copies what the manifest lists and never
removes anything. When upstream renames or drops a managed file (e.g. the
`.mjs → .ts` migration), the old file is **stranded** in every consumer forever —
the classic "rotting boilerplate" problem. The ledger/prune work in #56/#57 lives
on the *npx* path, so it does nothing for pull-path consumers.

## The technique we are grafting

Industry solutions to template drift fall into three buckets (see
[research](#prior-art-considered)). The one that fits scaffold is **native
deletion propagation** as used by tools like `actions-template-sync`: when the
upstream removes a file, the consumer removes it too. We adopt the *idea* without
adopting the tool, because scaffold's pull path already has safer merge
mechanics than the tool's blunt `-X theirs` strategy.

The concrete realization is a **manifest-diff prune**, not a whole-tree git
merge. scaffold already ships `scaffold-files.txt` to consumers, so the consumer
holds the manifest from its last sync. That gives us the prior state for free:

```
orphans = (manifest @ last_sha)  −  (manifest @ scaffold/main)
```

Any path scaffold shipped at the last synced SHA but no longer lists is an
orphan. This reuses the existing per-file machinery (base-SHA pristine check,
`.scaffold-keep`) and is far smaller and safer than rewriting the script into a
constrained whole-tree merge.

## Canonical vocabulary

| Term | Meaning |
|---|---|
| **manifest** | `.github/scaffold-files.txt` — the list of files scaffold ships; travels to consumers, so the consumer always has the last-synced copy |
| **orphan** | a path in the manifest at `last_sha` that is absent from the manifest at `scaffold/main` — upstream stopped shipping it |
| **pristine** | an orphan whose working-tree content still hashes to what scaffold shipped at `last_sha` (consumer never edited it) — the only kind we auto-delete |
| **prune** | deletion of pristine orphans |
| **last_sha** | `.github/scaffold-sync-sha` — the upstream commit of the previous sync; the merge base and the source of the prior manifest |

## Decisions

### D1 — Diff the committed manifest, not a separate ledger

The pull path's prior state is already on disk and in history: the manifest at
`last_sha`. No new state file (unlike the npx path's `.sync/managed`). This keeps
the two paths' mechanisms independent and adds zero new tracked artifacts.

### D2 — Manifest-diff prune, not a whole-tree merge

A true whole-tree git merge (subtree / `actions-template-sync`) gets deletions
"for free", but merging scaffold's unrelated history into a consumer pulls in
*everything* not explicitly ignored and replaces the script's surgical,
allowlist copy. The manifest diff achieves the same deletion outcome while
preserving the existing model and its safety. Graduating to a full merge model is
a possible v2, not required to fix rotting.

### D3 — Three safety gates before any deletion

1. **`.scaffold-keep`** — a kept orphan is the consumer's; reported, never
   deleted (reuses `in_keep_list`).
2. **Pristine check** — `git hash-object <file>` must equal
   `git rev-parse <last_sha>:<file>`. Any consumer edit (working tree or
   committed) changes the hash → kept and reported, never auto-deleted.
3. **First sync prunes nothing** — with no `last_sha` there is no prior manifest
   to diff, so deletions can't be established safely. Pre-existing orphans
   self-heal on the next upstream change (same posture as the npx path's D5).

### D4 — `--dry-run` previews everything

`--dry-run` / `-n` runs the full sync — updates, merges, sidecars, and
deletions — writing nothing and saving no SHA. Orphans are reported as
`Would remove` instead of `Removed`. This lets a consumer see deletion
propagation before trusting it.

### D5 — Deletions stage, they don't auto-commit

`git rm` stages the deletion (falling back to `rm` for untracked files); the
consumer reviews and commits. The sync never creates commits on the consumer's
behalf.

## Prune-result reporting

| Section | Meaning |
|---|---|
| `Removed` | pristine orphan deleted (deletion staged) |
| `Would remove` | pristine orphan a real run would delete (`--dry-run`) |
| `Kept (dropped upstream but not pristine / consumer-owned)` | orphan kept — locally modified or `.scaffold-keep` |

## Relationship to the npx path (#56/#57)

This is the pull-path equivalent of the npx ledger prune. The two are parallel by
design (different consumers use different paths). If consumers later converge on
one mechanism — or scaffold moves to a full merge model — the redundant path and
its machinery (ledger, `removed-files.tsv`) can be retired.

## Prior art considered

| Approach | Fit for scaffold |
|---|---|
| **GitHub Action (`actions-template-sync`)** | native deletion via full git merge + PR. Right *idea* (deletion propagation); we borrow it, not the tool, because our base-SHA 3-way merge is safer than its `-X theirs`. |
| **git subtree + symlinks** | needs a single owned prefix; scaffold's files live at scattered native paths (`.claude/`, `.cursor/`, root). Symlinking dozens of per-harness files is fragile. Rejected. |
| **Copier / cruft / Cookiecutter** | parameterized Jinja templating engines; scaffold ships near-verbatim files with ~no variables. Adopting them means becoming a template engine to gain machinery we wouldn't use. Rejected. |
| **Package engine (Projen / npm)** | already true for `tools/**` (run via npx, not copied). But skill/guidance files must be materialized at real paths the harness reads, so it can't cover them. Complementary, not a replacement. |

## Out of scope

- A one-shot backfill for orphans that predate `last_sha` (no prior manifest).
- Removing now-empty parent directories after deletion.
- Force-deleting consumer-modified orphans (always kept here).
- Converging the pull and npx paths onto one mechanism.
