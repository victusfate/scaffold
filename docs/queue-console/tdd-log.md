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
