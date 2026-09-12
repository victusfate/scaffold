## Slice 1 — Two-console isolation test
- Status: done
- Notes: GREEN with no production change — per-file locks/sidecars/lanes and
  single-file console binding already isolate. 13 assertions, real HTTP against
  two real servers, disk contents as ground truth. Identical task-001 ids in
  both files used as the sharpest probe.
