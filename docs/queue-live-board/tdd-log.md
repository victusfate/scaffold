# TDD Log: queue-live-board

## Slice 1 — reassign (no-mutation dispatch refresh)
- Status: done
- RED: 6 failures (dispatch accept/untouched ×3, empty-queue, `id="plan"`,
  `op: "reassign"` wiring).
- GREEN: `reassign` case in `applyOp` (+ Op union); header Reassign button +
  plan banner derived client-side; design.md D3 records the no-API-change
  choice. 92/92 console assertions green; curl smoke (state + audit log +
  button) passed.
- REFACTOR: none — 3-line server delta, plan math lives in the template.

## Slice 2 — lane sidecars + CLI
- Status: done
- RED: module-not-found (new `scripts/queue-lanes.ts`).
- GREEN: beat/read/stale/clear/stop-flag module (14/14); CLI
  `lane beat|list|clear|stop|go`; fixed `step/model/tail/state` missing from
  the `parse` value-flag set (beats silently dropped step until then —
  caught live, not by the suite).
- REFACTOR: none; new module is 100 lines with one home per helper.

## Slice 3 — server lanes + stop-lane
- Status: done
- RED: 4 failures (dispatch accept/untouched, `/api/lanes` fetch, op wiring).
- GREEN: `laneViews`, `GET /api/lanes`, `stop-lane` validation + handler-side
  flag write, lane-dir SSE watch (shared `changed` event). 95/95 green.
- REFACTOR: handler flag write follows the archive-sidecar pattern so
  `applyOp` stays pure.

## Slice 4 — kanban template
- Status: done
- GREEN (with slice 3): column grouping, Queued-only drag with global-index
  mapping, lane chips, ■ stop button, `/api/lanes` co-fetch. 97/97 green.
- Note: `li` → `.card` scoping in renderTasks (column `<li>`s no longer
  match card queries).

## Slice 5 — docs
- Status: done
- `skills/queue.md` Console subsection; design/prd/plan/tdd-log committed.

## Full gate
- `queue.test` 124/124 · `queue-console.test` 97/97 · `queue-lanes.test`
  14/14 · `queue-edit` + `queue-lock` PASS · `tsc --noEmit` clean ·
  `eslint` 0 errors (warnings at baseline + new-file magic-number notes).
