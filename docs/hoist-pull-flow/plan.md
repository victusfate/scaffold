# Plan: hoist-pull-flow

Each slice cuts through all layers: implementation → tests.

---

## Slice 1 — `--plan` annotated output (P2)

**Behaviour:** `capSourcePaths` returns `{ path, required }[]`. `--plan` emits
objects instead of strings. `TOOL_REL` and `RESOLVER_REL` are `required: true`.

**Files:**
- `tools/hoist-skill/run`: change `capSourcePaths`, change `--plan` block
- `tools/hoist-skill/test`: update Case 11 to check object shape

**RED:** Add Case 11b asserting `plan.sources[0].required === true` and
`plan.sources[3].required === false`; assert `plan.sources` entries are objects
not strings. Run → fail.

**GREEN:** Update `capSourcePaths` to return `{ path, required }`. Update
`--plan` block to use `s.path` for dedup and push full `s` object. Update
`TOOL_REL`/`RESOLVER_REL` entries to objects.

**REFACTOR:** none expected.

---

## Slice 2 — pre-check error in pure-emit mode (P3)

**Behaviour:** Before the emit loop, check each required source exists. On
missing file, print actionable error with raw URL and `--fetch` hint, exit 1.
Also check RESOLVER.md before `parseResolver`.

**Files:**
- `tools/hoist-skill/run`: add pre-check function, call before emit
- `tools/hoist-skill/test`: add Case 17 (missing skill body → non-zero + message)

**RED:** Add Case 17: create a temp dest, remove a skill body from SCAFFOLD_ROOT
(can't do that cleanly — instead override SCAFFOLD_ROOT by passing a fake dir via
a test-only env). Actually: test with `--names` pointing to a skill whose body
is injected as missing by overriding — simpler to test by passing a `--names`
that exists in registry but then shadowing SCAFFOLD_ROOT... This is tricky.

Better approach: the test creates a temp RESOLVER.md with a skill pointing to a
non-existent path, but that requires the registry to accept arbitrary paths.

Simplest testable approach: check that running with an empty temp dir as the
working tree of the tool (i.e., missing RESOLVER.md) exits with a message
containing `--fetch`. This is testable by setting a custom env.

Actually the cleanest approach: the test calls run from a temp dir where the
SCAFFOLD_ROOT would not have the skill. But SCAFFOLD_ROOT is computed from
`import.meta.url` which is always the tool's real location.

Re-think: test that if RESOLVER.md is missing (unreachable from SCAFFOLD_ROOT),
we get a helpful error. But we can't fake SCAFFOLD_ROOT from outside.

Practical test: we can test P3 by catching the pre-check message indirectly:
since the real scaffold has all files present, we can only test the error path
by verifying the message is emitted when existsSync returns false — i.e., via a
unit test that stubs the filesystem, but the test suite uses `spawnSync`.

Resolution: test the actual ENOENT path is replaced by the new message. Since
we can't corrupt SCAFFOLD_ROOT, add a test with `--names` referencing a skill
that exists in RESOLVER but whose body we rename/delete in the test (using a
custom temp SCAFFOLD_ROOT via env var `HOIST_SCAFFOLD_ROOT`).

Add `HOIST_SCAFFOLD_ROOT` env var support to `run` (overrides `SCAFFOLD_ROOT`
for testing/advanced use). This is minimal and testable.

**Files (revised):**
- `tools/hoist-skill/run`: read `SCAFFOLD_ROOT` from `HOIST_SCAFFOLD_ROOT` env if set
- `tools/hoist-skill/test`: Case 17 uses `HOIST_SCAFFOLD_ROOT` pointing to a
  partial mirror missing one skill body

---

## Slice 3 — `--fetch` network mode (P1)

**Behaviour:** `--fetch` flag downloads RESOLVER.md and all required/optional
sources to a temp dir, then emits from there.

**Files:**
- `tools/hoist-skill/run`:
  - add `import { tmpdir } from 'node:os'`
  - add `const RAW_BASE`
  - add `fetchMode = has('--fetch')`
  - refactor `parseResolver` to accept path arg
  - refactor emitters to accept `srcRoot`
  - add `makeEmitters(srcRoot)` factory
  - add `fetchRaw(url, required)` async helper
  - add `populateFetchRoot(tempDir, emitPairs, registry, ref)` async helper
  - wrap main body in `async function main()` + `main().catch(...)`
- `tools/hoist-skill/tool.yaml`: document `fetch` flag
- `tools/hoist-skill/test`: add Case 18 (`--fetch` with a mock server or skip
  if no network) — use `HOIST_RAW_BASE` env override to point at a local fixture
  server or a temp dir served via a local HTTP server

**Network test approach:** Instead of hitting GitHub, use Node's built-in
`http` module to spin up a tiny static file server over the real scaffold tree
in `SCAFFOLD_ROOT`. Pass `HOIST_RAW_BASE=http://localhost:<port>` to the tool.

This makes the fetch test self-contained and offline-safe.

---

## Slice 4 — integration test coverage

**Behaviour:** Integration test verifies emit + manifest replay still work after
the async refactor and srcRoot change.

**Files:**
- `tools/hoist-skill/test-integration`: verify existing tests still pass
- Add one `--fetch` integration scenario using the local HTTP server trick

---

## Execution Order

1. Slice 1 (P2 — plan shape) — pure refactor, no network, easiest
2. Slice 2 (P3 — pre-check error) — adds env-var escape hatch
3. Slice 3 (P1 — --fetch) — async refactor, network, largest
4. Slice 4 (integration) — verify end-to-end
