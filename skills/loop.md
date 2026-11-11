## Native first

Use `/loop <interval> <instruction>`, `/loop status`, `/loop stop`, or `/loop stop --cancel`.
Prefer the harness's exposed native recurring command or session wakeup when it supports the request.
Claude Code's built-in loop takes precedence; on pi, use native recurrence only when actually available.
Capture the contract below, then use that scheduler's real start, status, steering, and stop controls.
For editing, require serial runs in the checkout; inspect existing status before arming another recurrence.
Record the actual scheduler ID, lifetime, cadence, overlap behavior, and stop method after verifying startup.
Treat a session-bound scheduler as session-bound; claim no persistence or capabilities its tools do not supply.
When native recurrence suffices, apply the shared rules below without loading the external-driver reference.
Only when native support is absent/insufficient, or survival after session closure is requested, read
[external driver and continuity](loop/reference.md) before configuring that fallback.
For status or changes to an existing external loop, read that reference and use the recorded driver.
Follow [session and process ownership](../AGENTS.md#session-and-process-ownership) for all lifecycle actions.

## Capture the contract

Text after the interval is an agent instruction, not shell code; use argv mode only for an explicit command.
Preserve quotes and multiline text as one argument; never interpolate instructions into `eval` or `sh -c`.
Resolve the checkout, active branch, interval, execution limits, existing authorization, and completion condition.
Capture the agreed objective, next tasks, artifact/handoff paths, branch, permissions, and requested queue fallback.
Use the repo's durable handoff convention and preserve unrelated handoffs; include the snapshot in the scheduled prompt.
A fresh CLI run inherits neither chat memory nor native subagent handles; make its instruction self-contained.
Continue useful authorized work during each run; an interval restarts ended work rather than pacing live work.
Recurrence belongs to the recurring agent; subagents return scheduling requests to it and receive bounded assignments.
Use the queue's skill and CLI for requested queue work; the loop is a driver, not a replacement queue.

## Topology tick

`.agent/topology.json` (consumer-owned; schema `lib/topology.schema.json`, reader `node scripts/topology.ts`)
names the orchestrator, the tick cadence and the subagent **slots**, with no routing: the orchestrator judges which
task suits which slot. Swapping resources edits that file, never the scheduled prompt. Each tick:

1. Read and validate the topology; an invalid file is a blocker to report. No file: orchestrator only.
2. For each slot whose task finished, review it, integrate or ship it within existing authorization, and set the
   task status (`done`, `fail`, or `park --resume "<next step>"`).
3. For each free slot (no `[>]` task owned by its id), claim the highest-priority task it suits with
   `node scripts/queue.ts claim <id> --worker <slot-id>` and start that slot's harness/model in its own worktree.
   Leave a slot free rather than send it a task it should not take.
4. Reconcile (below). An active task whose owner is not a slot id is orphaned: adopt it into a free slot or park it.

The queue console's Slots panel reads the same file plus task status, so it is only as true as this bookkeeping.

## Reconcile lanes before dispatch

Compare current-session live subagent handles, queue `[>]` tasks, and `git worktree list` every run.
A subagent that replied and went idle is not a running lane; resolve each mismatch before spawning more work:

- Active task without a running subagent: resume it, or park it with
  `node scripts/queue.ts park <id> --branch <b> --resume "<next step>"` to preserve work and release ownership.
- Running subagent without an active task: claim its task or stop that owned assignment.
- Worktree without a task or subagent: integrate, park, or clean it under the repository's branch rules.
- End each run with the active-task count matching the live subagent count.

Treat the topology's slot list as the ceiling on concurrent subagents; respect client slots, host limits, and the repo's memory guard.
Launch long jobs nonblockingly; retain owned identifiers/logs and inspect progress at safe boundaries.
Bound retries, keep independent work moving, and refresh concrete next steps after each run.

## Steering, status, and completion

Route relevant user corrections to the active loop by default; confirm the intended checkout before delivery.
Status questions are read-only; explicit stop/cancel requests use those controls instead of steering.
Use native steering when supported; for an external loop use the reference's inbox protocol.
Report a queued message as queued until the recurring agent adopts it; report unsupported delivery explicitly.
At the next safe boundary, apply the latest conflicting user direction before resuming the older agenda.
Retask affected subagents, update the handoff, and report a real blocker instead of continuing superseded work.
At completion or a blocker needing user direction, checkpoint and end recurrence with that outcome.
Inspect productive progress as well as scheduler status; changing configuration requires stop, wait/cancel, then restart.
Explain whether stop lets current work finish or cancel interrupts it, and verify termination before returning the checkout.
A user-stopped loop stays stopped until the user requests recurrence again.
