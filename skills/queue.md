## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **Codex** (`$name` or `/skills`) and **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.

A **visible, editable Markdown work queue** that agents drain **autonomously** so
you can augment a long-running project without babysitting it. You stack up work;
a loop wakes on an interval (default 6 min) and drains it — **one independent
task per PR/merge cycle** (parallel agents may implement its subtasks) — running each task either as a quick
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
deliveryMode: per-task
deliveryTask:
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
  `deliveryMode` defaults to `per-task`; `batch` explicitly opts into legacy fan-out.
  `deliveryTask` records the current delivery cycle; use `advance`, not config, to clear it.
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
done <id> [--skip-validate]            # implementation accepted; delivery gate remains
advance <id> --pr <url> --branch <name> # root attests merged PR and fresh branch
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

Every card shows cumulative claim wall time, including idle time (`⏱3s` → `⏱45m`, seconds under a
minute, whole minutes above); active cards fold in the live session. Time is
a first-class model field (`- elapsed: 2h15m30s`, exact to the second,
hand-editable, `set`-able) banked at every session end — done, fail, release,
operator-done, operator-fail — so retries accumulate across a task's life and
archive lines carry each task's total after it sweeps out.
This is not measured compute time or proof that a worker is still running.

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
- **Preserve acceptance.** Plan independently useful delivery slices before work.
  Partial implementation does not satisfy the original task. Keep it current,
  report the remaining scope, and revise scope only with existing owner authority;
  never narrow acceptance merely to mark the task done.

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
  missing>` note** (`queue fail <id> "needs-spec: ..."`) and reports the blocker (per-task mode retains the delivery gate) — it does
  **not** guess, and it does **not** block waiting for input.
- You see the `needs-spec` note in `queue list`; you refine the task and it
  re-enters the queue. This is how "no user input during a drain" stays true
  without silently doing the wrong thing.

## Delivery cycle (default: `deliveryMode: per-task`)

The root orchestrator owns the complete cycle:

1. Claim one independently useful task. Parallel agents work on **subtasks of this
   task** in isolated worktrees; they report and commit locally. Only the root
   integrates, pushes, opens/updates the task PR, and merges.
2. Satisfy full acceptance, review the diff, and run real local validation on the
   integrated branch. `done` records implementation acceptance, **not a merge**.
3. Run `/create-pr`; inspect actual required hosted check conclusions on the final
   head as well as local results. Failed, missing, pending, or suspicious skipped
   checks are not green. Fix the current task; do not start another feature.
   Never use admin bypasses, skipped gates, or manufactured success statuses.
4. Merge only with explicit session authorization or standing project policy.
   Creating a PR or draining a queue does **not** grant merge permission. Without
   authority, keep the ready PR, report the missing authorization, and gate the
   next task. Authorization is resolved with the owner outside the unattended
   worker; do not treat silence as consent.
5. Confirm the PR actually merged, update the target base (normally main), and
   create a fresh working branch before starting another task. Update a pinned
   `integrationBranch` to that branch. Then acknowledge the completed cycle:
   `queue advance <id> --pr <merged-pr-url> --branch <fresh-working-branch>`.

The CLI **enforces a persisted task-selection boundary**, including explicit
claims and console claims. Failures retry the selected task; done/archive,
stop/start, and process restart do not release it. Exit **7** means delivery is
pending, not that the queue drained. Keep supervising CI or report a genuine
blocker; never report the run complete merely because implementation finished.
`advance` is an audited root acknowledgment: it checks the selected task and
requires evidence references, but **does not query GitHub, verify the branch,
validate CI, or infer permission**. The root must verify those facts before calling
it. The queue is operator-editable, not a security boundary against explicit edits.

**Migration and compatibility.** Missing `deliveryMode` defaults to `per-task`
for new and existing stores. Existing active claims remain intact; do not cancel
workers or lose unmerged work. If multiple tasks are already active, stop new
starts and reconcile them under their original owner, explicitly using
`queue config deliveryMode batch` to finish that pre-existing batch if needed.
Switch back to `per-task` at a clean delivery boundary. `maxParallel` still
controls legacy batch fan-out; per-task queue selection is capped at one, while
native agents may parallelize subtasks within it. Projects deliberately choosing
a long-lived branch can explicitly retain `batch`; document that choice in their
project policy. Batch mode retains old done/failure progression, but grants no
merge authority and waives no validation requirements.

## The tick cycle

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
4. **Deliver** through the PR/merge/fresh-branch cycle above, then `advance`.
   In explicit batch mode, commit the accepted work before continuing.

A resumed `active` task is preferred next wake; otherwise the topmost **eligible**
pending task (all `deps` done) starts. In per-task mode failures remain the
current delivery task: retries stay selected; terminal failure blocks advancement
until repaired/requeued or the owner explicitly changes the delivery plan. In
batch mode retries drop to the back and independent work can continue.

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

## Driver and legacy fan-out reference

Read [queue driver setup](queue-drivers.md) before arming a recurring driver,
handling usage-window pauses, or using explicit legacy batch fan-out. It includes
exit-code handling: delivery pending (7) must never be mistaken for drained (3).

## Critical rules

1. **The store is the source of truth; the user steers it.** Every tick reads the
   store. When a command reports a hand-edited `queue.md`, the user edited it on
   purpose: stop dispatch and surface it. Don't `render` over it, since that
   discards their edits. `import` only when the edit is plainly theirs to apply.
2. **No user input during a drain.** Never ask a question; underspecified → `fail`
   with a `needs-spec:` note; keep the delivery gate until resolved. Spec at enqueue time, not mid-run.
3. **Chain tasks run the whole chain autonomously** — generate the design from the
   spec (no grill), auto-accept phase gates, never wait for "continue."
4. **Mutate only through `scripts/queue.ts`** so ids and format stay intact. Humans
   may hand-edit the view and `import` it; the worker never edits it by hand.
5. **Never blind-merge a worktree.** Merge-back is agent-driven; on conflict,
   reconcile carefully or fail safe (D7). In per-task mode a failure gates the next task.
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
   any active, eligible, or delivery-pending queue work remains and reports `complete` only after the
   queue is actually drained. It never calls the driver's `stop` command itself;
   the supervisor owns recurrence lifecycle and terminal outcomes.
8. **Tasks are atomic.** One reviewable slice, finishable in one sitting, with a
   checkable `accept`. Never enqueue an "ensure all X"/"cover every Y" umbrella —
   enumerate it into finite children and make the parent a tracking stub
   (`deps: <child ids>`). When in doubt, split. Preserve original acceptance; partial work cannot be relabeled complete.
9. **Completed tasks auto-archive.** A successful `done` moves the task into
   `archive.md` and out of the live queue, so the queue empties as work finishes — but
   a `done` task still depended on by unfinished work is kept until that dependent
   completes (never break the DAG). Terminal `failed` tasks stay visible; sweep them
   with `archive`.
10. **Session processes are isolated.** One orchestrator owns each session. Never
    inspect, stop, reclaim, or signal another session's orchestrator/workers or a
    user-launched agent CLI. Queue metadata is never process authority.
