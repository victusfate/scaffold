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

## Slice 7 — Drag-and-drop into lanes ✅
- Model `unclaimTask` (active → pending, lease cleared, position kept).
- Ops `claim-lane` (first free `lane-N`, capacity-checked, lease stamped;
  explicit steer may claim a dep-blocked task) and `release` (active only).
- Template: free-slot placeholder in In Progress, column + card drop routing
  (Queued→Queued move incl. drop-to-end; pending→In Progress claim;
  active→Queued release with optional reorder in the same gesture),
  everything else a no-op.
- Tests: 5 model + 9 dispatch + 3 template contract; live curl triple
  (claim → capacity-400 → release, order preserved).

## Slice 8 — Every column a drop target ✅
- Model: `held` field (parse/serialize/`set`able), `isEligible` skips held,
  `holdTask`/`forceFail`/`reopenTask`; CLI `hold`/`unhold` + `claim` refuses
  held (else Pattern-B workers bypass the park).
- Ops `hold`/`unhold`/`mark-done` (CLI `--skip-validate` twin incl. archive
  sweep)/`force-fail` (lease cleared, operator note)/`reopen`;
  `claim-lane` refuses held (router unholds first when implied).
- Template: async `dropOf` matrix router, all-column dragover, `held` chip.
- Drag reliability: whole-body grab guard, `setData` (Firefox drop), window
  `dragend` fallback against stuck gestures.
- Tests: 9 model + 17 dispatch + 6 template; gate green; live matrix on
  scratch tasks (hold/unhold/claim-guard/claim/fail/requeue/done→archive).
