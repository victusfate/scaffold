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
