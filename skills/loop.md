## Purpose

Run an instruction or explicit command repeatedly using a real scheduler outside
the model's turn. Use for `/loop <interval> <instruction>`, `$loop`, recurring
agent work, and loop status/stop requests. This is an execution driver, not a
replacement for the queue skill or a promise to remember to continue.

## Invocation

```text
/loop 10min continue working on agreed upon tasks, sending jobs to 1 gpu lane
and up to 3 cpu lanes, merging in worktrees as they complete and managing
subagents to ensure they don't get stuck. If nothing else is pressing review
the work queue for tasks and keep grabbing work from there following its
interface and usage docs

/loop status
/loop stop
/loop stop --cancel
```

In Codex, select `$loop` or use `/skills`. In pi, use the discovered skill or
explicitly load `.agents/skills/loop/SKILL.md` with its skill-loading option.
A harness-native `/loop` command takes precedence; do not override it. Read
linked files explicitly when the harness does not expand `@` imports.

## Capture the contract

Text after the interval is an **agent instruction**, not shell code. Use argv
mode only for an explicitly requested command. Preserve quotes and multiline
instructions; never interpolate them into `eval`, a shell script, or `sh -c`.

Resolve the checkout, active branch, harness executable, interval, and existing
authorization. Capture a self-contained instruction: agreed objective, next
tasks, artifact/handoff paths, branch, validation/publication permissions, and
completion condition. Use the repo's durable handoff convention, preserving any
unrelated handoff. Include this snapshot in the scheduled prompt; a fresh CLI
session does not inherit chat memory or native subagent handles.

Before the first external run, finish/checkpoint the current edit and transfer
checkout ownership: the parent session stops editing that checkout once the
driver starts. Finish native subagent lanes first, or record independently
surviving process IDs, worktrees, and logs that the next run can reconcile. To
resume interactive edits, stop the loop and wait for the current run to finish
(or explicitly cancel it). Status-only check-ins do not require stopping it.
Put the exact helper path, checkout, and `stop --cwd <checkout>` invocation in
the child prompt so the child can stop its own future runs without guessing.

Include these execution instructions in the agent prompt:

- Stay within agreed tasks and the explicitly requested queue fallback. Do not
  infer additional projects, publication authority, or permission to restart a
  stopped queue.
- Read repo instructions and the recorded handoff. If the recorded branch
  changed, stop the loop and report before editing.
- Work continuously during each run; the interval restarts an ended run, not
  permission to stop after one small action while useful work remains.
- Reconcile existing processes and worktree lanes before spawning. Do not
  duplicate surviving jobs or reclaim live leases. Do not start a second
  orchestrator while a human/session is editing the same checkout.
- Requested lane counts are ceilings. Respect actual client slots and host
  limits; use the repo's memory guard for heavy jobs. A timeout is not a RAM cap.
- Inspect stuck jobs using logs, elapsed time, and process state. Bound retries,
  keep independent work moving, and never loosen permissions or kill unrelated jobs.
  Launch long jobs nonblockingly, retain their identifiers/logs, and inspect them
  periodically while remaining responsive to steering.
- If queue draining was requested, follow its skill and CLI for claims and
  completion, not direct queue-file edits or a replacement queue.
- Integrate completed worktrees into the one active branch, validate, checkpoint,
  and publish only within authorization. Refresh concrete next steps each run.
- At the completion condition or a blocker requiring user direction, checkpoint
  and stop future runs. Exit zero alone does not prove the objective complete.

## Select and arm a driver

Use an exposed native recurring scheduler if it supports the requested behavior.
For editing jobs it must prevent overlapping runs in the same checkout; otherwise
use the external driver or report the unsupported requirement.
Record its actual ID, lifetime, overlap behavior, and stop method. Do not claim
session persistence unless provided. Never arm two drivers for the same work.
Check existing driver status first. Report whether native recurrence is fixed
cadence or completion-relative and give the child a supported self-stop mechanism.
When the user needs an external driver and native scheduling is session-bound
or absent, use the external fallback.

### Linux/WSL external fallback

Requires Node >=23.6 and a working systemd **user** manager. No boot service,
lingering, global settings, permission changes, or paid agent calls as probes.
Unsupported hosts fail explicitly; do not substitute chat-local sleeps.

```text
node scripts/agent-loop.ts start --cwd /absolute/checkout --interval 10min --lifetime 8h --timeout 30min --max-failures 3 -- EXECUTABLE ARG...
node scripts/agent-loop.ts status --cwd /absolute/checkout
node scripts/agent-loop.ts logs --cwd /absolute/checkout
node scripts/agent-loop.ts stop --cwd /absolute/checkout
node scripts/agent-loop.ts stop --cwd /absolute/checkout --cancel
```

Use the absolute helper path outside the scaffold-synced repo. Full scaffold
sync ships the helper and modules; skill-only hoist may not. Verify the helper
exists before scheduling. Never claim an unwired wrapper works.

For natural language, inspect installed CLI help and build headless argv.
Typical forms: `codex exec -- <instruction>` or `pi --print -- <instruction>`.
Pass the captured prompt as one argument. Preserve selected repo/model settings;
do not add permission, trust, or sandbox bypass flags. The helper pins the CWD.
An explicitly selected session can be resumed with supported options; never use
a global “latest session” selector that might pick unrelated work.

Explain defaults when arming unless the user supplied alternatives:

- First run starts promptly; the next starts one interval after completion.
  Long runs do not overlap or accumulate a backlog.
  This is a restart delay, not an independent 10-minute watchdog polling an
  active agent. The active agent manages its workers; the timeout bounds a hang.
- Lifetime 8h, per-run timeout 30min, stop after three consecutive failures.
  Lifetime prevents new runs after expiration; a run already active may finish
  afterward within its own timeout.
  Choose a longer explicit timeout for known long jobs. Timeouts can interrupt
  work. Semantic stagnation needs agent judgment; the driver sees exit codes.
- Survives chat/terminal closure while the user manager runs, not reboot/WSL
  shutdown. Does not wake the computer or run without CLI authentication.
- Stop disables future runs; current work finishes. `--cancel` also terminates
  the current service's process tree. Explain that distinction before cancelling.
- Private state includes argv and logs. Keep credentials out of prompts/argv
  and sensitive command details out of public status updates.

After start succeeds, immediately call `status`. Report the actual unit ID,
checkout, interval, expiration, timeout, logs and stop commands. If startup or
verification fails, report **not armed** and resolve the specific failure within
scope. Never claim background execution without verified driver state.

## Status, changes, and stopping

Status/log requests are read-only: never create or restart a timer. Use the
recorded driver. Active scheduling does not prove productive progress; inspect
recent job output too. To change configuration, stop future runs, wait for or
explicitly cancel current work, then start anew. Do not overwrite an active
configuration. Disabling future runs is immediate and must not be auto-rearmed.
The current run may still claim new tasks until it ends or times out; use explicit
cancellation when the user wants all current work stopped too.
