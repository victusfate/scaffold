# Plan: Queue Console — vertical slices

Each slice cuts data → logic → surface (CLI/HTTP/page) → tests and lands as its
own RED → GREEN → (REFACTOR) commit pair. Suite entry: `npm test` (queue tests
run via `node scripts/queue.test.ts`; the console test joins the chain in
slice 3).

## Slice 1 — `move`: reorder a task to an explicit position
- Model: `moveTask(q, id, toIndex)` — 0-based, clamped to bounds, unknown id
  no-op (pure, `queue-model.ts`).
- CLI: `queue move <id> <pos>` (1-based, matches `list` numbering), logged,
  emits drain kick; usage header updated.
- Tests (`queue.test.ts`): move to head / middle / clamp-past-end / unknown-id
  no-op / relative order of untouched tasks preserved / survives
  serialize→parse round-trip.

## Slice 2 — `requeue`: revive a failed task
- Model: `requeueTask(q, id)` — `failed` or `failures > 0` → pending with
  failures 0, note/owner/startedAt cleared, position kept; else no-op.
- CLI: `queue requeue <id>`, logged, drain kick.
- Tests: failed→pending reset, retry-count task reset, clean-pending no-op,
  unknown-id no-op, position kept.

## Slice 3 — console core: `ConsoleState` + `applyOp` (pure dispatch)
- New `scripts/queue-console.ts` exporting `consoleState(q)` (config + tasks
  annotated eligible/deadlocked + drain marker) and `applyOp(q, op)` (validated
  dispatch over add/set/remove/move/top/requeue/start/stop/config/archive →
  `{ ok, queue?, archived?, error? }`; unknown/malformed → error, queue
  untouched; archive returns swept tasks for the caller to persist).
- New `scripts/queue-console.test.ts` wired into `package.json` `test`.
- Tests: state annotation correctness; each op happy path; rejection paths
  (unknown op, missing id, bad position, bad config key).

## Slice 4 — console server: HTTP + SSE on loopback
- `queue-console.ts` gains `startServer({ port, file })` → `node:http` server
  bound to 127.0.0.1: `GET /` (template), `GET /api/queue`, `POST /api/op`
  (apply → save → fresh state; 400 on error), `GET /events` (SSE `changed` via
  `watchFile` 500ms); `main` with `--port` flag and `QUEUE_FILE` support.
- Archive op appends to `archive.md` sidecar exactly like the CLI.
- Tests (same file, in-process server on port 0 + temp QUEUE_FILE): GET
  round-trips, POST op mutates the file on disk, bad op → 400 and file
  unchanged, server address is loopback.

## Slice 5 — console page: `queue-console.template.html`
- Single-file page (inline CSS/JS, no external assets): header (status pill,
  counts, interval/maxParallel editors, Start/Stop, Archive, drain hint), add
  row with expandable spec fields, task list with drag reorder +
  top/requeue/edit/remove and row-expanding edit grid; SSE re-render deferred
  during edit/drag with "changed on disk" banner (D8/D9).
- Tests: template served at `/` contains the op names and required mount
  points; template stays asset-free (no http(s) URLs in src/href).

## Slice 6 — docs and discoverability
- `skills/queue.md`: `move`/`requeue` in the command-surface block + short
  **Console** subsection; `queue.ts` header comment lists new commands (done
  in slices 1–2, verified here).
- Full gate: `npm test`, `npm run lint`, `npm run typecheck`.
