# TDD Log: queue-console

Granularity note: 6 slices per plan.md, auto-confirmed (autonomous chain —
queued-task contract, no interactive gates).

## Slice 1 — moveTask + CLI `move <id> <pos>`
- Status: done
- RED: 9 assertions (head/middle/last, clamp both ends, unknown-id no-op,
  relative order, field integrity, round-trip).
- GREEN: `moveTask` in queue-model.ts; `move` command (1-based) in queue.ts;
  usage header + unknown-command list updated. 91/91 model tests pass.
- REFACTOR: none needed — mirrors moveToTop/top idioms; scores 10/10.

## Slice 2 — requeueTask + CLI `requeue <id>`
- Status: done
- RED: 8 assertions (failed reset, retrying-pending reset, clean no-op,
  unknown-id no-op, position kept, round-trip).
- GREEN: `requeueTask` in queue-model.ts; `requeue` command in queue.ts with a
  polite nothing-to-revive path. 99/99 model tests pass.
- REFACTOR: none needed; scores 10/10.

## Slice 3 — console core: ConsoleState + applyOp (typed dispatch)
- Status: done
- Scope grew mid-slice by user direction: applyOp also guards the dependency
  DAG (unknown dep, self-dep, cycle, remove-with-unfinished-dependents all
  rejected) so the software interface — not agent discipline — protects the
  queue. Recorded as design.md D5a.
- RED: 45 assertions (state shaping, 10 op happy paths, 11 rejection paths,
  8 DAG-integrity paths). GREEN: scripts/queue-console.ts pure core;
  queue-console.test.ts wired into `npm test`.
- REFACTOR: dispatch flattened to per-op cases with a shared unknownId guard
  (also fixed a TS narrowing error). Note for code-refiner: my additions
  nudged queue-model.ts (535) and queue.ts (507) over the 500-line signal —
  split at a seam there, not cram.
