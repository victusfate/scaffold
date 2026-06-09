# TDD Log: code-quality-improvements

## Slice 1 — Policy parser hardening (C1, M4, L9)
- Status: done
- Notes: unknown top-level keys, unknown `files:` sub-keys, and bare `ref:`
  now throw; `ref` values unquoted; `unquote` guards single-char input.
  The `protcted:` reclassification scenario is covered by case 8a.

## Slice 2 — Hoist engine extraction (H3)
- Status: done
- Notes: `tools/hoist-skill/hoist.mjs` is the engine; `run` is a CLI shim.
  `tools/sync/run.mjs` and the sync test import the `.mjs` module (Node 18+).
  `package.json` declares `engines.node >=18`.

## Slice 3 — Shared clobber-safe write engine (C2, M1)
- Status: done
- Notes: `tools/lib/safe-write.mjs` holds `safeWrite` + `loadKeep`; both
  hoist and `promote.mjs` consume it. promote now honors `.scaffold-keep`,
  sidecars differing files by default, and `--force` works (and is forwarded
  to hoist). Integration scenario rewritten to the clobber-safe lifecycle:
  sidecar on first contact, adoption via `--force`, marker check never
  bypassed by force.

## Slice 4 — Sync UX truthfulness (M2, M3, H7)
- Status: done
- Notes: provenance prints `files=package@<version>` (or the local root) plus
  `skills-ref=<ref>`; `--check` reports `would-replay N skill(s)` instead of a
  fake hoisting line; `--scaffold-root` now serves skill hoisting too
  (`hoist({srcRoot, fetch:false})` — no network).

## Slice 5 — Real CI + one versioning mechanism (C3, H1, H2)
- Status: done
- Notes: `npm test` now runs both tool suites, compute-bump tests, both shell
  suites, the strict linter, and the README freshness check; CI `verify` runs
  it, plus a separate `integration` job. `release.yml` (structurally broken:
  no lockfile, no semantic-release config) deleted. `version-bump.yml` moved
  to push-on-main: bump derived by `scripts/compute-bump.mjs` from commits
  since the last bump commit, then commit + `v<version>` tag.
