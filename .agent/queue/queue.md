# Work Queue

<!-- queue:config
status: running
interval: 6m
maxFailures: 3
leaseMinutes: 30
maxParallel: 1
integrationBranch: 
resumeAt: 
pausePoll: 30m
-->

Order = priority (top first). Checkboxes: `[ ]` pending · `[>]` active · `[x]` done · `[!]` failed.
Edit this file freely to reprioritize, add, or remove work; the worker reads it every tick. Task lines and their indented fields survive; freeform prose is not preserved across worker writes.

