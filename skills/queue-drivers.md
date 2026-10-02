# Queue driver setup

Supporting reference for [the queue skill](queue.md); its delivery cycle applies
to every driver below.

## Legacy fan-out (explicit `deliveryMode: batch`)

Only after explicitly selecting batch mode, set `queue config maxParallel 3` to
run independent tasks concurrently, each in its
own git worktree. Two patterns, same primitives:

**Pattern A — in-session batch fan-out.** On each wake the dispatcher:
1. `node scripts/queue.ts ready` → the eligible set under the cap.
2. For each returned task: `queue worktree add <id>` (isolated checkout on
   `queue/<id>` off the integration branch), then dispatch a **subagent** to
   execute it in that worktree under the same contract.
3. The worker commits locally and reports its exact tip, checks, evidence and
   remaining original scope. Before returning, it runs `queue lane finish <id>
   --worker <exact-owner> --tail <result-summary>` in the owning queue checkout.
   This records `awaiting-review`; it does not accept the task or release its claim.
4. The root verifies the owned native handle is terminal, or its tracked CLI child
   exited with a valid result. Native `completed` means execution ended, not scope
   acceptance. Claude, Codex and pi use this same contract; hooks may notify the
   root but never independently merge, publish or reclaim.
5. The root reviews and integrates passing commits into the one working branch,
   runs gates, and finalizes: `done` only for full accepted scope; `fail` for a
   genuine failed attempt; `release <id> --worker <exact-owner>` for partial work.
   Queue transitions clear ended heartbeat and stop metadata after commit.
6. The root audits unique worktree content, verifies removal after preservation,
   and records disposition before replacement dispatch. No forced deletion of
   unpreserved content. At every dispatch/wake, reconcile completed owned handles
   first; an unprocessed terminal result is pending work, not an idle worker.

Record task ID, exact queue owner, creating session, harness, native handle or
CLI run, worktree, branch and original acceptance at dispatch. Recover missing
handles only under the explicit operator procedure above. Never infer termination
from claim age, heartbeat age or a process name. A worker that crashes before
`lane finish` is reconciled from the owned handle, not by waiting for a lease.

**Pattern B — multiple independent workers (explicit `batch` mode only).** Many loop sessions/crons
each `queue claim <id> --worker <name>` (atomically acquire the queue record), work
their own worktree, and merge back. A queue-record claim grants no process authority.
An expired lease blocks automatic dispatch until its creating orchestrator or an
operator explicitly resolves it. Use this to drain faster or across machines.

Merge-back is intentionally **not** a CLI auto-merge — the queue gives you
isolation (`worktree add`/`remove`) and leaves integration to a judgment-applying
agent, per this repo's "liveness/veracity" and D7 principles.

## Running it: work-driven, not clock-driven

Keep the queue **continuously busy** — a fixed timer is a fallback, not the pacer.
The root starts the next task only after completing the current delivery cycle.

**Drain continuously in-turn.** Don't sleep between tasks — loop until the queue is
empty:

```
tick → execute → done → PR → validate → authorized merge → fresh branch → advance → tick → …   (no delay between tasks)
```

This is AGENTS.md's continuous-execution rule: the commit per task is the
checkpoint, so a crash resumes; the interval only matters when there's nothing to
do.

**Branch the next cadence on `tick`'s exit code** (so you never pick an interval):

| `tick` / `ready` exit | Meaning | Next action |
|---|---|---|
| `0` | a task was dispatched | do it, then loop **immediately** |
| `3` | idle — queue drained, nothing eligible | **terminate the loop** (`ScheduleWakeup stop:true`) **when a signal-polling Monitor is armed** — it re-wakes the loop only when a later `add` makes work drainable, so nothing stalls and **no loop fires on an empty queue**. Only if you could not arm a Monitor, **re-arm the heartbeat** at config **`idlePoll`** (default 20m) as the fallback (it must poll, so it may wake on an empty queue) |
| `4` | paused for a usage window | slow-poll at config **`pausePoll`** (default 30m); auto-resumes when the window reopens |
| `5` | stopped (manual) | halt until `queue start` |
| `6` | ownership conflict | resolve explicitly without reclaiming another session |
| `7` | delivery pending | finish current PR/merge cycle; acknowledge with `advance` |

The three fallback cadences are all editable config: `interval` (fixed one-tick
loops), `idlePoll` (continuous-drainer idle fallback), `pausePoll` (paused). Set
them with `queue config idlePoll 20m` etc. `node scripts/queue.ts loop` prints the
invocation for the current state — arm the Monitor, drain continuously, then
terminate on idle (the `idlePoll` heartbeat is only the unmonitored fallback) — so
you never hardcode a delay.

**The stall invariant — the driver is what matters, not the loop.** A drained
queue must never *silently* stall, but that does **not** require the polling loop to
run forever, and it must **not** fire on an empty queue. The invariant is: **while
`status: running`, a driver is attached that re-drains when work arrives.** A
persistent **signal-polling `Monitor`** (above) *is* that driver — so once it is armed,
an idle/drained tick (exit `3`) **terminates the loop** (`ScheduleWakeup stop:true`):
the Monitor stays attached and re-wakes the loop the instant `signal` reports drainable
work, and stays silent otherwise — so an empty queue never wakes the loop. Terminating
on drain is the intended clean stop (design.md `run-all` — "terminate when no eligible
task remains"), safe **because** the Monitor covers restart. The only case that re-arms
the `idlePoll` heartbeat is when **no Monitor could be armed** — then the heartbeat is
the fallback driver (and, lacking an event source, must poll, so it may wake on an
empty queue). So: **Monitor armed ⇒ idle terminates the loop, no empty-queue fires;
unmonitored ⇒ idle re-arms the polling heartbeat.** Either way a later task is picked
up automatically; `stop:true` on an operator stop/pause (exit `5`/`4`) is unchanged.

**The Monitor is the primary driver (arm it first, and make it poll the drain
signal).** At the *start* of the loop, before the first tick, arm a persistent
**`Monitor`** whose command **polls `node scripts/queue.ts signal`** — e.g. `while
true; do node scripts/queue.ts signal; sleep <idlePoll>; done`. `signal` prints the
`queue: DRAIN-WANTED <n> pending` marker (and exits `0`) **only** when the queue is
running, has eligible work, and has no active driver; otherwise it prints nothing and
exits `3`. So the Monitor emits an event **only when a drain is genuinely wanted** —
it stays silent on an empty or idle queue, which is what lets the loop terminate on
idle **without** any spurious wake on an empty queue, yet re-wake the instant a later
`add` makes work drainable.

Poll the **`signal`** predicate, not the file's mtime: a raw mtime watch would fire
on *every* write — including a task completing and auto-archiving itself — and wake
the loop against an already-empty queue. `signal` is the content-level gate that
distinguishes "work is waiting with no driver" from "the file just changed." The same
marker is also printed inline by `add`/`add-many`/`top`/`start` (via `drainKick`) so a
human or cron sees the restart cue immediately.

**Enqueue kicks the drain.** After `add`/`add-many`/`top`/`start` on a running,
drainable queue with no active task, the CLI emits `queue: DRAIN-WANTED <n> pending`
and hints to start now — so newly-added work begins in seconds, not on the next
poll. When you add tasks and no drain is running, start one immediately.

**Durable driver across session close (optional).** A `/loop` lives only as long as
its session. To keep the queue draining unattended past that, register a
**`CronCreate`** firing the drain every `config.interval`:

```
CronCreate: schedule every <config.interval> →
  run `node scripts/queue.ts tick`, execute the task and its delivery cycle above
```

`tick`'s exit `3` makes each firing a **safe no-op when the queue is empty**, so the
cron can run indefinitely without side effects; it drains only when there's eligible
work. Use this when the queue must outlive any single session (overnight, across
machines).

**Auto-drain on request.** When the user asks to run/drain/keep working the queue
(or `/queue` with no clear one-shot intent), start the loop yourself — no need to
make them wire `/loop`. Change cadence with `queue interval <dur>`; stop with
`queue stop`; resume with `queue start`.

## Usage limits — pause and ride out the window

A long autonomous drain will eventually hit the rolling 5-hour usage limit. Agents
**cannot reliably predict** this, so handle it in two ways, reactive first:

- **Reactive (primary).** You find out you're limited when a wake **can't get work
  through**. When that happens, `node scripts/queue.ts pause` (no time needed) and
  **re-arm the loop at the slow `pausePoll` cadence** (default 30m) instead of the
  fast interval — `node scripts/queue.ts loop` prints the slow invocation while
  paused. Each slow wake just tries `tick`; the first that succeeds means the window
  reopened → `queue start`, back to the normal interval. No prediction needed: it
  polls until work flows again.
- **Proactive (best-effort).** If usage is visibly near 100% (e.g. the statusline's
  5-hour usage%), pause *before* starting a new task so you don't strand a half-done
  one. If the reset time is known, `queue pause --until <iso>` for a precise resume;
  otherwise rely on the slow poll.

`tick` **auto-resumes** on its own once `resumeAt` passes, and a `pause` with no
`resumeAt` stays paused (slow-polling) until a wake succeeds or you `queue start`.
A plain `queue stop` is a manual pause and never auto-resumes. This is the same
"spend the budget, then sleep until it refills" pattern as AGENTS.md's continuous
execution — applied to the queue so overnight drains survive the window.

