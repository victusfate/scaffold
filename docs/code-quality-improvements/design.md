# Design — Code Quality Improvements

**Source:** Deep whole-codebase review (every source file read fully) against this
repo's own quality standards: the `code-quality-review` checklist, `code-review`
correctness/quality passes, `simplify` dimensions, and
`docs/agent-authoring-requirements.md`.

**Scope reviewed:** ~5,200 lines — canonical skills (`skills/*.md` ×16), all four
generated harness forms, `tools/hoist-skill/`, `tools/sync/`, `bin/` scripts,
`scripts/`, `.claude/` hooks, and CI workflows. All five local test suites pass
today (hoist 69, sync 36, test-sync 26, test-bootstrap 10, linter clean).

---

## Canonical vocabulary

| Term | Meaning |
|---|---|
| **Clobber-safe write** | Writing a scaffold file into a consumer repo via sidecar (`*.scaffold-new`) when the destination differs, honoring `.scaffold-keep`; never silent overwrite. The contract in `agent-authoring-requirements.md` §2a. |
| **Sync path** | Any of the three mechanisms that copy scaffold files into a consumer: git-remote sync (`bin/sync-from-scaffold.sh`), hoist (`tools/hoist-skill`), npx sync (`tools/sync`). |
| **Spec drift** | Code whose behavior contradicts its own PRD, README, or `agent-authoring-requirements.md`. The dominant defect class found. |
| **Skill drift** | Contradiction between sibling skills, or between a canonical skill body and its per-harness wrapper frontmatter. |
| **Decorative CI** | A required check that runs nothing (current `verify` job) or a workflow that fails structurally on every run (current `release.yml`). |
| **Verify gate** | The CI job that must run all five test suites + linter + README freshness before merge. Currently a no-op. |

---

## Findings

### Critical — correctness bugs

**C1. Policy parser silently reclassifies entries on a misspelled section key**
`tools/sync/policy.mjs:53-59` — at indent 2 inside `files:`, an unrecognized key
(e.g. `protcted:`) is skipped but `section` is not reset, so its child entries
append to the previously active list. Verified: `protcted:` after `copy:` puts
`MIND.md` into `copy` — the exact "CI typo clobbers a protected file" scenario
the npx-consumer-sync PRD (stories 3 & 7) promises cannot happen.
*Fix:* throw on unknown indent-2 keys under `files` (PRD says "rejects unknown keys").

**C2. Clobber-safe sidecar behavior in npx sync was never implemented; `force` is dead**
`tools/sync/promote.mjs:52-62` — `applyWrite(..., force)` never reads `force`;
differing destination files in `copy`/`guarded` are overwritten unconditionally.
The PRD says `--force` *skips* the sidecar path (i.e. sidecars are the default),
and §2a makes this a MUST. `.scaffold-keep` is also not honored here, unlike both
other sync paths. `tools/sync/test:139` ("copy overwrites freely") encodes the drift.
*Fix:* see Improvement 1 (shared clobber-safe write engine).

**C3. The required `verify` CI check is a no-op**
`.github/workflows/ci.yml:18` runs `npm run --if-present typecheck && npm run
--if-present test`, but `package.json` has no `scripts` — nothing runs. None of
the five local suites nor the README freshness check execute in CI, while the
README and the branch-protection story claim "verify runs typecheck + tests —
must pass before merge".
*Fix:* see Improvement 5 (wire the real test suite).

### High — structural blockers

**H1. `release.yml` fails on every push to main**
`npm ci` and `setup-node` `cache: npm` require `package-lock.json`, which doesn't
exist; there's also no semantic-release config or dependency. Combined with H2:
two competing versioning mechanisms, one structurally broken.

**H2. `version-bump.yml` re-bumps on every push to an open PR**
The bump is computed from `base..head` commit messages (unchanged across pushes)
but applied to the already-bumped `package.json` — versions inflate once per push
(0.5.0 → 0.6.0 → 0.7.0…). `[uncertain]` The bump commit's `[skip ci]` may also
leave the PR head without a `verify` run, making it unmergeable if `verify` is required.
*Fix:* derive the target version from the latest tag or base-branch `package.json`.

**H3. Extensionless ESM import breaks Node 18/20 on the headline npx path**
`tools/sync/run.mjs:11` — `import { hoist } from '../hoist-skill/run'` only works
on Node ≥22.7. The PRD states a Node 18+ floor; `package.json` declares no `engines`.
*Fix:* see Improvement 2 (extract `hoist.mjs`); add `"engines"`.

**H4. `tools/sync/` is non-compliant with §2/§6**
No `tool.yaml`, no `README.md`, no capability index (`tools/README.md` doesn't
exist for either tool). `bin/install-skills.sh` and `bin/globalize-skill.sh` have
no isolated tests and appear in no index.

**H5. `bin/bootstrap.sh` and `bin/sync-from-scaffold.sh` assume CWD is the repo root**
§2a: bin entrypoints MUST run from any CWD. Run from a subdirectory, bootstrap
creates `<subdir>/bin/…`; sync-from-scaffold reads/writes all paths relative to CWD.
*Fix:* `cd "$(git rev-parse --show-toplevel)"` at the top of each.

**H6. `skillify` generates skills that fail the repo's own validator**
`skills/skillify.md` Phase 2/3 says write three files and three manifest paths;
`check-resolvable.mjs` phases 6/7b require five forms (including
`.agents/skills/<slug>/SKILL.md` and `.agent/workflows/<slug>.md`) and five
manifest entries. Every skillify run hits validator failures by design.
*Fix:* list all five forms and all five manifest paths.

**H7. `--ref` applies only to skill hoisting, not file promotion**
`tools/sync/run.mjs:53-59` — `promoteFiles` always reads the installed package's
checkout, so `npx …#v1.3 sync --ref v1.2` mixes versions, and the provenance line
is wrong for the file half.
*Fix:* document that the package ref is the file source (and print it), or
actually fetch files at `ref`.

### Medium — quality, reuse, drift

| # | Location | Finding |
|---|---|---|
| M1 | `tools/sync/run.mjs:30` | `--force` parsed but dead end-to-end (not forwarded to `hoist()`, unused in `promoteFiles`). |
| M2 | `tools/sync/run.mjs:68-78` | `--check` prints "hoisting skills…" but silently skips hoist; dry run neither simulates nor reports the skills step. |
| M3 | `tools/sync/run.mjs:72` | Hoist always uses network fetch even with a local `--scaffold-root`; file and skill halves read different universes. |
| M4 | `tools/sync/policy.mjs:47` | `ref:` quoted value keeps quotes; `ref:` without trailing space ignored; unknown top-level keys silently accepted (PRD says reject). |
| M5 | `check-resolvable.mjs`, `update-readme-skills.mjs`, `hoist-skill/run` | RESOLVER table parser implemented 3× with divergences — the most load-bearing parser in the system. |
| M6 | `bin/install-skills.sh:51`, `bin/globalize-skill.sh:56` | Repo-bound skill guard list duplicated in two scripts (acknowledged in comments). |
| M7 | `feature-chain.md` vs `tdd.md`/AGENTS.md | Plan granularity: chain says "proceed immediately"; tdd + AGENTS.md require confirming granularity once. |
| M8 | `feature-chain.md` vs `to-prd.md` | Test-module selection: chain says no confirmation; to-prd says confirm with user. |
| M9 | `prune.md` vs `simplify.md`/`code-quality-review.md` | Prune invokes list-only/review modes the target skills don't define; chain-context inference flips them to auto-fix. |
| M10 | `hoist-skill.md`, `README.md:279-292` | Docs show manifest `sources` as flat strings; tool emits `[{path, required, ref}]` objects. |
| M11 | `.claude/read-once/hook.sh:167-221` | Warn mode allows the read but still records `tokens_saved` and tells Claude to "apply this diff mentally" — stats/messaging only correct in deny mode. |
| M12 | `.claude/read-once/hook.sh:156,191-199` | JSON built by string interpolation on the warn path; a `"` or `\` in a file path breaks the hook. Deny path correctly uses `jq`. |
| M13 | `.claude/read-once/hook.sh:102` | `stats.jsonl` grows unboundedly (cleanup prunes only sessions/snapshots) and is re-grepped fully per cache hit. |
| M14 | `bin/sync-from-scaffold.sh:40` | Failed manifest read via process substitution is invisible to `set -e`; loop no-ops and the new SHA is still saved — consumer silently marked synced. |
| M15 | `tools/hoist-skill/run:282,313-321` | `[uncertain]` Fetch replay reads registry at session ref but bodies at pinned refs — renames on main break valid old pins. |
| M16 | `tools/sync/test-integration:16` | `createServer` imported, never used; promised skills-hoisting HTTP scenario (plan slice 6) never implemented. |
| M17 | `scripts/update-readme-skills.mjs:85-124` | `generateStructure()` hardcodes a repo tree that has already drifted (omits `tools/`, three bin scripts, three workflows, the spec doc). |
| M18 | wrapper frontmatter | Per-harness description drift (`protect-branch` stale "restrict updates", cursor abbreviations); nothing lints frontmatter parity (§4). |
| M19 | `tools/hoist-skill/run:382-388` | Replay with `--ref` re-pins every entry; `upsertManifest` moves any `#` line anywhere in the file to the top. |

### Low — polish

| # | Finding |
|---|---|
| L1 | Hooks use `#!/bin/bash` not `#!/usr/bin/env bash`; `session-start/hook.sh` lacks `set -euo pipefail` (deliberate but undocumented). |
| L2 | Corrupted `.last-cleanup` (non-numeric) errors the read-once hook on every read under `set -e`. |
| L3 | `bootstrap.sh` silently ignores unknown flags (siblings reject them). |
| L4 | `globalize-skill.sh` inlines only one `@`-include level; indented imports escape the final check. |
| L5 | `install-skills.sh --dry-run` reports success without checking globalize would succeed. |
| L6 | `[uncertain]` `--link` mode symlink resolution of `@../../../` is harness-dependent; may break linked skills. |
| L7 | Test hygiene: `tools/sync/test` case 1 uses helpers defined 80 lines later; case 17 leaks a temp dir; hoist tests never clean temp dirs. |
| L8 | `tools/hoist-skill/test:21` `run(args, dest)` — `dest` unused. |
| L9 | `policy.mjs` `unquote('"')` returns empty string, unguarded. |
| L10 | `promote.mjs` doesn't reject `../` traversal in policy paths (consumer-owned input, low risk). |
| L11 | RESOLVER.md mixes `\|` and raw `\|` pipe escaping across rows. |
| L12 | Linter DRY phase hashes overlapping 3-line windows → one long dup emits many near-identical warnings. |
| L13 | `run.mjs:59` `await`s a sync function; status strings only "typed" in a docstring. |
| L14 | `.claudeignore` `*.lock` would exclude `package-lock.json` once H1's lockfile lands. |
| L15 | `tool.yaml` `command: node ./run` relative to undeclared CWD. |

---

## Cross-cutting themes

1. **Three sync paths, three safety contracts.** Git-remote sync has 3-way merge +
   sidecars + keep-list; hoist has sidecars + keep-list; npx sync — the newest —
   has neither. Same concept, inconsistent in bash and JS.
2. **Spec drift is the dominant defect class.** The repo has unusually precise
   normative docs and the code repeatedly violates them (C1, C2, H3, H4, H5, H6,
   M4, M10, M17). Nothing automated cross-checks docs against behavior.
3. **Duplicated parsers and helpers.** RESOLVER parser ×3, guard list ×2, test
   harness boilerplate ×4, portability shims ×2, keep-matchers in 2 languages.
4. **Skills restate siblings and then contradict them.** feature-chain paraphrases
   grill/to-prd/tdd and has drifted twice; prune invokes nonexistent modes;
   wrapper descriptions drift per harness.
5. **CI/release machinery is decorative** while five healthy local suites sit unwired.
6. **JSON-by-string-concatenation in bash hooks** — fragile at exactly the
   external boundary (arbitrary file paths) the repo's own checklist calls out.

---

## Decisions — improvement plan

Ordered by leverage; each improvement is a candidate vertical slice for `plan.md`.

**1. One clobber-safe write engine** *(resolves C2, M1, partially M3; theme 1)*
Extract `safeWrite` + `loadKeep` from `tools/hoist-skill/run` into a shared
module; `promote.mjs` consumes it, gaining sidecars, `.scaffold-keep`, and a
working `--force` for free. Update `tools/sync/test:139` to encode the sidecar
contract instead of "overwrites freely". ~half day.

**2. Extract `hoist.mjs` engine module** *(resolves H3; improves H4)*
Move `hoist()` out of the extensionless `run` into `tools/hoist-skill/hoist.mjs`;
`run` becomes a ~50-line CLI shim. Fixes the Node-version landmine and splits
CLI/engine altitude correctly. 1–2 hours.

**3. Shared RESOLVER parser library** *(resolves M5)*
One `lib/resolver.mjs` (`splitRow`/`parseResolver`), consumed by linter, README
generator, and hoist. Removes ~120 duplicated lines from the system's most
load-bearing parser. 1–2 hours.

**4. feature-chain as thin orchestrator** *(resolves M7, M8; theme 4)*
Replace paraphrased phase bodies with "run the sibling skill, then advance" plus
chain-specific glue only. Sibling skills become the single source of each phase's
rules — eliminates the contradiction class permanently. Also fix prune's mode
invocations (M9) with explicit flags. ~1 hour.

**5. Real CI + one versioning mechanism** *(resolves C3, H1, H2; theme 5)*
Add `package.json` `scripts.test` running both tool suites, both shell suites,
the linter, and the README check; wire into `verify`. Keep exactly one of
`release.yml`/`version-bump.yml` and fix its bump derivation. ~half day.

**6. Policy parser hardening** *(resolves C1, M4)*
Throw on unknown keys (top-level and under `files`), unquote `ref`, handle
bare `ref:`. Add the "unknown key" test case the plan promised. ~1 hour.

**7. Spec-compliance sweep** *(resolves H4, H5, H6, H7, M10, M17, M18)*
tool.yaml + README + `tools/README.md` index for both tools; repo-root `cd` in
bin entrypoints; skillify five-form fix; `--ref` provenance decision; doc shape
fixes; frontmatter-parity phase in `check-resolvable.mjs`. ~1 day.

**8. Hook hardening** *(resolves M11–M13, L1, L2)*
`jq` everywhere JSON is emitted; gate savings accounting on deny mode; bound
`stats.jsonl`; tolerate corrupted state files. ~half day.

**9. Polish batch** *(L3–L15, M6, M14, M16, M19)*
Small independent fixes; suitable as a single cleanup slice or opportunistic
companions to slices 1–8.

---

## Out of scope

- New features or behavior changes beyond what specs already promise.
- Rewriting the generated harness wrappers by hand (a generator is the §4
  long-term answer; here we only add parity linting).
- Style-preference rewrites — per AGENTS.md, working code stays as-is.
