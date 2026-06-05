# Plan: npx Consumer Sync

## Slice 1 — package.json + bin/sync shim
Layers: config → entry point → smoke test
- Add `package.json` (name, type:module, bin entry)
- Add `bin/sync` shim (imports and runs `tools/sync/run`)
- Add stub `tools/sync/run` that exits 0
- Test: `node bin/sync` exits 0

## Slice 2 — Policy parser
Layers: data schema → parse logic → unit tests
- Add `tools/sync/policy.mjs` exporting `parsePolicy(yamlText)`
- Handles: copy list, guarded list (path+keep_marker), protected list, skills.manifest, ref default
- Test: valid schema, missing files key, unknown top-level key, guarded entry without keep_marker

## Slice 3 — File promotion engine
Layers: fetch logic → promotion rules → unit tests
- Add `tools/sync/promote.mjs` exporting `promoteFiles(policy, ref, into, opts)`
- Rules: copy (free overwrite), guarded (marker check), protected (never), default deny
- `--check` mode: collect actions, write nothing
- `--force`: skips sidecar path for copy/passing-guarded entries
- Test: each rule type, guarded marker absent (warn+skip), protected+force, default-deny, check mode

## Slice 4 — hoist-skill API export
Layers: refactor CLI → export hoist(options) → test import
- Refactor `tools/hoist-skill/run`: wrap argv parsing, call `hoist(options)`
- Export `hoist` for module import
- Test: `import { hoist }` works; `hoist({ list:true, into:'.' })` returns capabilities JSON

## Slice 5 — Sync orchestrator + provenance
Layers: CLI args → orchestrate promote+hoist → print summary
- Implement `tools/sync/run` fully: parse args, load policy, call promoteFiles, call hoist
- Print resolved ref before any writes
- Exit codes: 0 success, 1 fatal
- Test: missing policy → exit 1 with message; provenance line printed; skills section absent → hoist skipped

## Slice 6 — Integration test
- `tools/sync/test-integration`: full consumer lifecycle in a real temp dir
- Uses a local HTTP server (same pattern as hoist-skill test-integration) to serve scaffold files
- Verifies copy written, guarded written (marker present), guarded skipped (marker absent), protected untouched, skills hoisted
