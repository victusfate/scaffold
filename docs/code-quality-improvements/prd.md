# PRD: Code Quality Improvements

## Problem Statement

A deep whole-codebase review (`design.md`) found 44 findings: 3 critical
correctness bugs, 7 structural blockers, 19 medium quality issues, and 15 polish
items. The dominant defect class is **spec drift** — the repo has precise
normative docs (`agent-authoring-requirements.md`, PRDs, README) that the code
violates: the npx sync path can silently clobber protected consumer files (C1,
C2), the required CI check runs nothing (C3), the release workflow fails
structurally on every push (H1), versions inflate on every PR push (H2), and the
headline `npx … sync` path breaks on the documented Node 18 floor (H3).
Duplicated parsers and contradictory skill prose compound the drift.

## Solution

Implement the design doc's nine-improvement plan as vertical slices: unify the
three sync paths behind one clobber-safe write engine, extract the hoist engine
into an importable module, harden the policy parser, share the RESOLVER parser,
wire the five existing test suites into CI with a single working versioning
mechanism, bring tools/bin/skills into spec compliance, make `feature-chain` a
thin orchestrator, harden the read-once hook, and land a small polish batch.

## User Stories

1. As a consumer running `npx scaffold sync`, I want differing destination files
   written as `*.scaffold-new` sidecars by default (and `.scaffold-keep`
   honored), so scaffold updates never clobber my local edits.
2. As a consumer, I want `--force` to actually overwrite (skipping the sidecar
   path), so I can opt into clobbering explicitly.
3. As a consumer with a typo'd policy section key (e.g. `protcted:`), I want the
   sync to fail loudly, so my protected files are never reclassified as copyable.
4. As a consumer with an unknown top-level policy key or a malformed `ref:`
   line, I want a non-zero exit with a clear message, so config errors surface
   in CI instead of silently changing behavior.
5. As a consumer on Node 18 or 20, I want `npx scaffold sync` to start, so the
   documented Node floor is real.
6. As a consumer running `sync --check`, I want the skills step reported (how
   many manifest entries would be replayed), so the dry run shows the whole
   picture.
7. As a consumer running `sync --scaffold-root=<local>`, I want skills hoisted
   from that same local tree (no network), so file and skill halves read the
   same universe.
8. As a maintainer, I want the provenance line to state both the file source
   (package version) and the skills ref, so mixed-version syncs are visible.
9. As a maintainer merging a PR, I want CI `verify` to run all five test suites,
   the linter, and the README freshness check, so a red suite blocks merge.
10. As a maintainer, I want exactly one versioning mechanism that bumps once per
    merge (not once per push) and never fails structurally, so version history
    is meaningful.
11. As a maintainer, I want the RESOLVER table parsed by one shared library, so
    the linter, README generator, and emitter can never silently disagree.
12. As a user running `bin/bootstrap.sh` or `bin/sync-from-scaffold.sh` from a
    subdirectory, I want them to operate on the repo root, so files land where
    the spec says.
13. As a consumer of `sync-from-scaffold.sh`, I want a failed manifest read to
    abort before the SHA file is updated, so I'm never silently marked synced.
14. As an agent following `skillify`, I want it to generate all five harness
    forms and five manifest entries, so its output passes `check-resolvable.mjs`
    on the first run.
15. As an agent reading `tools/`, I want `tools/sync/` self-describing
    (`tool.yaml`, `README.md`) and both tools listed in a `tools/README.md`
    index, so capabilities are discoverable per spec §2.
16. As an agent running the feature chain, I want `feature-chain` to defer phase
    rules to the sibling skills it invokes, so the chain can never contradict
    `tdd`/`to-prd`/AGENTS.md.
17. As an agent running `prune`, I want it to invoke review skills with modes
    they actually define, so Phase 1 is list-only as intended.
18. As a maintainer, I want `check-resolvable.mjs` to flag per-harness wrapper
    frontmatter that drifts from the Claude form's description, so wrapper drift
    is caught at commit time.
19. As a Claude Code user with the read-once hook in warn mode, I want honest
    messaging and stats (no "tokens saved" when the full file was delivered),
    and the hook to survive file paths containing quotes and corrupted state
    files, so the hook is trustworthy.
20. As a maintainer reading the README, I want the generated Structure section
    to reflect the actual tree, so generated docs aren't wrong.

## Implementation Decisions

- **Shared write engine.** Extract `safeWrite` + `loadKeep` from
  `tools/hoist-skill/run` into a shared module under `tools/lib/`. Both the
  hoist emitters and `tools/sync/promote.mjs` consume it. `promote.mjs` gains:
  `.scaffold-keep` honoring, sidecar-by-default for differing files, working
  `force`. New statuses: `kept`, `sidecar`, `would-sidecar` (check mode).
  `run.mjs` forwards `force` to `hoist()` as well.
- **Hoist engine module.** Move `hoist()` and helpers from the extensionless
  `tools/hoist-skill/run` into `tools/hoist-skill/hoist.mjs`; `run` becomes a
  thin CLI shim. `tools/sync/run.mjs` imports `../hoist-skill/hoist.mjs`.
  `hoist()` gains a `srcRoot` option (overrides the env/module default) so the
  npx sync can pass `--scaffold-root` through with `fetch: false`. Add
  `"engines": { "node": ">=18" }` to `package.json`.
- **Policy parser contract.** Unknown top-level keys: throw. Unknown indent-2
  keys under `files:`: throw. `ref:` with no value: throw. `ref` values:
  unquoted like guarded fields. Error messages name the offending line.
- **Shared RESOLVER parser.** `tools/lib/resolver.mjs` exporting `splitRow` and
  `parseResolver` (superset signature: returns name/regex/path/purpose cells so
  all three consumers can use it). `check-resolvable.mjs`,
  `update-readme-skills.mjs`, and `hoist.mjs` consume it.
- **CI.** `package.json` `scripts.test` runs: `tools/hoist-skill/test`,
  `tools/sync/test`, `scripts/test-sync.sh`, `scripts/test-bootstrap.sh`,
  `node scripts/check-resolvable.mjs`, `node scripts/update-readme-skills.mjs
  --check`. `scripts.test:integration` runs the two `test-integration` files
  with `RUN_INTEGRATION=1`. CI `verify` runs `npm test`; a separate optional job
  runs integration tests.
- **Versioning.** Delete `release.yml` (no lockfile, no semantic-release config;
  fails every push). Rework `version-bump.yml` to run on push to `main`: compute
  the bump from commits since the last version-change commit via a new
  `scripts/compute-bump.mjs` (pure, testable: commit subjects + current version
  → next version or `none`), commit `chore: bump version` directly (bot push via
  `GITHUB_TOKEN` does not retrigger workflows), and tag `v<version>`. This kills
  per-push inflation and the unmergeable-PR hazard in one move.
- **bin root resolution.** `bootstrap.sh` and `sync-from-scaffold.sh` `cd` to
  `git rev-parse --show-toplevel` before acting. `sync-from-scaffold.sh`
  captures the manifest read into a variable and aborts non-zero on failure
  before writing the SHA file. `bootstrap.sh` rejects unknown flags. The
  repo-bound skill guard list moves to one shared data file (`bin/repo-bound-skills.txt`)
  read by both `install-skills.sh` and `globalize-skill.sh`.
- **Spec compliance.** `tools/sync/` gets `tool.yaml` + `README.md`;
  `tools/README.md` indexes both tools. `skillify.md` lists all five forms and
  five manifest paths. Provenance: the npx package checkout **is** the file
  source by design; the provenance line prints `files=package@<version>` plus
  `skills-ref=<ref>`. Fix `hoist-skill.md` and README plan-mode `sources` shape
  to the `{path, required, ref}` object form. `generateStructure()` in
  `update-readme-skills.mjs` is corrected to the actual tree (still curated, but
  accurate) including `tools/`, all bin scripts, workflows, and the spec doc.
- **Frontmatter parity.** New `check-resolvable.mjs` phase: for each skill, the
  `description` in `.cursor/rules/<name>.mdc`, `.agents/skills/<name>/SKILL.md`,
  and `.agent/workflows/<name>.md` frontmatter must match the Claude form's
  description (normalized whitespace). Mismatch = warning first run, then fix
  all existing drift in the same slice so the phase can be strict.
- **Skill orchestration.** `feature-chain.md` phases 1–3 become thin
  delegations ("run `/grill-with-docs` …, then advance") keeping only
  chain-specific glue (entry-point detection, no-pause rule, Phase 4). The two
  contradictions (plan-granularity confirmation, test-module confirmation)
  resolve in favor of the sibling skills (`tdd.md`, `to-prd.md`) — chain mode
  passes "no-pause" context only where the sibling explicitly allows it.
  `prune.md` Phase 1 invokes `/code-review` (which has a list-only default)
  and drops the undefined list-only `/simplify` invocation in favor of
  `/code-review --effort high` coverage.
- **Hook hardening.** `read-once/hook.sh`: emit all JSON via `jq`; gate
  `tokens_saved` accounting and "apply this diff mentally" messaging on deny
  mode; cap `stats.jsonl` in the hourly cleanup; tolerate corrupted
  `.last-cleanup`; `#!/usr/bin/env bash` shebangs across hooks.
- **Polish batch.** Remove dead `createServer` import; fix `run(args, dest)`
  unused param; drop stray `await`; `tool.yaml` absolute-cwd command note; test
  temp-dir cleanup; `unquote` single-char guard; reject `../` traversal in
  policy paths.

## Testing Decisions

- **Prior art:** `tools/hoist-skill/test` (69 asserts) and `tools/sync/test`
  (36) are self-contained Node scripts with temp dirs; `scripts/test-sync.sh`
  (26) and `scripts/test-bootstrap.sh` (10) exercise the bash entrypoints
  end-to-end. New tests follow these harnesses.
- **promote/write engine:** rewrite `tools/sync/test` case "copy overwrites
  freely" to assert the sidecar contract; add cases for `kept`, `sidecar`,
  `would-sidecar`, `--force` overwrite, and `.scaffold-keep` glob.
- **policy parser:** unknown top-level key, unknown `files` sub-key (the C1
  reclassification scenario), bare `ref:`, quoted `ref`.
- **hoist extraction:** existing 69 asserts must pass unchanged through the CLI;
  add one `srcRoot`-option test via the sync path (local scaffold-root hoists
  skills without network).
- **compute-bump.mjs:** unit tests — feat/fix/breaking/none, mixed, scoped.
- **bash entrypoints:** new cases in `test-bootstrap.sh`/`test-sync.sh` running
  from a subdirectory; manifest-read failure aborts before SHA write.
- **linter parity phase:** validated by running `check-resolvable.mjs` against
  the repo after fixing existing drift (must pass) and against a crafted
  drifted fixture in a temp dir.
- **hook:** new `scripts/test-read-once.sh` driving `hook.sh` with crafted
  stdin JSON and a temp state dir: warn-mode message honesty, quote-bearing
  paths produce valid JSON, corrupted `.last-cleanup` tolerated.
- **Skill/doc edits:** no behavior tests; `check-resolvable.mjs` + README
  freshness check gate them.

## Out of Scope

- The canonical→harness wrapper **generator** (spec §4 "Phase B") — parity
  linting only.
- Isolated tests for `bin/install-skills.sh` / `bin/globalize-skill.sh` (§3
  SHOULD; deferred).
- Fetch-replay ref semantics (M15, M19 `[uncertain]`) — needs a design decision
  on pin semantics; documented as a known issue in `tools/hoist-skill/README.md`.
- `--link` mode symlink resolution (L6 `[uncertain]`).
- Fetching promotion files at `--ref` (H7) — resolved by documenting
  package-checkout-as-source and honest provenance instead.

## Further Notes

- The `verify`-on-bot-commit hazard disappears because the bump moves to
  post-merge `main` pushes; PR heads are always user commits.
- `tools/lib/` is a shared-module directory, not a callable unit home; it has
  no descriptor (spec §1 homes are calling surfaces; modules aren't called).
- L12 (DRY-phase window dedup) and L11 (RESOLVER pipe-escape consistency) ride
  along only if trivially safe during their slices.
