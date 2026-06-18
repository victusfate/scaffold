# Plan: Language-Linter Setup

Vertical slices. Each cuts through all layers: data → logic → tests.
RED → GREEN → REFACTOR against `npm test` per slice.

---

## Slice 1 — Registry: language → linter mapping

**Behavior:** `tools/linter-setup/registry.mjs` exports a map of all 9 supported
languages. Each entry has: extensions (array), linter name, config filename,
workflow filename, marker string, and a `metricsOnly: false` flag (true for
Zig/Mojo which emit format-only workflows with no config thresholds).

**Files:**
- `tools/linter-setup/registry.mjs`
- `tools/linter-setup/test` (cases: all 9 languages present, required fields)

---

## Slice 2 — Detection: classify repo state

**Behavior:** `tools/linter-setup/detect.mjs` scans `git ls-files` in a target
repo, maps extensions to languages via registry, checks each language's config
file for the scaffold marker, and returns `{ language, state }` where state is
`none | foreign | scaffold`.

**Files:**
- `tools/linter-setup/detect.mjs`
- `tools/linter-setup/test` (cases: none/foreign/scaffold states, mixed-language
  repo, unsupported extension, empty repo)

---

## Slice 3 — Emit tracer bullet: JS/TS template + emission logic

**Behavior:** `tools/linter-setup/emit.mjs` copies `lib/linters/js/eslint.config.mjs`
and `lib/linters/js/lint-js.yml` into a target repo. Clobber-safe: writes
sidecars on conflict. JS/TS is the tracer bullet that proves the full emit path.

**Files:**
- `lib/linters/js/eslint.config.mjs` (ESLint config with scaffold thresholds + marker)
- `lib/linters/js/lint-js.yml` (GitHub Actions workflow)
- `tools/linter-setup/emit.mjs`
- `tools/linter-setup/test` (cases: files written, scaffold marker present,
  sidecar on conflict, original untouched on conflict)

---

## Slice 4 — Remaining 8 language templates + grep assertion script

**Behavior:** Template files for Python, Go, Rust, Ruby, Shell, Elixir, Zig,
Mojo added to `lib/linters/`. `scripts/test-linter-setup.sh` asserts: each
template has the scaffold marker, each non-format-only config has at least one
rubric threshold, each workflow has a `pull_request` trigger.

**Files:**
- `lib/linters/{python,go,rust,ruby,shell,elixir,zig,mojo}/` (config + workflow each)
- `scripts/test-linter-setup.sh`

---

## Slice 5 — CLI entry point + integration test

**Behavior:** `tools/linter-setup/run` accepts `--detect-only` (scan + JSON out,
no writes) and full mode (reads confirmed-languages JSON from stdin, emits).
`--into <path>` targets a specific repo. Integration test covers full lifecycle:
fresh repo with JS+Python → both detected → both confirmed → both emitted with
markers.

**Files:**
- `tools/linter-setup/run`
- `tools/linter-setup/test` (CLI cases: --detect-only output shape, full mode,
  --into, unsupported language reported)
- `tools/linter-setup/test-integration`

---

## Slice 6 — Sync integration

**Behavior:** `tools/sync/run.mjs` calls `tools/linter-setup/run --detect-only`
at the end of a successful sync. If languages with `state: none` are found,
appends the suggestion message to sync output. Detection owned by linter-setup
tool — sync does not duplicate extension logic.

**Files:**
- `tools/sync/run.mjs` (extend)
- `tools/sync/test` (case: suggestion appears in output when unset-up languages
  detected; no suggestion when all configured)

---

## Slice 7 — Skill + RESOLVER + npm test wiring

**Behavior:** `skills/add-linter.md` is a registered scaffold skill. Wired into
RESOLVER, wrapped for Claude/Cursor/Antigravity harnesses. `scripts/test-linter-setup.sh`
and `tools/linter-setup/test` added to `npm test` chain.

**Files:**
- `skills/add-linter.md`
- RESOLVER entry
- Harness wrappers
- `package.json` (extend test chain)
- `scripts/test-add-linter-skill.sh`
- `.github/scaffold-files.txt` (register new lib/linters/ + tools/linter-setup/ files)
