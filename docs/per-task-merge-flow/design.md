# Per-task merge flow

Independent queue tasks currently finish into a long-lived branch. This defers
integration failures until many features have accumulated. The default delivery
unit will be one independently useful task and one PR/merge cycle.

The root orchestrator integrates subtasks, validates locally, creates/updates the
PR, verifies real hosted results, merges only with standing or session authority,
and creates a fresh branch before advancing. Permission to create a PR is not
permission to merge. Without merge authority, preserve the ready PR and wait.

Runtime boundary: the queue stores a delivery-task latch on claim. Selection and
claims cannot cross that latch, even after done, failure, archive, or restart.
An explicit `advance` acknowledgment clears it after the orchestrator records
merge and fresh-branch evidence. This is an audited acknowledgment, not a GitHub
permission/CI verifier. The orchestrator owns external verification.

`deliveryMode: batch` is an explicit compatibility opt-in. Missing configuration
means per-task, including existing stores. Existing active tasks are retained and
must be reconciled, never cancelled. Parallel agents implement subtasks of the
current task, not separate queued features. Acceptance is never narrowed merely
to report incomplete work done.
