# Design: Queue Live Board (issue #108)

> Extends the queue console (`docs/queue-console/`) into a live kanban
> control plane. The console stays **management-only** (design.md D3):
> the page never executes tasks or shell commands.

## Problem

The console shows a list and lets you reorder, but after reordering there
is no way to say "ok, re-evaluate now" — the drain picks up the new order
whenever its driver next ticks, and active lane claims stay put with no
visible re-dispatch plan. For a repo fanning out across many lanes, the
board must show live lane status **and** offer one explicit control that
turns UI futzing into a fresh dispatch decision.

## Decisions

### D1 — Kanban is a grouping of the same ConsoleState, not a new model

Columns map to existing states, derived server-side so the page renders
truth instead of re-deriving it in JS:

- Queued (pending + eligible) · Blocked (pending but deps unmet or
  deadlocked) · In Progress (active) · Done (done, pre-archive) ·
  Failed (failed).
- Each card: id, title, slug, deps, mode, owner/lease age when active,
  `accept:` on expand.
- Drag reorder applies **only within Queued** (the priority order); it
  emits the existing `move` op. Cross-column drag is refused — status
  transitions stay with workers/CLI (D3).

### D2 — Live lanes come from sidecars the server only reads

Workers/drivers write heartbeats; the server never spawns or signals them:

- `.agent/queue/lanes/<task-id>.json` —
  `{ id, worker, model, step, state, startedAt, updatedAt, tail }`,
  written by the lane owner (CLI `queue lane heartbeat <id> --step …`).
- `GET /api/lanes` returns all fresh sidecars; staleness = `now -
  updatedAt > leaseMinutes` (rendered grey, never auto-reclaimed).
- SSE already fires on `queue.md` mtime; lane writes also touch the
  channel so the board refreshes within ~500ms.

The server gains **no** process-spawning or kill endpoint. Lane stop is a
cooperative `stop-requested` flag file the owning driver honors — same
authority rule as `owner`/`startedAt` (labels, never PIDs).

### D3 — Reassign button: re-evaluate, never preempt (user-directed)

After futzing with order/deps, one **Reassign** button in the header tells
the system "recompute who should run now":

- Pure op `reassign`: touches **no** task. It reloads, runs the existing
  selectors (`readyTasks` under `maxParallel`, `nextActionable`), writes
  `console reassign` to the audit log, and returns the fresh dispatch
  plan `{ active: string[], next: string[] }` alongside `ConsoleState`.
- Active claims are **never stolen or reset** — an active task keeps its
  lane even if it is no longer top priority (the `requeueTask` no-steal
  rule). If the user wants a lane off a task, they stop/fail it first
  (existing steering), then Reassign fills the freed slot from the new
  order.
- Effect on drivers: Reassign emits the same drain kick as `add`/`top`
  (`DRAIN-WANTED n pending`) so an armed Monitor/loop wakes immediately
  instead of waiting for `idlePoll`; idle lanes pick up the new `next`
  set on their next tick. The page shows the plan as a banner
  ("continues: task-004 · up next: task-009, task-002"), which is the
  observable proof the futzing took effect.
- Unknown/empty queue → plan with empty arrays (still 200, nothing to do).

### D4 — Steering stays cooperative

Pause/stop a lane = write its stop-request flag (driver exits at the next
safe point and `fail`s with a note; the console does not kill). Reorder
mid-run = existing `move`/`top` + Reassign. Re-queue failed = existing
`requeue`. All three already flow through validated ops; the board only
adds the lane flag writer (a file write, not a signal — session
isolation holds).

### D5 — Ships as the same skill, same launcher

No new package or port: `node scripts/queue-console.ts [--port 8722]`
serves the board at `/` (the list becomes the board). `skills/queue.md`
Console subsection documents columns + Reassign. Zero dependencies,
loopback-only, existing Host/content-type hardening unchanged.

## Canonical vocabulary

| Term | Meaning |
|---|---|
| **board** | the kanban grouping of `ConsoleState` (Queued/Blocked/In Progress/Done/Failed) |
| **lane** | one claimed task's live execution record (heartbeat sidecar), owned by its worker |
| **heartbeat** | a lane sidecar write (`step`, `tail`, `updatedAt`); liveness signal only |
| **reassign** | the no-mutation op that recomputes the dispatch plan from current order and kicks the drain |
| **dispatch plan** | `{ active, next }` — which lanes continue, which eligible tasks start next under the cap |
| **stop-request** | a cooperative per-lane flag file; the owner honors it, nobody kills |

## Scenarios

1. **Futz then reassign** — user drags task-009 to position 2 while
   worker-a runs task-004. Hits Reassign → banner "continues: task-004 ·
   up next: task-009"; the Monitor wakes on the kick; when task-004
   completes, task-009 starts.
2. **Dep edit blocks the head** — user adds `deps: task-007` to the top
   task, hits Reassign → plan shows the next eligible instead; the
   blocked card sits in the Blocked column with its dep chip.
3. **Stale lane** — a heartbeat ages past `leaseMinutes`: card greys with
   "stale — owner resolves", dispatch plan excludes it from `next` but the
   console never reclaims it (ownership conflict path unchanged).

## Out of scope (v1)

- Server-side spawning/killing of agents (the literal "Run N lanes" —
  stays with `/loop` drivers + Monitors; the board kicks them awake).
- Editing `log.md`/`archive.md`/lane tails from the page (read-only).
- Cross-column drag to change status; per-task scoreboard hooks.
