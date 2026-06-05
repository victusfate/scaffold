# TDD Log: npx-consumer-sync

## Slice 1 — package.json + bin/sync shim
- Status: done
- Notes: Added package.json (name: scaffold, type: module, bin entry), bin/sync shim, stub run.mjs.

## Slice 2 — Policy parser
- Status: done
- Notes: Hand-rolled state-machine YAML parser for fixed schema. Handles copy/guarded/protected lists, quoted values, multi-line guarded objects with path+keep_marker.

## Slice 3 — File promotion engine
- Status: done
- Notes: promote.mjs covers copy (free overwrite), guarded (marker check), protected (absolute), default-deny, --check mode, src-missing. 8 cases.

## Slice 4 — hoist-skill API export
- Status: done
- Notes: Refactored tools/hoist-skill/run — main() → hoist(opts), process.exit() → throw, CLI entry point guarded by isMain check. All 65 existing hoist-skill tests preserved.

## Slice 5 — Sync orchestrator + provenance
- Status: done
- Notes: Full tools/sync/run.mjs: args, policy load, provenance print, promoteFiles, conditional hoist, guarded-skip warnings. 4 new cases.

## Slice 6 — Integration test
- Status: done
- Notes: tools/sync/test-integration — 3-step consumer lifecycle: initial sync, guarded-skip on marker removal, --check dry run. 14 assertions, all pass.

## Code quality review
- Status: done
- Fixes applied: flushGuarded moved before loop in policy.mjs; sawFiles boolean replaces raw-text scan; async removed from promoteFiles (no await inside).
