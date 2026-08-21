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

## Slice 4 — console server: loopback HTTP + SSE
- Status: done
- RED: 14 server assertions (loopback bind, GET / html, /api/queue mirrors
  file, POST op mutates disk + returns state, 400 on execution verb /
  malformed JSON with file untouched, 404, archive op writes sidecar, SSE
  content-type + greeting).
- GREEN: server half of queue-console.ts (startServer, op handler, SSE with
  watcher detached on close); stub template; extracted shared
  scripts/queue-io.ts (queueFile/load/save/log/appendArchive) — the seam that
  also brings queue.ts back to 480 lines; test-queue-worktree.sh copy list
  updated for the new module.
- REFACTOR: applyOp doc comment re-anchored after helper insertion; body
  chunks decoded explicitly. 59+99 assertions, both queue shell tests,
  typecheck, lint 0 errors.

## Slice 5 — console page template
- Status: done
- RED: 21 contract assertions (mount points, all 10 op wirings, draggable,
  no execution verbs, no external assets).
- GREEN: full single-file page — status header with start/stop + config
  editors + archive + drain hint, add form with spec fields, task rows with
  chips (chain/deps/retries/owner/note/ready/deadlocked), drag reorder,
  requeue only where applicable, row-expanding editor, SSE refresh deferred
  behind a stale banner while editing/dragging (D8), error banner for 400s.
- REFACTOR: start/stop toggle rewritten to literal ops. 80/80 console
  assertions; live curl smoke-test against a temp queue passed.

## Slice 6 — docs and discoverability
- Status: done
- skills/queue.md: move/requeue in the command surface + Console section
  (management-only + DAG-guard contract stated). New files registered in
  .github/scaffold-files.txt (ship manifest gate caught them).
- Full gate: `npm test` all suites green incl. RESOLVER + manifest checks;
  typecheck clean; lint 0 errors (pre-existing warning baseline).
