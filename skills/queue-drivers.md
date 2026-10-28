# Queue driver setup

Supporting reference for [the queue skill](queue.md); its delivery cycle applies
to every driver below.

## Integration cleanup (all delivery modes)

The orchestrator cleans up each completed lane at integration, before replacement dispatch:

1. Verify that the session-owned native subagent or tracked child actually ended.
   Review and integrate its needed source; preserve unique logs, measurements,
   provenance and other evidence in a durable archive with an index linking the
   task, commit/PR and artifact locations. Treat reproducible outputs and duplicate
   reports as disposable only after confirming they contain no unique evidence.
2. Inspect tracked, untracked and ignored worktree content before removal. Remove
   the preserved worktree through `queue worktree remove <id>` while its recorded
   path is available (or the owning harness/git worktree command for native lanes).
   Retire the merged local lane branch only after verifying no unique commits or
   evidence would be lost. Never force-delete an unreviewed worktree or branch.
3. Finalize acceptance separately: `done` only for accepted scope, `fail` for
   a real failure, owned `release` for partial work. These persisted transitions
   clear ended heartbeat/stop sidecars automatically. For an ended lane whose task
   remains recorded, `queue lane clear <id>` clears display sidecars only; it does
   not accept the task or release its claim. It requires a known task ID;
   it is not an orphan-file sweep. Never clear a live subagent's display to fake progress.
4. After the authorized main merge and fresh-branch checkout, verify the task
   branch has no unique commits before retiring it. With squash/rebase merges,
   inspect commit differences and resulting content; ancestry does not prove
   preservation. Preserve anything unique before any deliberate deletion.
   Record the disposition and durable evidence links in the task handoff/index.

Keep generated local stores, heartbeat/status files and disposable outputs ignored.
Keep active-task scope, unresolved blockers, dependencies and links to prior
evidence in the tracked handoff and working context; archive completed narrative
instead of repeatedly loading it. Keep completed dependency records that unfinished
work still requires; never erase acceptance or provenance to reduce context.

Staleness alone never authorizes killing a process, marking a task done, or deleting
another session's artifacts. Apply [session isolation during recovery](queue.md#session-isolation-during-recovery)
to ambiguous ownership. This is orchestrator-owned lifecycle guidance using existing
commands, not an automatic cleanup daemon.

## Legacy fan-out (explicit `deliveryMode: batch`)

Only after explicitly selecting batch mode, set `queue config maxParallel 3` to
run independent tasks concurrently, each in its own git worktree. Two patterns,
same primitives:

**Pattern A — in-session batch fan-out.** On each wake the orchestrator:
1. `node scripts/queue.ts ready` → the eligible set under the cap.
2. For each returned task: `queue worktree add <id>` (isolated checkout on
   `queue/<id>` off the integration branch), then dispatch a **subagent** to
   execute it in that worktree under the same contract.
3. The subagent commits locally and reports its exact tip, checks, evidence and
   remaining original scope. Before returning, it runs `queue lane finish <id>
   --worker <exact-owner> --tail <result-summary>` in the owning queue checkout.
   This records `awaiting-review`; it does not accept the task or release its claim.
4. The orchestrator verifies the owned native handle is terminal, or its tracked CLI child
   exited with a valid result. Native `completed` means execution ended, not scope
   acceptance. Claude, Codex and pi use this same contract; hooks may notify the
   orchestrator but never independently merge, publish or reclaim.
5. The orchestrator reviews and integrates passing commits into the one working branch,
   runs gates, then preserves evidence and removes the worktree per
   [integration cleanup](#integration-cleanup-all-delivery-modes). Only then finalize: `done` for full
   accepted scope, `fail` for a genuine failed attempt, `release <id> --worker <exact-owner>` for partial
   work. These transitions clear ended heartbeat and stop metadata after commit.
6. Record preserved evidence and branch/worktree disposition before replacement
   dispatch. Never force-delete unpreserved content. At every dispatch/wake, reconcile completed owned handles first; an
   unprocessed terminal result is pending work, not an idle subagent.

Record task ID, exact queue owner, creating session, harness, native handle or
CLI run, worktree, branch and original acceptance at dispatch. Recover missing
handles only under [session isolation during recovery](queue.md#session-isolation-during-recovery). Never infer termination
from claim age, heartbeat age or a process name. Reconcile a subagent that crashes
before `lane finish` from the owned handle, not by waiting for a lease.

**Pattern B — multiple independent sessions (explicit `batch` mode only).** Many loop sessions/crons
each `queue claim <id> --worker <name>` (atomically acquire the queue record), work
their own worktree, and merge back. A queue-record claim grants no process authority.
An expired lease blocks automatic dispatch until its creating orchestrator or an
operator explicitly resolves it. Use this to drain faster or across machines.

Merge-back is intentionally **not** a CLI auto-merge: the queue provides
isolation (`worktree add`/`remove`) and leaves integration to a judgment-applying
agent, per this repo's "liveness/veracity" and D7 principles.

## Running it: work-driven, not clock-driven

Keep the queue **continuously busy**; a fixed timer is a fallback, not the pacer.
Start the next task only after completing the current delivery cycle.

**Drain continuously in-turn.** Don't sleep between tasks; loop until the queue is
empty:

```
tick → execute → done → PR → validate → authorized merge → fresh branch → advance → tick → …   (no delay between tasks)
```

The commit per task is the checkpoint (AGENTS.md continuous execution), so a crash
resumes; the interval only matters when there's nothing to do.

**Branch the next cadence on `tick`'s exit code** (so you never pick an interval):

| `tick` / `ready` exit | Meaning | Next action |
|---|---|---|
| `0` | a task was dispatched | do it, then loop **immediately** |
| `3` | idle — queue drained, nothing eligible | **terminate the loop** (`ScheduleWakeup stop:true`) **when a signal-polling Monitor is armed** — it re-wakes the loop only when a later `add` makes work drainable, so nothing stalls and **no loop fires on an empty queue**. Only if you could not arm a Monitor, **re-arm the heartbeat** at config **`idlePoll`** (default 20m) as the fallback (it must poll, so it may wake on an empty queue) |
| `4` | paused for a usage window | slow-poll at config **`pausePoll`** (default 30m); auto-resumes when the window reopens |
| `5` | stopped (manual) | halt until `queue start` |
| `6` | ownership conflict | resolve explicitly without reclaiming another session |
| `7` | delivery pending | finish current PR/merge cycle; acknowledge with `advance` |

The three fallback cadences are editable config: `interval` (fixed one-tick
loops), `idlePoll` (continuous-drainer idle fallback), `pausePoll` (paused). Set
them with `queue config idlePoll 20m` etc. `node scripts/queue.ts loop` prints the
invocation for the current state (arm the Monitor, drain continuously, terminate
on idle; the `idlePoll` heartbeat is only the unmonitored fallback), so never
hardcode a delay.

**The stall invariant: the driver matters, not the loop.** While `status: running`,
keep a driver attached that re-drains when work arrives. A drained queue must never
*silently* stall, but the polling loop need not run forever and must **not** fire on
an empty queue.
- **Monitor armed ⇒ idle terminates the loop.** A persistent signal-polling
  `Monitor` *is* the driver: on an idle/drained tick (exit `3`), terminate the loop
  (`ScheduleWakeup stop:true`). The Monitor re-wakes it the instant `signal` reports
  drainable work and stays silent otherwise. This is the intended clean stop
  (design.md `run-all` — "terminate when no eligible task remains"), safe
  **because** the Monitor covers restart.
- **Unmonitored ⇒ idle re-arms the polling heartbeat.** Only when no Monitor could
  be armed, re-arm `idlePoll`; lacking an event source, it must poll, so it may
  wake on an empty queue.
- Either way a later task is picked up automatically; `stop:true` on an operator
  stop/pause (exit `5`/`4`) is unchanged.

**Arm the Monitor first, polling the drain signal.** At the *start* of the loop,
before the first tick, arm a persistent **`Monitor`** whose command **polls `node
scripts/queue.ts signal`**, e.g. `while true; do node scripts/queue.ts signal; sleep
<idlePoll>; done`. `signal` prints the `queue: DRAIN-WANTED <n> pending` marker (and
exits `0`) **only** when the queue is running, has eligible work, and has no active
driver; otherwise it prints nothing and exits `3`. The Monitor therefore emits only
when a drain is genuinely wanted.

Poll **`signal`**, not the file's mtime: a raw mtime watch fires on *every* write,
including a task completing and auto-archiving itself, and wakes the loop against an
already-empty queue. `signal` is the content-level gate that distinguishes "work is
waiting with no driver" from "the file just changed."

**Enqueue kicks the drain.** After `add`/`add-many`/`top`/`start` on a running,
drainable queue with no active task, the CLI prints the same `queue: DRAIN-WANTED
<n> pending` marker (via `drainKick`) and hints to start now, so newly-added work
begins in seconds, not on the next poll. When you add tasks and no drain is
running, start one immediately.

**Durable driver across session close (optional).** A `/loop` lives only as long as
its session. To keep the queue draining unattended past that, register a
**`CronCreate`** firing the drain every `config.interval`:

```
CronCreate: schedule every <config.interval> →
  run `node scripts/queue.ts tick`, execute the task and its delivery cycle above
```

`tick`'s exit `3` makes each firing a **safe no-op when the queue is empty**, so the
cron can run indefinitely and drains only when there's eligible work. Use this when
the queue must outlive any single session (overnight, across machines).

**Auto-drain on request.** When the user asks to run/drain/keep working the queue
(or `/queue` with no clear one-shot intent), start the loop yourself; don't make
them wire `/loop`. Change cadence with `queue interval <dur>`; stop with
`queue stop`; resume with `queue start`.

## Usage limits — pause and ride out the window

A long autonomous drain will eventually hit the rolling 5-hour usage limit. Agents
**cannot reliably predict** it, so handle it two ways, reactive first:

- **Reactive (primary).** You are limited when a wake **can't get work through**.
  Then run `node scripts/queue.ts pause` (no time needed) and **re-arm the loop at
  the slow `pausePoll` cadence** (default 30m) instead of the fast interval;
  `node scripts/queue.ts loop` prints the slow invocation while paused. Each slow
  wake tries `tick`; the first that succeeds means the window reopened → `queue
  start`, back to the normal interval.
- **Proactive (best-effort).** If usage is visibly near 100% (e.g. the statusline's
  5-hour usage%), pause *before* starting a new task so you don't strand a half-done
  one. If the reset time is known, `queue pause --until <iso>` for a precise resume;
  otherwise rely on the slow poll.

`tick` **auto-resumes** once `resumeAt` passes; a `pause` with no `resumeAt` stays
paused (slow-polling) until a wake succeeds or you `queue start`. A plain `queue
stop` is a manual pause and never auto-resumes.
