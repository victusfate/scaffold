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

## Slice 6 — bin entrypoint compliance (H5, M14, M6, L3)
- Status: done
- Notes: bootstrap.sh and sync-from-scaffold.sh `cd` to the repo root (run
  from any CWD per §2a); a failed manifest read aborts before the SHA file is
  written; bootstrap rejects unknown flags. Repo-bound skill guard list
  single-sourced in bin/repo-bound-skills.txt (read by install-skills.sh and
  globalize-skill.sh). Consumer manifest gains tools/hoist-skill/hoist.mjs and
  tools/lib/safe-write.mjs (run's new import chain).

## Slice 7 — Descriptors + frontmatter parity (H4, M18, L15)
- Status: done
- Notes: new linter phase 8 enforces description parity between the Claude
  wrapper and the cursor/agents/workflow forms (36 drifts found and fixed by
  propagating the Claude descriptions; protect-branch's stale "restrict
  updates" corrected to "restrict pushes" at the source first).
  tools/sync gains tool.yaml + README.md; tools/README.md indexes both tools
  and documents tools/lib/; hoist tool.yaml commands now repo-root-relative.

## Slice 8 — Skill/doc drift (H6, M7, M8, M9, M10, M17)
- Status: done
- Notes: skillify now generates all five harness forms + five manifest paths;
  feature-chain phases 1–3 are thin delegations to grill-with-docs/to-prd/tdd
  (granularity + test-module confirmations owned by the siblings — the two
  contradictions are gone); prune's audit phase uses modes that exist
  (code-review default; quality/simplify criteria applied as read-only lenses);
  hoist-skill.md + README plan-mode examples show the real {path, required,
  ref} source shape; README structure tree regenerated to include tools/,
  all bin scripts, workflows, the spec doc; "How releases work" matches the
  new verify + post-merge bump reality.

## Slice 9 — Hook hardening (M11, M12, M13, L1, L2)
- Status: done
- Notes: all JSON output via `jq -cn --arg`/`--argjson` — paths with quotes
  produce valid JSON in cache, stats, and advisory output; warn mode no longer
  records `tokens_saved` in stats.jsonl nor emits savings claims in advisory
  message; stats.jsonl pruned to 4999 lines during hourly cleanup (one write
  per run keeps total ≤5000); corrupted `.last-cleanup` coerced to 0 via
  regex guard; shebangs changed to `#!/usr/bin/env bash`.

## Slice 10 — Polish batch (M16, L7, L8, L10, L13)
- Status: done
- Notes: dead `createServer` import removed from `tools/sync/test-integration`;
  unused `dest` param removed from `run()` in hoist test; temp-dir cleanup via
  `_tmpDirs`/`process.on('exit')` pattern in hoist test; stray `await` removed
  from `promoteFiles()` call in `run.mjs` (function is synchronous); `../`
  traversal rejection added to `promote.mjs` — paths that resolve outside
  destRoot receive status `traversal-blocked` and are never written.
