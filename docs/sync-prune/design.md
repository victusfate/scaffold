# Design: prune orphaned files on sync

## Problem

`sync` is purely additive. `promoteFiles` walks `.sync/policy.yaml`'s
`copy`/`guarded`/`protected` lists and writes them; nothing records what
scaffold wrote *last* time. When upstream renames or drops a managed file (e.g.
the `.mjs → .ts` tooling migration in #54), the consumer keeps the old file
forever as an **orphan**. A consumer that synced across that migration ends up
with 15 dead `.mjs` files alongside their `.ts` twins, and a `.githooks/pre-commit`
that still references the deleted `.mjs` paths.

Sync has no concept of "this file used to be mine," so it cannot clean up.

## Prior art considered

The deletion problem is solved by every tool that uses a **diff/merge** model
instead of a file-copy model — the removed file simply shows up as a deletion:

| Approach | Why it doesn't drop in here |
|---|---|
| **git subtree** | merges a subtree *verbatim into one prefix dir*. scaffold scatters + transforms content (symlinks, thin pointers, guarded merges, per-harness skill hoisting), so there is no single verbatim prefix to own. |
| **cruft / copier** | store the template ref and diff old→new template on update. Closest in spirit; the "prior state" is what we need. |

Takeaway: we don't need git archaeology — we just need to **materialize the
prior state**. scaffold already produces, per sync, the exact set of files it
owns (`WriteResult[]`). Persisting that set *is* the prior state, and a set
difference yields the orphans. This is the cruft idea with the ledger made
explicit.

## Canonical vocabulary

| Term | Meaning |
|---|---|
| **managed set** | the policy-promoted files whose on-disk content scaffold currently owns (`promoteFiles` results with status `written` or `unchanged`) |
| **ledger** | `.sync/managed` — one `<path>\t<sha256>` line per file in the managed set, written each sync; the materialized prior state |
| **orphan** | a path in the previous ledger that is no longer in the current managed set — upstream stopped shipping it |
| **pristine** | an orphan whose on-disk content still hashes to the ledger's recorded hash (consumer never edited it) — the only kind we auto-delete |
| **prune** | deletion of pristine orphans, gated behind `--prune` |
| **release** | an orphan that the consumer has claimed via `.scaffold-keep`; dropped from the ledger, never deleted |

## Decisions

### D1 — Ledger of the managed set, not a hand-maintained deprecation list

Each sync writes `.sync/managed` (sibling of `.sync/hoisted`) listing every
policy-promoted file scaffold owns, with a sha256 of the content. Orphans are
computed by set difference against the previous ledger. No upstream bookkeeping,
no `deprecated:` list that grows forever and drifts.

### D2 — v1 scope: policy-promoted files only, not hoisted skill files

The managed set is the `promoteFiles` output only. Reasons: (a) the reported
breakage (`.mjs` orphans) lives entirely in `files.copy`; (b) `--check` already
runs promotion in dry mode and yields `would-write`/`unchanged`, so orphan
detection stays correct under `--check` without reworking `hoist`'s check path,
which only reports a replay count. Pruning hoisted skill outputs (skill removed
from the manifest) is deferred to a follow-up.

### D3 — Three safety gates before any deletion

1. **`.scaffold-keep`** — a kept orphan is *released* to the consumer and dropped
   from the ledger; never deleted (reuses `loadKeep`).
2. **Pristine check** — recompute the orphan's hash; if it differs from the
   ledger, the consumer edited it → keep it, warn, retain in the ledger so it
   keeps being flagged. Never auto-delete consumer-modified files.
3. **Opt-in deletion** — orphans are *reported* on a normal sync and under
   `--check`; actual removal requires `--prune`. Deletion runs on the consumer's
   disk and is irreversible, so it is never the default.

### D4 — Un-actioned orphans persist in the ledger

When an orphan is reported but not deleted (no `--prune`) or skipped as modified,
it is **retained** in the new ledger with its old hash, so the next sync flags it
again. Only `pruned`, `released` (kept), and `already-gone` orphans leave the
ledger. The ledger is a persistent nag, not a one-shot report.

### D5 — First run is non-destructive by construction

The first sync after this ships has no `.sync/managed`, so the previous set is
empty → zero orphans → the ledger is merely seeded with the current managed set.
Pre-existing orphans (the 15 `.mjs`) are neither owned-now nor in the empty
ledger, so they are invisible to v1; cleanup self-heals on the *next* upstream
change. Accepted over a riskier "scan and guess" first run.

## Prune-result statuses

| status | meaning | ledger effect |
|---|---|---|
| `pruned` | pristine orphan deleted (`--prune`) | dropped |
| `would-prune` | pristine orphan that `--prune` would delete (`--check`) | n/a (check writes nothing) |
| `orphan` | pristine orphan, reported, not deleted (no `--prune`) | retained |
| `orphan-modified` | locally edited orphan; warned, never auto-deleted | retained |
| `orphan-kept` | released via `.scaffold-keep` | dropped |
| `orphan-gone` | already absent on disk | dropped |

## Scenarios

**`.mjs → .ts` rename, consumer never touched the `.mjs`**
- Sync N: ledger records `foo.mjs`. Sync N+1: policy ships `foo.ts`, not
  `foo.mjs`. `foo.mjs` is pristine → reported as `orphan`. With `--prune` →
  `pruned`, ledger now holds `foo.ts` only.

**Consumer locally edited an orphaned file**
- `orphan-modified` — kept on disk, warning printed, retained in ledger. The
  consumer decides; scaffold never silently deletes their edits.

**Consumer added the orphan to `.scaffold-keep`**
- `orphan-kept` — released, dropped from the ledger, never flagged again.

## Out of scope (v1)

- Pruning hoisted skill outputs (D2).
- Removing now-empty parent directories after deletion.
- `--prune --force` to remove *modified* orphans (modified always kept in v1).
- A one-shot `--prune-existing` to catch pre-feature orphans (D5).
