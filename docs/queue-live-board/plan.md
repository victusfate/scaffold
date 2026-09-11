# Plan: Queue Live Board — vertical slices

## Slice 1 — Reassign: no-mutation dispatch refresh ✅
- `applyOp` `reassign` (ok, queue untouched, empty-queue ok) + audit log via
  existing handler path; header Reassign button + always-visible
  `continues/up-next` plan derived client-side (no API change).
- Tests: 4 dispatch + 2 template contract. Live curl smoke passed.

## Slice 2 — Lane heartbeats: sidecars + CLI ✅
- New `scripts/queue-lanes.ts` (beat/read/stale/clear/stop-flag); CLI
  `lane beat|list|clear|stop|go`; `step/model/tail/state` value flags.
- Tests: `queue-lanes.test.ts` (14 assertions, wired into `npm test`).

## Slice 3 — Live lanes on the server ✅
- `GET /api/lanes` (`laneViews` + staleness + stop flags); `stop-lane` op
  (validated, flag written by handler — archive-sidecar pattern); lane-dir
  SSE watch piggybacking the `changed` event.
- Tests: dispatch accept/reject + template `/api/lanes` presence + server
  round-trip.

## Slice 4 — Kanban board template ✅
- Column grouping (Queued drag-only; Blocked/In Progress/Done/Failed views),
  lane chips (worker/step/tail/stale/stop), ■ stop button, plan banner.
- Tests: template contract (ops, mount points, no exec verbs, asset-free).

## Slice 5 — Docs and discoverability ✅
- `skills/queue.md` Console subsection (board + Reassign + lanes + ■);
  `docs/queue-live-board/` design/prd/plan/tdd-log.
- Full gate: `npm test` suites, typecheck, lint 0 errors.

## Slice 6 — Dogfood demo (this branch) ✅
- Branch queue seeded: chain task, claimed lane w/ heartbeat, dep-blocked
  task, terminal-failed demo; `maxParallel 2`; console live on :8722.
- Demo tasks (`DEMO:` + task-004) removed before the PR; lane sidecars are
  git-ignored runtime state.
