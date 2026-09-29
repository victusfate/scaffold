## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **Codex** (`$name` or `/skills`) and **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.

A **visible, editable Markdown work queue** that agents drain **autonomously** so
you can augment a long-running project without babysitting it. You stack up work;
a loop wakes on an interval (default 6 min) and drains it — one task at a time, or
**fanned out across parallel git worktrees** — running each task either as a quick
`direct` chore or through the **full feature-chain** (`design → prd → plan → tdd →
code-refiner`) with **no user input**. The queue's state lives in a SQLite store
(`.agent/queue/queue.db`, git-ignored) and is rendered after every change to one
file you can open at any moment: `.agent/queue/queue.md`.

This is the complement to `/feature-chain`: the chain builds *one* feature
interactively, start to finish; the queue lets you **keep feeding and draining
many units of work** on an ongoing project, unattended.

The reliable read/mutate layer is `scripts/queue.ts` (pure model in
`scripts/queue-model.ts`, store in `scripts/queue-db.ts`). Humans may hand-edit
`queue.md` and apply it with `queue import`; agents mutate **only** through the
CLI so ids and format never corrupt.

## Client capability fallback

Before arming a driver, check which tools are exposed. In Codex or another client
without `Monitor`, `ScheduleWakeup`, or `CronCreate`, the [loop skill](loop.md)
provides an external macOS/Linux/WSL/Windows driver when unattended recurrence is requested.
If this drain already runs inside a loop, reuse it; never create a nested driver.
Without an available, successfully armed driver, drain ready tasks in the active
turn using the CLI below. Stop on idle, operator stop, or a real usage limit;
checkpoint remaining work and explain that future additions need another
invocation. Never claim automatic restart without verified scheduler state.
The native persistent-driver rules below apply only when those tools are exposed.
Batch worktree lanes within the client’s concurrency limit, or drain serially if
subagents are unavailable.

## The store and its view

**The store is the source of truth.** `queue.db` holds every task and the config
in SQLite (Node's built-in `node:sqlite`). Its schema enforces what convention
could not: `tasks.id` is the primary key, so no two tasks can share an id, and the
`nextId` counter only moves up. There is **one store per repository**, in the main
checkout's `.agent/queue/` (found through git's common dir), so every worktree
lane hands out ids from the same counter. The store is git-ignored: two committed
binary copies can't be merged, which would bring the id collisions back.

**`queue.md` is the view**, re-rendered after every mutation and committed so the
queue stays visible in review. Like the store, it and its sidecars (`log.md`,
`archive.md`, `lanes/`) live in the main checkout, so a lane's worktree never
rewrites its own copy that would later merge back. It is one Markdown file. **Line order is priority** (top runs first). A checkbox encodes
status; indented `- key: value` lines carry each task's spec:

```markdown
# Work Queue

<!-- queue:config
status: running
interval: 6m
maxFailures: 3
leaseMinutes: 30
maxParallel: 1
integrationBranch:
-->

- [ ] task-001 — Build the hello endpoint
  - mode: chain
  - slug: hello-endpoint
  - deps: task-000
  - files: src/api/hello.ts, test/hello.test.ts
  - validate: npm test
  - accept: GET /hello returns 200 "hello"
- [>] task-002 — Refactor the parser
  - owner: worker-a
```

- `[ ]` pending · `[>]` active · `[x]` done · `[!]` failed
- **config:** `status` run/pause · `interval` wake cadence · `maxFailures` retry cap
  · `leaseMinutes` stale-lease threshold · `maxParallel` fan-out width ·
  `integrationBranch` where completed worktree branches merge (blank = current).
- **Reprioritize** with `queue top <id>` / `move`, **edit** with `set`, **pause**
  with `queue stop` — or hand-edit `queue.md` (move lines, change or delete them,
  set `status: stopped`) and run **`queue import`** to apply it. Import replaces
  the store's task list with the file's; `--dry-run` previews. An import that
  would **delete stored tasks or change the status of a claimed/finished one** is
  refused without `--force`. A stale copy (git put back an older `queue.md`)
  looks exactly like a deliberate deletion, so the dry run lists what would go.
- **Hand edits never get silently overwritten.** Each render records the view's
  hash; if the file changed since, every mutating command (CLI or console)
  refuses with a message and saves nothing until you `import` the edits or
  `render` (rewrite the view from the store, discarding them). A git checkout,
  pull, merge, or stash that changes `queue.md` counts too; there `render` is
  usually right, because the store already holds the truth.

Task lines and their fields survive worker writes; **freeform prose does not**.
Runtime sidecars `log.md` (audit trail) and `archive.md` sit alongside and are
git-ignored; `queue.md` itself is committed so the queue is durable and visible.
**Completed tasks auto-archive**: `done` moves a task straight into `archive.md` and
out of `queue.md`, so the live queue shrinks to empty as work finishes (a `done` task
still depended on by unfinished work is kept until that dependent completes, so the
DAG never breaks). Terminal `failed` tasks stay visible; sweep them with `archive`.
Task **ids are unique and monotonic**, enforced by the store: a save carrying a
duplicate id, or an id already issued and since removed, is refused. `task-007` is
never reused once it has existed, even after the queue drains to empty, so
archived and live ids never collide.

**Duplicate ids in a view get renumbered, with a report.** `import`, and the
automatic migration the first time a store opens over an existing `queue.md`,
keep the first task with each id and give later duplicates (and already-issued
ids) fresh ones. They print an `old → new` map and append it to `log.md`. Deps
on an already-issued id follow its rename. A dep that named a duplicated id still
points at its first holder and is flagged with `!`; check each flagged dep.

## Command surface (`scripts/queue.ts`)

```
list | show <id>                       # overview | one task's full spec
add "<title>" [flags]                  # append a task (flags below); --top to prepend
add-many                               # seed many tasks from stdin, one per line
set <id> <field> <value>               # edit a field (mode/slug/deps/files/validate/accept)
next | ready                           # serial pick | fan-out candidate set (under the cap)
tick                                    # serial loop entry: ownership check → begin → print task
signal                                  # print DRAIN-WANTED iff drainable (Monitor poll; exit 0/3)
claim <id> [--worker w]                # atomic claim for a parallel worker
release <id> --worker w                # return a confirmed-ended owned claim to pending
done <id> [--skip-validate]            # validate, complete, then auto-archive out of the queue
fail <id> [reason...]                  # record a failure (retries, then terminal)
top <id> | move <id> <pos> | remove <id>   # reprioritize (1-based pos, as `list` numbers) | prune
requeue <id>                           # revive a failed task (pending again, failures cleared)
start | stop                           # run or pause the whole queue
interval <dur> | config <key> <value>  # cadence | maxFailures|leaseMinutes|maxParallel|integrationBranch
gate <gate-id> [--only f] [--dry-run]  # add deps:<gate-id> to every other task (block; see Gating work)
ungate <gate-id> [--keep-gate]         # remove <gate-id> from all deps + mark it done (unblock)
worktree add|remove|list <id>          # isolated git worktree per task
archive | loop                          # sweep done/failed | print the /loop invocation
import [--dry-run|--force]             # apply hand edits to queue.md (renumbers duplicate ids)
render                                 # rewrite queue.md from the store (discard hand edits)
```

`add`/`set` flags: `--mode chain` · `--slug <s>` · `--deps a,b` · `--files a,b` ·
`--validate "<cmd>"` · `--accept "<criteria>"` · `--top`. Override the view with
`QUEUE_FILE=<path>`; it then gets its own store beside it (`<name>.db`), unless
`QUEUE_DB=<path>` names the store explicitly.

## Gating work (dependency gates)

A **gate** is just a task that everything else depends on: while it's unfinished,
`isEligible` blocks every task carrying `deps: <gate-id>`, so nothing else runs. It
is the mechanical form of a **temporary priority block** — e.g. the 2026
model-fidelity block, where every non-model task carried `deps: task-591` so only
the character pipeline could run until the user opened the gate.

`gate` / `ungate` are the **mechanical interface** for this. **Never hand-edit
`queue.md` deps to apply or lift a block** (critical rule 4) — that is exactly the
corruption the queue exists to prevent. Applying the block by hand once meant
text-editing the dep off 72 tasks to lift it; these verbs do it in one call:

```bash
node scripts/queue.ts add "model-fidelity gate" --accept "user opens the gate"
node scripts/queue.ts gate task-591            # block: deps: task-591 on every other task
node scripts/queue.ts gate task-591 --dry-run  # preview the plan, write nothing
node scripts/queue.ts gate task-591 --only web # only tasks whose id/title contains "web"
node scripts/queue.ts ungate task-591          # lift: strip the dep everywhere + mark the gate done
```

- **`gate <gate-id> [--only <filter>] [--dry-run]`** — adds `deps: <gate-id>` to
  every **other** unfinished task. Idempotent (a task already gated is skipped) and
  cycle-safe (a task the gate itself depends on is never gated). Skips the gate task
  itself and any `done`/`failed` task. `--only` restricts to tasks whose id or title
  contains the (case-insensitive) substring; `--dry-run` prints the plan without
  writing. Prints how many tasks were gated.
- **`ungate <gate-id> [--keep-gate] [--dry-run]`** — removes `<gate-id>` from every
  task's deps (trimming a multi-dep list, dropping an empty one) and marks the gate
  task `done` so its blocked dependents become eligible. `--keep-gate` leaves the
  gate task's status untouched; `--dry-run` previews. Prints how many were ungated.

Opening a real block (like model-fidelity) is a deliberate call — `ungate` is the
one command that does it, cleanly and reversibly, instead of a bulk text edit.

## Console (`scripts/queue-console.ts`)

A local web console over the same model layer — view, add, edit, prune,
drag-reorder, requeue, start/stop, and archive-sweep the queue live from a
browser, auto-refreshing as workers write the file:

```bash
node scripts/queue-console.ts [--port 8722]   # → http://localhost:8722  (QUEUE_FILE honored)
```

Two repos means two consoles — one per repo, each with its own `QUEUE_FILE`
and its own port (e.g. `QUEUE_FILE=/a/.agent/queue/queue.md ... --port 8722`
and `QUEUE_FILE=/b/.agent/queue/queue.md ... --port 8723`). Bookmark both;
`start`/`stop` apply per repo. Consoles are fully independent (own locks,
sidecars, lanes) — proven by `scripts/queue-isolation.test.ts`, which runs
two real servers and asserts ops, locks, and heartbeats never cross.

Zero dependencies, loopback-only, **management surface only**: it exposes no
done/fail/claim/worktree actions and never executes a task's `validate` (or any
shell command) — execution stays with workers. Every page action posts a typed
op that is validated before it touches the file, and the interface guards the
dependency DAG: deps naming nonexistent tasks, self-deps, cycles, and removing
a task that unfinished work still depends on are all rejected. Agents get the
same guarantees through `queue.ts`; humans can still hand-edit the view and
`import` it. An op over a hand-edited view answers **409** with that remedy.

Concurrent CLI and console mutations share an exclusive queue sidecar lock. It
waits for at most one minute and never steals an old lock: a slow live holder
cannot be distinguished from a crashed one. If it times out, confirm the holder
is dead before removing `<store>.lock` (`.agent/queue/queue.db.lock` by
default; it sits beside the store so every worktree contends for the same lock),
then retry the command. Inspect
that file first: it records the holder PID and acquisition timestamp.
Validation releases and retakes the lock before it commits; worktree add/remove
keeps it for the lifecycle so a checkout reference cannot be lost. A slow
checkout can therefore make another mutation time out rather than interleave.

The page is a kanban board — Queued / Blocked / In Progress / Done / Failed —
grouped from the same state (drag reorder works inside Queued; status changes
stay with workers). The header shows the dispatch plan (`continues: … · up
next: …`); after reordering or editing deps, hit **Reassign** to recompute it
from the current order and kick an armed drain awake (it never preempts an
active lane). Active cards show live lane chips — worker, current step, log
tail — from heartbeat sidecars (`.agent/queue/lanes/<id>.json`, written via
`queue lane beat <id> --step "…" --tail "…"`); stale lanes grey out but are
never reaped by the board. The ■ button on an active card (or `queue lane
stop <id>`) files a cooperative stop request the owning driver honors at its
next safe point — the console never kills a process.

Drag a Queued card onto In Progress to claim it into the next free lane slot
(server assigns `lane-N`, refused at `maxParallel` capacity); drag an active
card back to Queued to release it to pending. **Every column accepts drops**:
Blocked parks the card (`held` — the drain skips it until dragged out, no
fake deps); Done marks it operator-done (the `--skip-validate` twin, logged
as such — validation never runs from the board); Failed fails it terminally
with an operator note. Drags out of Done/Failed normalize through
reopen/requeue first.

Every card shows its banked agent time (`⏱3s` → `⏱45m`, seconds under a
minute, whole minutes above); active cards fold in the live session. Time is
a first-class model field (`- elapsed: 2h15m30s`, exact to the second,
hand-editable, `set`-able) banked at every session end — done, fail, release,
operator-done, operator-fail — so retries accumulate across a task's life and
archive lines carry each task's total after it sweeps out.

## Creating a queue from in-memory items

When you already hold a list of work, pipe it in — one item per line (leading
bullets/checkboxes are stripped) — to build or extend the queue in one call:

```bash
printf 'Write the README\nAdd unit tests\nWire the CI\n' | node scripts/queue.ts add-many
```

`add-many` **appends** (never clobbers) and also takes positional args.

Each line becomes its own task, so split the list to the atomic grain below
before piping it in — bulk-seeding is where umbrella tasks sneak in.

## Task sizing — atomic tasks, no open-ended umbrellas

A queued task must be **one reviewable slice a single agent can finish and mark
`done` in one sitting** — not an open-ended program of work. An unattended worker
has nobody to tell it "that's enough," so a task that *can't* finish never does: it
holds its lease, accretes scope, and blocks everything downstream of it.

- **`accept` must be checkable.** Every task carries an `accept:` naming a concrete,
  verifiable end state ("hands have thumb+finger bones; a wielded weapon shows a
  wrapped grip") — an end state, not a direction of travel. If you can't write a
  crisp accept line, the task is too big: split it.
- **No "ensure all X" / "cover every Y" / "rich, detailed …" tasks.** Those never
  complete; they accrete. Convert them into a **finite enumerated set** of atomic
  tasks (one per power, per character, per scene), plus at most *one* thin
  "audit the remaining gaps and `add` them as tasks" task — which itself completes.
- **Split on delivery, not on layer.** Each subtask cuts through to something
  demonstrable/testable and can be marked `done` independently — the vertical-slice
  rule the chain applies *inside* a feature, applied to the queue itself. Prefer 5
  tasks that each ship a thing over 1 task that ships five things.
- **Umbrella → children, then close the umbrella.** When work has many parts, the
  parent becomes a **tracking stub**: `deps: <child ids>` with an `accept` of "all
  children done." It only becomes eligible once every child completes, so closing it
  is automatic and it can never sit open as a place to pile new scope — **new scope
  is a new task**.
- **Size guide:** if a task can't plausibly reach its `accept` in one focused agent
  session, split it *before* starting. When in doubt, split.
- **Partial progress = split, not a lingering open task.** If a worker finishes only
  part of an oversized task, narrow it to the slice actually delivered (`queue set
  <id> accept "<slice>"`), `done` it, and `add` the remainder as new smaller tasks
  with their own accept lines — don't leave the big one 40%-open forever. This is the
  sizing counterpart to `needs-spec:`: re-file rather than grind.

Sizing happens at **enqueue** time, alongside specification — same reason: the
worker can't renegotiate scope mid-drain.

## Two speeds: `direct` vs `chain`

- **`direct`** (default) — small, self-contained work (bug fixes, chores, config).
  The worker does it, runs `validate`, and completes. This is the "what the chain
  doesn't apply to" tier.
- **`chain`** — a feature. The worker runs the **feature-chain autonomously**, with
  **no interactive grill**, into `docs/<slug>/`:
  1. **Design** — if `docs/<slug>/design.md` is missing, *generate it
     non-interactively* from the task's spec (`title` + `accept` + `files` +
     `deps`). The grill is skipped because a queued task is a **resolved
     contract** — enough is specified to design directly.
  2. **`to-prd`** → `prd.md`  3. **plan** → `plan.md` (vertical slices)
  4. **`tdd`** → RED→GREEN→REFACTOR per slice, `tdd-log.md`
  5. **`code-refiner`** (auto-fix) to 10/10
  6. run `validate`, then `done`.

  All phase-to-phase confirmations are **auto-accepted** — the queued task is
  pre-approved, so the worker never pauses for "continue."

## The execution contract — no user input, ever

An unattended worker **never asks the user a question.** Specification happens at
**enqueue time** (interactive, with you present — optionally by running a grill for
one task), so by the time a task is claimed it is self-contained. During execution:

- If a task is **underspecified** and the worker hits genuine ambiguity it cannot
  resolve from the spec + codebase, it **fails the task with a `needs-spec: <what's
  missing>` note** (`queue fail <id> "needs-spec: ..."`) and moves on — it does
  **not** guess, and it does **not** block waiting for input.
- You see the `needs-spec` note in `queue list`; you refine the task and it
  re-enters the queue. This is how "no user input during a drain" stays true
  without silently doing the wrong thing.

## The tick cycle (serial — `maxParallel: 1`)

The loop body; one task per wake:

1. `node scripts/queue.ts tick` —
   - `STOPPED` → do nothing (paused). `IDLE` → nothing eligible; end the turn.
   - `OWNERSHIP CONFLICT` → an active lease expired; stop dispatch and report it.
     Never infer that its worker died or reclaim it automatically.
   - otherwise it marks the current task `active` and prints a `<queue_task>`
     block with its `mode` and spec. That's your one unit.
2. **Execute** per its mode (`direct` or the `chain` sequence above), honoring the
   no-user-input contract.
3. **Complete:** `queue done <id>` (runs `validate`; refuses → counts as a failure)
   or `queue fail <id> "<reason>"`. A successful `done` **auto-archives** the task
   out of the live queue, so the queue empties as work finishes.
4. **Commit** the work so each drained task is a reviewable checkpoint.

A resumed `active` task is preferred next wake; otherwise the topmost **eligible**
pending task (all `deps` done) starts. Failures don't halt the queue — a failed
task retries (dropped to the back) up to `maxFailures`, then goes terminal, and
independent work keeps flowing.

### Session isolation during recovery

One session has exactly one orchestrator. Other sessions may work concurrently,
but their orchestrators, workers, terminals, and user-launched agent CLIs are
outside this session's ownership. Never inspect them for cleanup or send them a
signal. In particular, `owner` is a queue label and `startedAt` is a lease clock;
neither is a PID, session identity, heartbeat, or permission to manage a process.

`tick` and `ready` never reclaim an expired lease: they exit 6 and leave the task active.
The root orchestrator is the lifecycle controller for native subagents in its own
agent tree. For one of those claims it must inspect the native agent registry, not OS
processes: if the child is running, interrupt that exact child handle and confirm it
is no longer running; if it is completed, proceed directly. Then run `queue release
<id> --worker <exact-owner>` to return unfinished work to pending
without recording a false failure. The release is audited and refuses a missing or
mismatched owner; it does not delete or merge a worktree, which still needs the normal
unique-content audit.

After a harness restart or power outage has erased child handles, an explicit operator
recovery instruction authorizes the root orchestrator to release the stale queue claim
with the exact stored owner. This authority applies to the queue record only: never run
`kill`, `pkill`, `killall`, or `taskkill`, and never infer process ownership from a
name or PID. Claims belonging to another live/possibly-live session remain fail-closed:
leave its process, record, and worktree untouched and report the ambiguity.

## Fan-out (parallel — `maxParallel: N`)

Set `queue config maxParallel 3` to run independent tasks concurrently, each in its
own git worktree. Two patterns, same primitives:

**Pattern A — in-session fan-out (default).** On each wake the dispatcher:
1. `node scripts/queue.ts ready` → the eligible set under the cap.
2. For each returned task: `queue worktree add <id>` (isolated checkout on
   `queue/<id>` off the integration branch), then dispatch a **subagent** to
   execute it in that worktree under the same contract.
3. On success: the subagent merges `queue/<id>` → `integrationBranch`
   **agent-driven** (never a blind auto-merge — a clean textual merge can still be
   semantically wrong). On conflict or post-merge validation failure, it either
   reconciles carefully or `fail`s with a note (design.md D7). Then `queue done
   <id>` and `queue worktree remove <id>`.

**Pattern B — multiple independent workers (scale-out).** Many loop sessions/crons
each `queue claim <id> --worker <name>` (atomically acquire the queue record), work
their own worktree, and merge back. A queue-record claim grants no process authority.
An expired lease blocks automatic dispatch until its creating orchestrator or an
operator explicitly resolves it. Use this to drain faster or across machines.

Merge-back is intentionally **not** a CLI auto-merge — the queue gives you
isolation (`worktree add`/`remove`) and leaves integration to a judgment-applying
agent, per this repo's "liveness/veracity" and D7 principles.

## Running it: work-driven, not clock-driven

Keep the queue **continuously busy** — a fixed timer is a fallback, not the pacer.
The worker that finishes a task is the one that starts the next, so there's nothing
to guess about when a task ends.

**Drain continuously in-turn.** Don't sleep between tasks — loop until the queue is
empty:

```
tick → execute → done → tick → execute → done → …   (no delay between tasks)
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
  run `node scripts/queue.ts tick`, do the task it prints, then done/fail it
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

## Critical rules

1. **The store is the source of truth; the user steers it.** Every tick reads the
   store. When a command reports a hand-edited `queue.md`, the user edited it on
   purpose: stop dispatch and surface it. Don't `render` over it, since that
   discards their edits. `import` only when the edit is plainly theirs to apply.
2. **No user input during a drain.** Never ask a question; underspecified → `fail`
   with a `needs-spec:` note and move on. Spec at enqueue time, not mid-run.
3. **Chain tasks run the whole chain autonomously** — generate the design from the
   spec (no grill), auto-accept phase gates, never wait for "continue."
4. **Mutate only through `scripts/queue.ts`** so ids and format stay intact. Humans
   may hand-edit the view and `import` it; the worker never edits it by hand.
5. **Never blind-merge a worktree.** Merge-back is agent-driven; on conflict,
   reconcile carefully or fail safe (D7). Failures never halt independent work.
6. **Stopped means stopped** — a `tick` does nothing until `queue start`.
7. **A running queue never silently stalls — but a drained one terminates the
   loop, and no loop fires on an empty queue.** The invariant is *a driver stays
   attached while running*, not *the loop runs forever*. With a **signal-polling
   `Monitor` armed** (do this first — it polls `queue signal` and emits only when work
   is drainable), an idle/drained tick **terminates the loop** (`ScheduleWakeup
   stop:true`) — the Monitor re-wakes it only when a later `add` makes work drainable,
   so an empty queue never wakes it. Only when **no Monitor could be armed** does an
   idle tick re-arm the `idlePoll` heartbeat instead. A registered `CronCreate` drain
   is an equivalent standing driver. An operator stop/pause always ends the loop.
   When the portable agent-loop is the driver, its child reports `continue` while
   any active or eligible queue work remains and reports `complete` only after the
   queue is actually drained. It never calls the driver's `stop` command itself;
   the supervisor owns recurrence lifecycle and terminal outcomes.
8. **Tasks are atomic.** One reviewable slice, finishable in one sitting, with a
   checkable `accept`. Never enqueue an "ensure all X"/"cover every Y" umbrella —
   enumerate it into finite children and make the parent a tracking stub
   (`deps: <child ids>`). When in doubt, split. Partial progress gets re-filed as
   smaller tasks, not left 40%-open.
9. **Completed tasks auto-archive.** A successful `done` moves the task into
   `archive.md` and out of the live queue, so the queue empties as work finishes — but
   a `done` task still depended on by unfinished work is kept until that dependent
   completes (never break the DAG). Terminal `failed` tasks stay visible; sweep them
   with `archive`.
10. **Session processes are isolated.** One orchestrator owns each session. Never
    inspect, stop, reclaim, or signal another session's orchestrator/workers or a
    user-launched agent CLI. Queue metadata is never process authority.
