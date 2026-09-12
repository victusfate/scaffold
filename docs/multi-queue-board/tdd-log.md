## Slice 1 — Two-console isolation test
- Status: done
- Notes: GREEN with no production change — per-file locks/sidecars/lanes and
  single-file console binding already isolate. 13 assertions, real HTTP against
  two real servers, disk contents as ground truth. Identical task-001 ids in
  both files used as the sharpest probe.
## Slice 2 — Runbook + test wiring
- Status: done
- Notes: RED verified by absence (no `queue-isolation` reference in `package.json`,
  no two-console paragraph in `skills/queue.md`). GREEN: test chain entry added,
  runbook paragraph in Console subsection. No production change.
