## Purpose

Run an instruction or explicit command repeatedly using a real scheduler outside
the model's turn. Use for `/loop <interval> <instruction>`, `$loop`, recurring
agent work, steering an active loop, and loop status/stop requests. This is an execution driver, not a
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
- Recurrence belongs to the main orchestrator by default. Subagents receive
  bounded assignments and are monitored, retasked and joined by that agent;
  they do not arm independent loops. A worker asked to schedule recurrence
  returns that request to its parent rather than starting another driver.
- Read the steering inbox at run start and each safe work boundary (when a tool
  or worker result returns), before dispatching more work, before publishing,
  and before exiting. Apply new direction before resuming the older agenda.
  Retask affected workers, update the durable handoff, then acknowledge each ID
  with its disposition. Only the main orchestrator consumes steering; workers
  follow its assignments. Include the exact `inbox` and `ack` commands below in
  the captured prompt, using the absolute helper and checkout paths.
- User steering always supersedes conflicting captured loop instructions, queue
  priorities and worker assignments, subject to higher-priority safety rules.
  Process messages in receipt order; the latest user direction wins when they
  conflict. Stop dispatching conflicting work and retask affected workers at the
  next safe boundary. Do not defer steering just to finish the old agenda or wait
  for another interval. An in-flight tool may need to return or an atomic write
  finish safely, but do not resume superseded work afterward. A real blocker
  requires a report, not silent continuation of the old instruction.
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

### Portable external fallback

Requires Node >=23.6 on macOS, Linux/WSL, or native Windows. A detached Node
supervisor runs outside the chat and launches commands serially. No systemd,
launchd, Task Scheduler, boot installation, global settings, permission changes,
or paid agent calls as probes. Unsupported hosts fail explicitly.

Schedule foreground commands that keep their parent alive until workers finish.
Non-overlap applies to those command runs, not arbitrary detached services. On
Windows, tree cancellation requires the command parent to still be alive; a
launcher that spawns background work and exits is unsupported. Independently
detached jobs must have their own lifecycle controls and be reconciled by the
agent, not assumed covered by the supervisor's timeout. Do not use a fire-and-forget
launcher as the recurring command.

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
On Windows use an actual `.exe`, or `node.exe` plus the installed CLI's JavaScript
entrypoint. A `.cmd`/`.bat` shim is not an executable argv target without shell
parsing. Do not silently enable a shell to run agent instructions through a shim.
Pass native absolute paths on Windows, for example `C:\\work\\project`; the
POSIX paths above are placeholders, not required path syntax.

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
- Survives chat/terminal closure while the supervisor lives, not reboot/WSL
  shutdown or a supervisor crash. Does not wake the computer or run without CLI
  authentication. Stale/crashed ownership is reported rather than auto-reclaimed;
  inspect remaining jobs before a deliberate recovery.
- Stop disables future runs; current work finishes. `--cancel` also terminates
  the current command's process tree. Explain that distinction before cancelling.
  Stop returns after recording the request. Poll status until `ended` before
  claiming cancellation finished or handing the checkout back to interactive work.
- Private state includes argv and logs. Keep credentials out of prompts/argv
  and sensitive command details out of public status updates.

After start succeeds, immediately call `status`. Report the actual supervisor ID/PID,
checkout, interval, expiration, timeout, logs and stop commands. If startup or
verification fails, report **not armed** and resolve the specific failure within
scope. Never claim background execution without verified driver state.

## Status, changes, and stopping

### Steering is routed by default

When an interactive user sends a task correction while this checkout has an
active loop, route it to that loop by default. Do not require `/loop steer` or
a restart. First inspect the recorded driver's status and confirm the intended
checkout. Enqueue the user's relevant direction without broadening its scope,
then report the returned message ID as **queued**, not already applied. Status
questions alone are not steering; explicit stop/cancel requests use those controls.
Do not edit the loop-owned checkout to deliver a message.
If several checkouts have active loops, route only to those clearly placed in
scope by the user; ask which one when ambiguous rather than broadcasting.

```text
node /absolute/scaffold/scripts/agent-loop.ts steer --cwd /absolute/checkout --message "Keep the slide torso more vertical"
node /absolute/scaffold/scripts/agent-loop.ts steer --cwd /absolute/checkout --message-file /private/steering.txt
node /absolute/scaffold/scripts/agent-loop.ts inbox --cwd /absolute/checkout
node /absolute/scaffold/scripts/agent-loop.ts ack --cwd /absolute/checkout --id MESSAGE_ID --outcome applied
node /absolute/scaffold/scripts/agent-loop.ts ack --cwd /absolute/checkout --id MESSAGE_ID --outcome deferred --note "Finish the current atomic export, then adjust the pose; recorded in handoff"
node /absolute/scaffold/scripts/agent-loop.ts inbox --cwd /absolute/checkout --all
```

Use one message source, not both. Preserve text as data, never shell source.
Prefer a private message file for long/sensitive text; command arguments can be
visible in process listings. Inbox storage is outside the checkout. Default reads
return unacknowledged messages for the current generation without consuming them;
`--all` explicitly inspects history, including prior generations. Messages survive
run boundaries until acknowledged, so handle redelivery idempotently. Acknowledge
only after adopting the direction in the working plan/handoff, not on mere read.
`applied` means direction adopted, **not** that the requested deliverable is done.
`deferred` and `blocked` require an explanatory note and must remain visible in
the handoff/work queue. Deferral is for an unavoidable safe boundary, not lower
priority than older work. Record superseding direction before acknowledging it.
Do not silently replay an old generation after a restart.
The CLI refuses restart while the previous generation has unacknowledged
steering. Inspect its inbox first, incorporate applicable direction into the new
handoff/prompt (or record why the user superseded it), then acknowledge that
disposition. This prevents recovery from silently returning to the old agenda.

This is cooperative delivery, not a native chat interceptor. It cannot preempt an
in-flight tool call. The chat agent must enqueue the update, and the main worker
must have the polling instructions in its launch prompt. Do not silently alter
arbitrary executable argv to add agent behavior. For a native scheduler, use its
actual steering mechanism if available; otherwise report that steering delivery
is unsupported. For an older already-running prompt without inbox polling,
queueing alone is insufficient: report the limitation and use the existing
stop/wait/handoff procedure before a deliberate restart. Never rearm a user-stopped
loop. Do not claim automatic delivery is active until the recipient can poll.

### Configuration changes

Status/log requests are read-only: never create or restart a timer. Use the
recorded driver. Active scheduling does not prove productive progress; inspect
recent job output too. To change configuration, stop future runs, wait for or
explicitly cancel current work, then start anew. Do not overwrite an active
configuration. Disabling future runs is immediate and must not be auto-rearmed.
The current run may still claim new tasks until it ends or times out; use explicit
cancellation when the user wants all current work stopped too.
