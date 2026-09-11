# Work Queue

<!-- queue:config
status: running
interval: 1m
maxFailures: 3
leaseMinutes: 30
maxParallel: 2
integrationBranch: 
resumeAt: 
idlePoll: 20m
pausePoll: 30m
nextId: 10
-->

Order = priority (top first). Checkboxes: `[ ]` pending · `[>]` active · `[x]` done · `[!]` failed.
Edit this file freely to reprioritize, add, or remove work; the worker reads it every tick. Task lines and their indented fields survive; freeform prose is not preserved across worker writes.

- [ ] task-008 — DEMO: auto-fail B
  - validate: false
  - accept: terminal failed after 3 attempts
  - failures: 1
  - elapsed: 6s
  - note: demo auto-fail: intentional failure attempt
- [ ] task-004 — DEMO: auto-fail A
  - validate: false
  - accept: terminal failed after 3 attempts with elapsed banked
  - failures: 2
  - elapsed: 11m59s
  - note: demo auto-fail: intentional failure attempt
