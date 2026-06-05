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

**Status: PENDING**

---

## Slice 4 — integration test coverage

**Status: PENDING**
