# Requirements

- Default queue dispatch runs one independent task through its delivery cycle.
- Persist the selected task independently of live/archived task records.
- Retry the current task after validation failure; block unrelated dispatch.
- CLI tick/ready/claim/begin, drain signals, and console claims share the gate.
- Done means implementation accepted; merged means the PR actually merged.
- Advancing requires an explicit root acknowledgment with PR and fresh branch.
- Batch mode deliberately restores existing fan-out and completion semantics.
- Document migration, authorization, real validation, and enforcement limits.

Verify model behavior and real CLI/store lifecycle, retain legacy batch coverage,
and run repository unit/integration suites, lint and typecheck before publishing.
