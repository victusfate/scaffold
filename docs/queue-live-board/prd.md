# PRD: Queue Live Board (issue #108)

## Problem Statement

The queue console manages the queue but shows a flat list with no sense of
flow, no live view of what agents are doing, and no explicit control that
turns a reordering session into a fresh dispatch decision. After futzing
with priorities, the user can't tell the system "re-evaluate now" — the
drain notices whenever it ticks, and active lanes are invisible.

## Solution

A live kanban board over the existing console: state-grouped columns, a
**Reassign** button that recomputes the dispatch plan without preempting
lanes, per-lane heartbeat sidecars surfaced as live chips, and a
cooperative lane-stop — all without adding any execution endpoint to the
loopback server.

## User Stories

1. As a queue owner, I see Queued / Blocked / In Progress / Done / Failed
   columns so the pipeline state reads at a glance.
2. As a queue owner, after dragging/editing I hit Reassign and see
   `continues: … · up next: …`, proving the new order took effect and
   kicking an armed drain awake.
3. As a queue owner, I see each active lane's worker, current step, and
   log tail live; stale lanes grey out instead of vanishing.
4. As a queue owner, I request a lane stop (■) and the owning driver
   winds down at its next safe point — nothing is killed.
5. As a worker/driver, I post heartbeats with one CLI call
   (`queue lane beat <id> --step … --tail …`).
6. Edge: Reassign on an empty queue is a no-op success; active claims are
   never reset by it.
7. Edge: malformed lane files are skipped; a lane for an unknown task id
   is rejected at the op boundary.

## Implementation Decisions

- **`scripts/queue-lanes.ts`** (new): `LaneState` sidecars under
  `.agent/queue/lanes/<id>.json`; `beatLane` (merge + stamp), `readLanes`
  (skip malformed), `laneStale` (derived vs `leaseMinutes`), `clearLane`,
  plus cooperative `requestStop`/`stopRequested`/`clearStopRequest` flag
  files. Workers write; the server only reads.
- **CLI (`queue.ts` + `queue-cli-args.ts`)**: `lane beat|list|clear|stop|go`;
  `step/model/tail/state` join the value-flag grammar.
- **Console server**: `GET /api/lanes` (lanes + staleness + stop flags);
  `stop-lane` op (id-validated, no task mutation; flag written by the
  handler like the archive sidecar); lane dir watched for SSE alongside
  the queue file.
- **Page**: column grouping (drag only inside Queued, emitting the global
  `move` index), dispatch-plan banner from state, lane chips on active
  cards, ■ stop button, `/api/lanes` refreshed with every state fetch.
- **Docs**: `skills/queue.md` Console subsection (this PRD's user view);
  design/prd/plan/tdd-log under `docs/queue-live-board/`.

## Testing Decisions

- `scripts/queue-lanes.test.ts` (new, in `npm test`): beat merge/stamp,
  malformed skip, staleness derivation, stop-flag round-trip, clear.
- `scripts/queue-console.test.ts`: `stop-lane`/`reassign` dispatch,
  template contract (`/api/lanes`, new ops, `id="plan"`), server
  `/api/lanes` round-trip.
- Live curl smoke: columns, lanes JSON, stop-flag file, plan banner.

## Out of Scope

- Server-side agent spawning/killing (stays with `/loop` drivers).
- Cross-column drag status changes; per-task scoreboards; auth/TLS.
