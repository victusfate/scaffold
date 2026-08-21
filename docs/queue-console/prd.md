# PRD: Queue Console

## Problem Statement

Steering the agent work queue today means either hand-editing
`.agent/queue/queue.md` (checkbox/field typos corrupt tasks) or issuing
one-shot CLI commands with an incomplete verb set — the only reorder is
`top`, a terminal-failed task can't be revived without hand edits, and there
is no live picture of the queue while workers drain it. The person feeding a
long-running project can't see or reshape the pipeline quickly, which is the
whole point of a human-steerable queue.

## Solution

A **queue console**: the missing management verbs in the existing CLI
(`move` to any position, `requeue` a failed task) plus a zero-dependency local
web page served by `node scripts/queue-console.ts`. The page shows the live
queue (auto-refreshing as the file changes), and lets the user add, edit,
remove, drag-reorder, requeue, start/stop, tune config, and sweep the archive
— every action flowing through the existing pure model layer so the file
format can never corrupt. The console manages the queue; it never executes
tasks or shell commands.

## User Stories

1. As a queue owner, I want to move any task to any position (CLI `move
   <id> <pos>` and web drag), so the drain order matches my priorities.
2. As a queue owner, I want to revive a failed task (`requeue`) after fixing
   its spec, so recovery doesn't require hand-editing Markdown.
3. As a queue owner, I want a live web view of status, counts, and task
   specs, so I can see what a running drain is doing without polling the CLI.
4. As a queue owner, I want to add a task with full spec fields from the
   page, so enqueue-time specification is easy enough to actually do.
5. As a queue owner, I want to edit any task's fields inline, so
   underspecified (`needs-spec`) tasks are cheap to refine.
6. As a queue owner, I want to remove tasks and sweep done/failed to the
   archive from the page, so pruning is one click.
7. As a queue owner, I want start/stop and interval/maxParallel controls on
   the page, so pausing or widening the drain is immediate.
8. As a queue owner, I want the page to defer refreshes while I'm mid-edit
   or mid-drag (with a "changed on disk" banner), so a worker write never
   eats my input.
9. As a queue owner, I want the server bound to loopback only and free of
   execution endpoints, so running the console adds no attack surface beyond
   editing the file myself.
10. As an agent following the `/queue` skill, I want `move`/`requeue`
    documented in the command surface, so I use the CLI instead of ad-hoc
    file edits.
11. Edge: moving a task to a position past the end clamps to last; unknown
    ids are no-ops (CLI errors politely, HTTP returns 400).
12. Edge: requeue on a task that isn't failed and has no failures is a
    no-op; the page only offers the button on eligible rows.
13. Edge: a malformed or unknown `/api/op` body changes nothing and returns
    HTTP 400 with a reason.
14. Edge: two writers (worker + console) race — last writer wins, matching
    the existing CLI's contract; each console request re-reads the file first.

## Implementation Decisions

- **Model (`queue-model.ts`)** gains two pure ops: `moveTask(q, id,
  toIndex)` (0-based, clamped, unknown-id no-op) and `requeueTask(q, id)`
  (failed or `failures > 0` → pending with failures/note/owner/startedAt
  cleared, position kept; otherwise no-op).
- **CLI (`queue.ts`)** gains `move <id> <pos>` (1-based to match `list`
  numbering) and `requeue <id>`; both logged, both emit the drain kick.
- **Console server (`queue-console.ts`)** — `node:http` on `127.0.0.1`,
  default port 8722 (`--port` flag), `QUEUE_FILE` honored. Routes: `GET /`
  (page), `GET /api/queue` (`ConsoleState` JSON), `POST /api/op` (one typed
  `Op`, validated by a pure exported `applyOp`; on success saves and returns
  fresh state), `GET /events` (SSE `changed` on file mtime change,
  `watchFile` at 500ms). Op set: add, set, remove, move, top, requeue,
  start, stop, config, archive — exactly D3's management surface, no
  done/fail/claim/worktree, no process spawning. The `archive` op reuses the
  same sweep semantics as the CLI (`done`+`failed` out, block appended to
  `archive.md`).
- **`ConsoleState`** = full config + tasks in priority order, each annotated
  `eligible`/`deadlocked` (derived via existing selectors), plus the
  `drainSignal` marker — so the page renders derived truth instead of
  re-deriving it in JS.
- **Page (`queue-console.template.html`)** — single file, inline CSS/JS, no
  external assets. Header (status pill, counts, interval/maxParallel
  editors, Start/Stop, Archive, drain hint) · add row with expandable spec
  fields · task list with drag handles, tag chips, top/requeue/edit/remove
  actions, row-expanding edit grid. SSE-driven re-render deferred during
  edit/drag per D8.
- **Docs** — `skills/queue.md`: `move`/`requeue` join the command-surface
  block; new short **Console** subsection. `queue.ts` usage header updated.
- Everything TypeScript under Node type-stripping; no new dependencies
  (matches `.agent/default-language.md` and the `mermaid-watch.ts` prior
  art).

## Testing Decisions

- Good tests here are pure-function assertions on model/dispatch behavior
  plus one real-server round-trip; no browser automation.
- **`scripts/queue.test.ts`** (existing pass/fail assert style): `moveTask`
  (middle→head, clamp past end, unknown id no-op, order preserved
  otherwise) and `requeueTask` (failed reset, failures>0 reset, pending
  no-op, position kept), plus round-trip through serialize/parse.
- **`scripts/queue-console.test.ts`** (new, same style, wired into `npm
  test`): `applyOp` per op incl. validation rejections; `ConsoleState`
  shaping (eligible/deadlocked/drain fields); template contains required
  mount points and op names; then an integration block that boots the
  server on an ephemeral port with a temp `QUEUE_FILE` and asserts `GET /`,
  `GET /api/queue`, a `POST /api/op` whose effect is visible in the file, a
  400 on a bad op, and loopback-only binding.
- Prior art: `queue.test.ts` (assert style), `mermaid-watch.test.ts`
  (server/template testing patterns).

## Out of Scope

- Execution verbs on the web (done/fail/claim/worktree/validate) and any
  endpoint that runs a shell command.
- File locking beyond the existing last-writer-wins contract.
- Auth, TLS, non-loopback binding, multi-machine access.
- Editing `log.md`/`archive.md` from the page.
- Browser-automation tests; `up`/`down` CLI aliases (dropped in design
  review).

## Further Notes

- If multi-writer corruption ever shows up in practice, a `.lock` sidecar
  with O_EXCL semantics can wrap `save()` for both CLI and server in one
  place — deferred until evidenced.
- A later version could surface `log.md` read-only in the page; the SSE
  channel already carries the trigger.
