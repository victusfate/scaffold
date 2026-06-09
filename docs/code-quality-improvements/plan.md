# Plan: Code Quality Improvements

Vertical slices, ordered by leverage. Each slice = tests + code + docs through
all affected layers. Chain mode: proceed slice by slice, RED → GREEN → REFACTOR.

## Slice 1 — Policy parser hardening (C1, M4, L9)
Throw on unknown top-level keys, unknown `files:` sub-keys, bare `ref:`;
unquote `ref`; guard `unquote` single-char. Tests: the `protcted:`
reclassification scenario fails loudly; quoted ref; unknown keys.
Files: `tools/sync/policy.mjs`, `tools/sync/test`.

## Slice 2 — Hoist engine extraction (H3, M3 enabler)
Move `hoist()` + helpers into `tools/hoist-skill/hoist.mjs`; `run` becomes a
CLI shim; `hoist()` gains `srcRoot` option. `tools/sync/run.mjs` imports the
`.mjs` module. Add `"engines": {"node": ">=18"}`. Tests: full hoist suite green
through the CLI; module importable.
Files: `tools/hoist-skill/hoist.mjs` (new), `tools/hoist-skill/run`,
`tools/sync/run.mjs`, `package.json`.

## Slice 3 — Shared clobber-safe write engine (C2, M1)
`tools/lib/safe-write.mjs` (new): `safeWrite` + `loadKeep` extracted from
hoist. `promote.mjs` consumes it: sidecar default, `kept`, `would-sidecar`,
working `force`. `run.mjs` forwards `force` to `hoist()`. Rewrite "copy
overwrites freely" test; add sidecar/keep/force cases.
Files: `tools/lib/safe-write.mjs` (new), `tools/hoist-skill/hoist.mjs`,
`tools/sync/promote.mjs`, `tools/sync/run.mjs`, `tools/sync/test`.

## Slice 4 — Sync UX truthfulness (M2, M3, H7-as-documented)
`--check` reports manifest entry count instead of fake "hoisting...". Local
`--scaffold-root` → `hoist({srcRoot, fetch:false})`. Provenance prints
`files=package@<version>` + `skills-ref=<ref>`. Tests: check-mode output,
local-root hoist without network.
Files: `tools/sync/run.mjs`, `tools/sync/test`.

## Slice 5 — Real CI + one versioning mechanism (C3, H1, H2)
`scripts/compute-bump.mjs` (new, unit-tested). `package.json` scripts
(`test`, `test:integration`). `ci.yml` verify runs `npm test`. Delete
`release.yml`; rework `version-bump.yml` → push-to-main bump + tag.
Files: `scripts/compute-bump.mjs` (new), `scripts/compute-bump.test.mjs` (new),
`package.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`
(delete), `.github/workflows/version-bump.yml`.

## Slice 6 — bin entrypoint compliance (H5, M14, M6, L3)
Repo-root `cd` in `bootstrap.sh` + `sync-from-scaffold.sh`; manifest read
captured + checked before SHA write; shared `bin/repo-bound-skills.txt`;
bootstrap rejects unknown flags. Tests: subdir runs, manifest-failure abort,
unknown-flag rejection (in `test-bootstrap.sh` / `test-sync.sh`).
Files: `bin/bootstrap.sh`, `bin/sync-from-scaffold.sh`, `bin/install-skills.sh`,
`bin/globalize-skill.sh`, `bin/repo-bound-skills.txt` (new),
`scripts/test-bootstrap.sh`, `scripts/test-sync.sh`.

## Slice 7 — Spec compliance: descriptors + frontmatter parity (H4, M18, L15)
`tools/sync/tool.yaml` + `tools/sync/README.md`; `tools/README.md` index;
fix `tools/hoist-skill/tool.yaml` command cwd note. New parity phase in
`check-resolvable.mjs`; fix existing wrapper drift so it passes strict.
Files: `tools/sync/tool.yaml` (new), `tools/sync/README.md` (new),
`tools/README.md` (new), `tools/hoist-skill/tool.yaml`,
`scripts/check-resolvable.mjs`, drifted wrapper files.

## Slice 8 — Skill/doc drift (H6, M7, M8, M9, M10, M17)
skillify five forms + five manifest paths; feature-chain thin orchestrator;
prune mode fix; hoist-skill.md + README `sources` shape; `generateStructure()`
corrected. Gates: linter + README freshness.
Files: `skills/skillify.md`, `skills/feature-chain.md`, `skills/prune.md`,
`skills/hoist-skill.md`, `scripts/update-readme-skills.mjs`, `README.md`.

## Slice 9 — Hook hardening (M11, M12, M13, L1, L2)
`jq` for all JSON output; deny-gated savings stats + honest warn message;
stats.jsonl pruning; corrupted `.last-cleanup` tolerance; env-bash shebangs.
New `scripts/test-read-once.sh`.
Files: `.claude/read-once/hook.sh`, `.claude/read-once/compact.sh`,
`.claude/session-start/hook.sh`, `scripts/test-read-once.sh` (new).

## Slice 10 — Polish batch (M16, L7, L8, L10, L13)
Dead `createServer` import; unused `dest` param; stray `await`; `../`
traversal rejection in promote; test temp-dir cleanup.
Files: `tools/sync/test-integration`, `tools/hoist-skill/test`,
`tools/sync/run.mjs`, `tools/sync/promote.mjs`, `tools/sync/test`.

## After all slices
`/code-quality-review` auto-fix → Phase 4 summary → `/create-pr`.
