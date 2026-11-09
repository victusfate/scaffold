# Work Queue

<!-- queue:config
status: running
interval: 6m
maxFailures: 3
leaseMinutes: 30
maxParallel: 2
integrationBranch: 
deliveryMode: per-task
deliveryTask: 
deliveryAccepted: false
resumeAt: 
idlePoll: 20m
pausePoll: 30m
nextId: 10
-->

Order = priority (top first). Checkboxes: `[ ]` pending · `[~]` parked (work exists on its branch, no lane on it) · `[>]` active · `[x]` done · `[!]` failed.
This file is rendered from the queue store (queue.db). Edit it freely to reprioritize, add, or remove work, then run `node scripts/queue.ts import` to apply it; until then the queue refuses to overwrite your edits. Task lines and their indented fields survive; freeform prose is not preserved.

