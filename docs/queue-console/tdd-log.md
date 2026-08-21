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
