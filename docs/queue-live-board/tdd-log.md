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

## Slice 7 — drag-and-drop into lanes
- Status: done
- RED: 6 failures (claim slot assignment ×2, release ×2, op wiring ×2).
- GREEN: `unclaimTask` in queue-model; `claim-lane`/`release` in applyOp
  (server-assigned `lane-N`, capacity guard, explicit-now param for
  determinism); template `dropOf` router + slot placeholder + valid-target
  dragover gating; 129/129 model, 109/109 console green; live triple verified
  against :8722 (claim stamps lane-1, full → 400, release keeps order).

## Slice 8 — every column a drop target + drag reliability
- Status: done
- RED: 13 dispatch failures (hold/done/fail/reopen) + 4 op-wiring + model
  export-not-found (then 9 model asserts green after the model landed).
- GREEN: `held`/`holdTask`/`forceFail`/`reopenTask`; CLI hold/unhold +
  claim-held guard; ops hold/unhold/mark-done/force-fail/reopen (+held guard
  on claim-lane); async matrix router; 138/138 model, 135/135 console.
- Drag reliability (user-reported): whole-body grab, `setData` for Firefox,
  window `dragend` fallback (a missed dragend stuck `draggingId` and froze
  auto-refresh behind the stale banner).
- Live matrix on scratch tasks via :8722: hold→Blocked, claim-held→400,
  unhold, claim, force-fail, requeue, mark-done→archive; scratch removed.

## Slice 9 — design pass: dispatch control-room
- Status: done
- Direction: dark-first instrument panel — serif-italic masthead + mono
  readout chips, per-column signal lamps (dot + card spine), blueprint grid
  texture + vignette in pure CSS, sticky blurred header, pulsing run lamp.
- Motion restrained on purpose (board re-renders live): hover lifts,
  drop-target glow while dragging, lamp pulse — all off under
  `prefers-reduced-motion`. No webfonts/downloads (offline-tool constraint
  wins over the font guidance); asset-free suite assertion still green.
- Tests untouched in behavior: 135/135 green.

## Slice 10 — agent time tracking
- Status: done
- Decision (user-steered): cumulative seconds in the model over log parsing
  — banked in-transaction with the status flip, durable in committed
  `queue.md`, testable pure rule; archive lines carry totals past sweep-out.
- Display per user call: raw seconds under a minute, whole minutes above
  (no hours tier).
- RED: missing exports + unmigrated call sites; GREEN: `elapsedSecs` +
  grammar/exact/scan formatters + `bankSession` in 4 session-ending ops
  (markDone/recordFailure/unclaimTask/forceFail, all clock-explicit);
  CLI + gates + console call sites migrated; ⏱ chip (live session folded
  in), `list` tags, archive carry.
- Gate: 152/152 model, 141/141 console, typecheck, lint 0 errors; live loop
  verified (claim → fail banks `3s` end to end, archived demo removed).

## Full gate
- `queue.test` 124/124 · `queue-console.test` 97/97 · `queue-lanes.test`
  14/14 · `queue-edit` + `queue-lock` PASS · `tsc --noEmit` clean ·
  `eslint` 0 errors (warnings at baseline + new-file magic-number notes).
