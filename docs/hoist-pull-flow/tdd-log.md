# TDD Log: hoist-pull-flow

## Slice 1 — `--plan` annotated output (P2)

**Status: DONE**

- RED: Updated Case 11 in `test` to assert `sources` entries are `{ path, required }` objects, not strings. Added assertions for `required: true` on `TOOL_REL`, `RESOLVER_REL`, `cap.path` and `required: false` on the claude wrapper.
- GREEN: Updated `capSourcePaths` to return `{ path, required }[]`. Updated `--plan` block to use `s.path` for dedup set and push full `s` object. `TOOL_REL`/`RESOLVER_REL` entries now explicit objects.
- Tests: 56 passed, 0 failed.

---

## Slice 2 — pre-check error in pure-emit mode (P3)

**Status: DONE**

- RED: Added Case 17 using `HOIST_SCAFFOLD_ROOT` env override to point the tool at a partial mirror missing `skills/tdd.md`. Asserted exit non-zero, message contains "missing source", "--fetch", and the raw GitHub URL.
- GREEN: Added `HOIST_SCAFFOLD_ROOT` env-var override for `SCAFFOLD_ROOT`. Added RESOLVER existence check before `parseResolver()` with actionable message. Added `checkLocalSources(pairs)` that pre-checks each skill body before the emit loop.
- Tests: 60 passed, 0 failed.

---

## Slice 3 — `--fetch` network mode (P1)

**Status: DONE**

- RED: Added Case 18 using a peer-process HTTP server (IPC-based, avoids sandbox parent-child network restriction) serving scaffold files. Passes `HOIST_RAW_BASE` env override. Asserted exit 0, skill body written, claude wrapper written, results array, manifest recorded.
- GREEN: Added `--fetch` flag (`fetchMode`), `HOIST_RAW_BASE` env override for `RAW_BASE`, `import { tmpdir }`, `fetchRaw(url, required)`, `populateFetchRoot(tempDir, pairs, registry, ref)`. Refactored emitters to accept `srcRoot` param; added `makeEmitters(srcRoot)` factory. `parseResolver(resolverPath)` now accepts explicit path. Wrapped main body in `async function main()` with `main().catch()`. Sync RESOLVER check now inside `main()` guarded by `!fetchMode`.
- Tests: 65 passed, 0 failed.

---

## Slice 4 — integration test coverage

**Status: DONE**

- Updated integration test Step 3 (`--plan` output shape) from `sources.includes(string)` to `sources.map(s => s.path).includes(string)`.
- All scenarios pass: 22/22 integration, 65/65 unit.

## Code Quality Review

- No auto-fixes applied.
- Noted: `populateFetchRoot` is not called in `--plan --fetch` mode (plan exits first), but RESOLVER.md is fetched in `main()`. Minor wasted request; not a correctness issue.
- Pre-existing emitter structure preserved (shared first-two-lines pattern).
- `checkLocalSources` `process.exit` pattern is consistent with existing validation code.
