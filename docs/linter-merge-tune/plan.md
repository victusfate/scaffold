# Plan: linter-merge-tune

Vertical slices. Tool changes are TDD'd (deterministic); the skill-prompt changes
(merge/tune reasoning) are authored + verified by bash/RESOLVER checks, not unit
tests, since the reasoning is the agent's.

## Slice 1 — emit stamps template hash into the marker
**Layers:** crypto helper → emit.mjs → unit test
- Add `templateHash(srcDir, configFile)` helper (sha256 of template UTF-8 bytes,
  first 12 hex) using `node:crypto`.
- When emitting a config that contains the marker, append ` sha256:<hash12>` to the
  marker line written into the target (replace the static marker at write time).
- **RED:** test "emitted config marker carries sha256:<hash> matching the template".
- **GREEN:** implement helper + stamping.
- Re-emit idempotence (current config still skipped) must still hold.

## Slice 2 — detect resolves `stale` via hash compare
**Layers:** detect.mjs → unit test
- Extend `detect()` state logic: for a marked config, parse the stamped hash, compute
  the current template hash, return `scaffold` if equal, `stale` if different.
- Template unreachable (no template file / no scaffold root) → `scaffold` fallback.
- **RED:** test "marked config with mismatched hash → state: stale".
- **GREEN:** implement compare + fallback.
- Existing `none` / `foreign` / `scaffold` cases must remain green.

## Slice 3 — marker parsing + legacy tolerance
**Layers:** detect.mjs (parse) → unit test
- Parse stamped hash from a config's marker line; a marker with no hash (legacy) →
  treated as `scaffold` (current), never `stale`.
- **RED:** test "legacy marker without hash → state: scaffold".
- **GREEN:** implement tolerant parse.

## Slice 4 — integration scenario for staleness
**Layers:** test-integration (end to end)
- Scenario: emit a config (stamps hash) → edit the template → detect reports `stale`
  for that language; a second emit against the stale config offers re-merge path
  (tool still skips/sidecars per existing clobber rules — assert detect output).
- **RED/GREEN:** add scenario to `tools/linter-setup/test-integration`.

## Slice 5 — skill: merge + tune + stale steps
**Layers:** skills/add-linter.md (prompt) → bash + RESOLVER checks
- Add **Merge step** (foreign + stale): read config + sidecar, propose diff (user
  rules kept, scaffold thresholds added, conflicts flagged user-wins), write on
  approval, preserve `.bak`.
- Add **Tune step** (always offered): scan code, suggest matching values, apply
  confirmed edits as diff, declinable.
- Update detect partitioning to include `stale` → re-merge offer.
- Update Step 4 reporting + Step 2 prompts.
- Propagate to harness wrappers if body changed (wrappers are pointers — no change).
- **Verify:** `npm test` (RESOLVER 19 skills, docs/skills.md sync, bash assertions)
  all green; `scripts/test-linter-setup.sh` markers still parseable.

## Done when
- `npm test` + `npm run test:integration` green.
- New unit + integration tests cover hash stamping, `stale` detection, legacy
  tolerance, fallback.
- `add-linter.md` documents merge + tune + stale flows.
- `/code-quality-review` (auto-fix) clean.
