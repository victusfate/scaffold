# TDD log: Codex support

## Slice 1

- RED: live hoist CLI exited 1: `Unknown harnesses: codex`.
- GREEN: Codex export, plan/replay/edit protection, generated wrapper resolution,
  and all-harness coexistence pass (3 acceptance tests).
- Existing baseline `npm test` passed before changes. Tests need the normal
  subprocess/Git environment; sandbox execution initially suppressed child output.
- Exporter regressions and typecheck pass. Remaining gates recorded below.

## Slice 2

Pending implementation and verification.
