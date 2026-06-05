# PRD: npx Zero-Local-Code Consumer Sync

## Problem Statement

External consumers of scaffold (repos like `victusama` that pull from scaffold
but were not created from its template) must currently maintain a local sync
script that: fetches scaffold files, promotes some freely, guards others against
clobbering consumer-owned content, and calls `hoist-skill`. Keeping this script
correct across scaffold changes is ongoing maintenance burden. The consumer
should own only declarative config — not logic.

## Solution

Add a `sync` CLI to scaffold, runnable via
`npx github:victusfate/scaffold#<tag> sync`, that reads a consumer-owned policy
file (`.sync/policy.yaml`) and executes the full sync: file promotion with
copy/guarded/protected semantics, and skill hoisting via the existing
`hoist-skill` engine. The consumer keeps two data files and one `npm run` script.
No `scripts/` directory, no sync logic.

## User Stories

1. As an external consumer, I want to run `npm run sync` and have all scaffold
   files and skills updated in one step, so I don't maintain any sync scripts.

2. As an external consumer, I want to declare which files are freely copied,
   which are guarded (write only if a marker string is still present), and which
   are protected (never written), so I retain control over consumer-owned files.

3. As an external consumer, I want `protected` files to be absolutely safe — no
   flag can override them — so a CI typo cannot clobber `MIND.md`.

4. As an external consumer, I want `--check` to show me exactly what would
   change before any file is written, so I can preview a sync in CI or before
   a PR.

5. As an external consumer, I want to pin a scaffold version with `--ref v1.2`
   (or bake it into the npm run script), so syncs are reproducible and I control
   when to pick up scaffold changes.

6. As an external consumer, I want the tool to print the resolved ref it acted
   on, so every sync is auditable.

7. As an external consumer, I want a missing or malformed `policy.yaml` to fail
   loudly with a clear message, not silently skip files.

8. As an external consumer, I want a `guarded` file that fails its marker check
   to be skipped with a visible warning (not silently), so I know scaffold's
   template drifted from my expectation.

9. As an external consumer, I want any path absent from my policy to be silently
   skipped (default deny), so scaffold can add new files without surprising me.

10. As a scaffold maintainer, I want `npx github:victusfate/scaffold#v1.2 sync`
    to work without publishing to npm, so there is no registry infrastructure to
    maintain.

11. As a scaffold maintainer, I want the sync tool to reuse `hoist-skill`'s
    network-fetch and manifest-replay logic via module import, so there is no
    duplicated fetch or emit code.

## Implementation Decisions

### New: `package.json`
Scaffold gets a minimal `package.json` with `"type": "module"` and a `"bin"`
entry mapping `scaffold` to `./bin/sync`. No runtime npm dependencies — all
logic uses Node built-ins plus the shared hoist-skill module.

### New: `bin/sync`
Thin ESM shim that imports and runs `tools/sync/run`. Analogous to the pattern
used by `tools/hoist-skill/run` as the authoritative entry point.

### New: `tools/sync/run`
Main sync logic. Accepts CLI args (`--into`, `--ref`, `--check`, `--force`).
Reads `.sync/policy.yaml`, fetches scaffold files from GitHub at the resolved
ref, applies file promotion rules, then calls the hoist-skill API for skills.
Prints provenance (resolved ref) and a per-file summary to stdout.

### New: `tools/sync/policy.mjs`
Zero-dependency YAML parser for the fixed policy schema. Parses the known
structure (top-level keys, nested arrays of strings and `{path, keep_marker}`
objects) line-by-line. Does not attempt to be a general YAML parser — validates
structure and rejects unknown keys.

Policy schema:
```yaml
ref: main                        # default ref; --ref flag overrides
files:
  copy:                          # freely overwritten
    - AGENTS.md
  guarded:                       # written only when incoming satisfies keep_marker
    - path: CLAUDE.md
      keep_marker: "@MIND.md"
  protected:                     # never written, not even with --force
    - MIND.md
skills:
  manifest: .sync/hoisted        # path to hoist-skill manifest
```

### Modify: `tools/hoist-skill/run` → extract API
Refactor `main()` into a parameterized exported function `hoist(options)`.
`options` mirrors the existing CLI flags as properties:
`{ fetch, fromManifest, ref, into, force, names, harness, noRecord }`.

The file stays as the CLI entry point: when `import.meta.url` is the main
script, it parses `process.argv` and calls `hoist(options)`. When imported as a
module, callers use `hoist(options)` directly.

`tools/sync/run` imports `hoist` from `tools/hoist-skill/run` and calls it with
`{ fetch: true, fromManifest: <policy.skills.manifest>, ref, into }`.

### File promotion contract
Mirrors the `written` / `unchanged` / `sidecar` / `kept` contract from
`safeWrite()` in hoist-skill, extended with `guarded-skip` (guarded file where
marker was absent) and `protected` (protected path, never written).

In `--check` mode, no files are written and hoist-skill is not called. Output
is a table of would-be actions.

### Exit codes
- `0` — success (all writes, skips, and warnings completed)
- `1` — fatal error (missing policy, fetch failure, hoist-skill error)

### `bin/sync-from-scaffold.sh` coexistence
Unchanged. Serves template consumers (push-installed at repo instantiation).
The new `sync` CLI serves external consumers. Different audiences, no overlap.

## Testing Decisions

**Prior art:** `tools/hoist-skill/test` — Node.js ESM, custom `assert(label, cond, detail)` helper, case-numbered, no test framework. `tools/hoist-skill/test-integration` for consumer lifecycle.

**New test file:** `tools/sync/test` — same style.

**Cases to cover:**
- Policy parsing: valid schema, missing required keys, unknown keys, guarded entry missing keep_marker field, protected list, empty sections
- File promotion: copy overwrites freely, guarded writes when marker present, guarded skips when marker absent (with warning), protected never writes even with `--force`, default-deny skips unlisted path
- `--check`: no files written, correct summary output, hoist-skill not invoked
- Provenance: resolved ref printed before any writes
- Missing policy file: exits 1 with clear message
- Hoist-skill integration: `hoist()` called with correct options when skills manifest present; skipped gracefully when absent

**Hoist-skill API tests:** Add one case to `tools/hoist-skill/test` verifying that `import { hoist } from './run'` works and that calling `hoist({ list: true, ... })` returns correctly (smoke test for the API export).

## Out of Scope

- Publishing to npm (named package, `npx @victusfate/scaffold sync`)
- Per-section selectors (`sync files` / `sync skills` as separate subcommands)
- `--force` overriding `protected` (explicitly excluded by design)
- Template consumer sync (served by `bin/sync-from-scaffold.sh`)
- Automated consumer setup / bootstrapping (consumer writes their own `policy.yaml`)

## Further Notes

- **YAML parser scope:** the policy parser is intentionally narrow. If the schema grows, revisit whether to introduce `js-yaml` as a dev/runtime dependency or keep the hand-rolled parser.
- **`package.json` name:** set to `scaffold` for the bin key. This does not imply intent to publish.
- **Node version:** inherit the same floor as `hoist-skill` (currently no explicit minimum in scaffold; `fetch` requires Node 18+).
- **`--force` on `copy` entries:** behaves like hoist-skill's `--force` — writes even when the local file differs (skips the sidecar path). Guarded entries with a passing marker also respect `--force`.
