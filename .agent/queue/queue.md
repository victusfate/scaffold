# Work Queue

<!-- queue:config
status: running
interval: 6m
maxFailures: 3
leaseMinutes: 30
maxParallel: 2
integrationBranch: 
resumeAt: 
idlePoll: 20m
pausePoll: 30m
nextId: 8
-->

Order = priority (top first). Checkboxes: `[ ]` pending · `[>]` active · `[x]` done · `[!]` failed.
Edit this file freely to reprioritize, add, or remove work; the worker reads it every tick. Task lines and their indented fields survive; freeform prose is not preserved across worker writes.

- [x] task-001 — Lane heartbeat sidecars + GET /api/lanes
  - mode: chain
  - slug: queue-live-board
  - accept: active tasks show worker, elapsed, step and tail on the board
  - elapsed: 14s
- [ ] task-003 — Docs: Console subsection + live-board artifacts
  - held: true
  - deps: task-001
  - accept: skills/queue.md documents Reassign; docs/queue-live-board has prd/plan/tdd-log
- [ ] task-004 — DEMO: stuck widget (will fail)
  - accept: demo
  - failures: 1
  - elapsed: 11m22s
  - note: needs-spec: title 'DEMO: stuck widget (will fail)' has no concrete end state; accept 'demo' is not checkable; no mode/files/validate to resolve from codebase
