# TDD Log: linter-merge-tune

| Slice | Behavior | RED | GREEN | Refactor | Status |
|-------|----------|-----|-------|----------|--------|
| 1 | emit stamps template hash into the config marker | ✓ | ✓ | — | ✅ |
| 2 | detect resolves `stale` via hash compare | ✓ | ✓ | — | ✅ |
| 3 | marker parsing: legacy + unreachable tolerance | (guard) | ✓ | — | ✅ |
| 4 | stale integration scenario + srcRoot threading | (guard) | ✓ | — | ✅ |
| 5 | add-linter skill: merge + tune + stale steps | n/a (prompt) | ✓ | — | ✅ |

## Notes
- Slices 3 & 4 added as regression guards: the behaviors (legacy unstamped marker →
  `scaffold`; unreachable template → `scaffold` fallback; end-to-end stale) were
  already satisfied by Slice 2's minimal implementation. Added explicit tests rather
  than artificially break correct code to force a RED.
- Slice 5 is a skill-prompt change (agent-driven merge/tune reasoning); verified via
  `npm test` (RESOLVER 19 skills, docs/skills.md sync, bash assertions), not units.
- New deterministic surface: `tools/linter-setup/hash.mjs` (`templateHash`),
  `emit.mjs` marker stamping, `detect.mjs` `stale` state + `srcRoot` param.
- `srcRoot` threaded into `run` (`--detect-only`) and `tools/sync/run.mjs` detect
  calls so hashing honors `--scaffold-root`.

## Test status
- `npm test`: 41 bash + RESOLVER + docs-sync green; `tools/linter-setup/test`
  107 passed.
- `npm run test:integration`: 36 passed (added Scenario 12 — stale detection).
