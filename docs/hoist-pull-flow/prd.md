# PRD: hoist-pull-flow

## Overview

Enhance `tools/hoist-skill/run` so pull-only consumers can hoist skills with a
single command and no local scaffold mirror. Also make `--plan` output machine-
readable for required-vs-generated annotation, and give pure-emit mode an
actionable error when a required source is missing.

## Goals

1. A pull-only consumer can run `node run --fetch --names tdd --into . --ref v1.4`
   with zero pre-setup (no mirror, no curl loop, no mkdir).
2. `--plan` output lets consumers distinguish required sources from generated
   ones without guessing.
3. A missing required source in pure-emit mode prints a self-explaining message
   that includes the raw URL and the `--fetch` hint.

## Non-Goals

- Content hashes / drift detection (P4 deferred).
- Publishing an `npx` entry point.
- Explicit temp-dir cleanup (OS handles it).
- Changing pure-emit mode behavior beyond the new pre-check error message.

## Affected Files

| File | Change |
|---|---|
| `tools/hoist-skill/run` | Add `--fetch`, refactor to async main, annotate `--plan`, add pre-check |
| `tools/hoist-skill/tool.yaml` | Document `--fetch` flag |
| `tools/hoist-skill/test` | Update Case 11 (`--plan` shape), add cases for P1/P3 |

## Behaviour Specification

### `--fetch` flag (P1)

- Added to arg parsing: `const fetchMode = has('--fetch')`.
- When set, before parsing the registry:
  1. Create `srcRoot = join(tmpdir(), 'hoist-skill-<timestamp>')`.
  2. Fetch `RESOLVER.md` from `RAW_BASE/<ref>/.claude/skills/RESOLVER.md` (required).
     Write to `<srcRoot>/.claude/skills/RESOLVER.md`.
  3. After building `emitPairs`, collect all source paths via `capSourcePaths`.
  4. For each path: fetch from `RAW_BASE/<ref>/<path>`. Required sources: fail on
     non-200. Generated sources (`required: false`): skip on 404.
  5. Write fetched content to `<srcRoot>/<path>` (mkdir -p).
  6. Proceed with existing emit logic using `srcRoot` instead of `SCAFFOLD_ROOT`.
- In pure-emit mode `srcRoot = SCAFFOLD_ROOT` (unchanged).
- `RAW_BASE = 'https://raw.githubusercontent.com/victusfate/scaffold'`

### Emitters accept `srcRoot` (P1 internal)

- `emitClaude`, `emitCursor`, `emitAntigravity` each receive `srcRoot` as a
  parameter instead of closing over `SCAFFOLD_ROOT`.
- A `makeEmitters(srcRoot)` factory wires them up.
- `parseResolver(resolverPath)` accepts a path argument.

### `--plan` annotated output (P2)

`capSourcePaths(cap, harness)` returns `{ path, required }[]`:

- `{ path: cap.path, required: true }` — skill body, must exist
- `{ path: '.claude/skills/<n>/SKILL.md', required: false }` — generated wrapper
- `{ path: '.cursor/rules/<n>.mdc', required: false }` — generated wrapper
- `{ path: '.agents/skills/<n>/SKILL.md', required: false }` — generated wrapper
- `{ path: '.agent/workflows/<n>.md', required: false }` — generated wrapper

`--plan` output `sources` array changes from `string[]` to `{ path, required }[]`:
```json
[
  { "path": "tools/hoist-skill/run",       "required": true  },
  { "path": ".claude/skills/RESOLVER.md",  "required": true  },
  { "path": "skills/tdd.md",               "required": true  },
  { "path": ".claude/skills/tdd/SKILL.md", "required": false }
]
```

### Pre-check in pure-emit mode (P3)

Before the emit loop, when not in fetch mode, iterate `emitPairs`:
- For each `name`, check `existsSync(join(srcRoot, cap.path))`.
- If missing:
  ```
  hoist-skill: missing source skills/tdd.md
    (mirror it from https://raw.githubusercontent.com/victusfate/scaffold/main/skills/tdd.md, or run with --fetch)
  ```
  Then `process.exit(1)`.

Also pre-check `RESOLVER.md` itself before `parseResolver` in pure-emit mode.

### Async restructure

The main logic moves into `async function main()` with `main().catch(...)` at
module level. Top-level `await` is not used — `main()` encapsulates all async
work. This is necessary to use `await fetch(...)`.

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `--fetch --names tdd --into <dir> --ref main` emits `skills/tdd.md` and the claude wrapper into `<dir>` with no local scaffold mirror |
| AC-2 | `--fetch` on a bad ref fails with a clear HTTP error, non-zero exit |
| AC-3 | `--plan` `sources` entries are objects with `path` and `required` fields |
| AC-4 | `required: true` for `cap.path`, `tools/hoist-skill/run`, `RESOLVER.md` |
| AC-5 | `required: false` for all per-harness wrapper paths |
| AC-6 | Pure-emit mode with missing `skills/tdd.md` exits 1 with a message containing the raw URL and `--fetch` hint |
| AC-7 | All existing non-plan tests pass without modification |
| AC-8 | Integration tests pass (emit + replay cycle) |
