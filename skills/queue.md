## Purpose

A **visible, editable Markdown work queue** that agents drain **autonomously** so
you can augment a long-running project without babysitting it. You stack up work;
a loop wakes on an interval (default 6 min) and drains it — one task at a time, or
**fanned out across parallel git worktrees** — running each task either as a quick
`direct` chore or through the **full feature-chain** (`design → prd → plan → tdd →
code-refiner`) with **no user input**. The queue lives in one file you can open and
edit at any moment: `.agent/queue/queue.md`.

This is the complement to `/feature-chain`: the chain builds *one* feature
interactively, start to finish; the queue lets you **keep feeding and draining
many units of work** on an ongoing project, unattended.

The reliable read/mutate layer is `scripts/queue.ts` (pure model in
`scripts/queue-model.ts`). Humans edit the file freely; agents mutate it **only**
through the CLI so the format never corrupts.

## The queue file

One Markdown file. **Line order is priority** (top runs first). A checkbox encodes
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
- **Reprioritize** by moving a line up (or `queue top <id>`); **edit/remove** by
  changing/deleting lines; **pause** with `status: stopped` (or `queue stop`). The
  worker re-reads the file every tick, so hand edits take effect on the next wake.

Task lines and their fields survive worker writes; **freeform prose does not**.
Runtime sidecars `log.md` (audit trail) and `archive.md` sit alongside and are
git-ignored; `queue.md` itself is committed so the queue is durable and visible.

## Command surface (`scripts/queue.ts`)

```
list | show <id>                       # overview | one task's full spec
add "<title>" [flags]                  # append a task (flags below); --top to prepend
add-many                               # seed many tasks from stdin, one per line
set <id> <field> <value>               # edit a field (mode/slug/deps/files/validate/accept)
next | ready                           # serial pick | fan-out candidate set (under the cap)
tick                                    # serial loop entry: reclaim → begin → print task
claim <id> [--worker w]                # atomic claim for a parallel worker
done <id> [--skip-validate]            # run the task's validate, then complete
fail <id> [reason...]                  # record a failure (retries, then terminal)
top <id> | remove <id>
start | stop                           # run or pause the whole queue
interval <dur> | config <key> <value>  # cadence | maxFailures|leaseMinutes|maxParallel|integrationBranch
worktree add|remove|list <id>          # isolated git worktree per task
archive | loop                          # sweep done/failed | print the /loop invocation
```

`add`/`set` flags: `--mode chain` · `--slug <s>` · `--deps a,b` · `--files a,b` ·
`--validate "<cmd>"` · `--accept "<criteria>"` · `--top`. Override the file with
`QUEUE_FILE=<path>`.

## Creating a queue from in-memory items

When you already hold a list of work, pipe it in — one item per line (leading
bullets/checkboxes are stripped) — to build or extend the queue in one call:

```bash
printf 'Write the README\nAdd unit tests\nWire the CI\n' | node scripts/queue.ts add-many
```

`add-many` **appends** (never clobbers) and also takes positional args.

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
   - otherwise it reclaims any stale lease, marks the current task `active`, and
     prints a `<queue_task>` block with its `mode` and spec. That's your one unit.
2. **Execute** per its mode (`direct` or the `chain` sequence above), honoring the
   no-user-input contract.
3. **Complete:** `queue done <id>` (runs `validate`; refuses → counts as a failure)
   or `queue fail <id> "<reason>"`.
4. **Commit** the work so each drained task is a reviewable checkpoint.

A resumed `active` task is preferred next wake; otherwise the topmost **eligible**
pending task (all `deps` done) starts. Failures don't halt the queue — a failed
task retries (dropped to the back) up to `maxFailures`, then goes terminal, and
independent work keeps flowing.

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
each `queue claim <id> --worker <name>` (assign + verify sole owner), work their
own worktree, and merge back. The `lease`/`reclaimStale` machinery returns a
crashed worker's task to `pending`. Use this to drain faster or across machines.

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
| `3` | idle — nothing eligible | re-arm the fallback at config **`idlePoll`** (default 20m) to catch newly-added work |
| `4` | paused for a usage window | slow-poll at config **`pausePoll`** (default 30m); auto-resumes when the window reopens |
| `5` | stopped (manual) | halt until `queue start` |

The three fallback cadences are all editable config: `interval` (fixed one-tick
loops), `idlePoll` (continuous-drainer idle fallback), `pausePoll` (paused). Set
them with `queue config idlePoll 20m` etc. `node scripts/queue.ts loop` prints the
invocation for the current state — it wakes at `idlePoll` and drains continuously
each wake — so you never hardcode a delay.

**Enqueue kicks the drain.** After `add`/`add-many` on a running, idle queue the CLI
hints to start now — so newly-added work begins in seconds, not on the next poll.
When you add tasks and no drain is running, start one immediately.

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

1. **The file is the source of truth and the user's to steer.** Re-read it every
   tick; honor hand edits (reorder, add/remove, `status: stopped`) immediately.
2. **No user input during a drain.** Never ask a question; underspecified → `fail`
   with a `needs-spec:` note and move on. Spec at enqueue time, not mid-run.
3. **Chain tasks run the whole chain autonomously** — generate the design from the
   spec (no grill), auto-accept phase gates, never wait for "continue."
4. **Mutate only through `scripts/queue.ts`** so the format round-trips; humans may
   hand-edit, the worker may not corrupt.
5. **Never blind-merge a worktree.** Merge-back is agent-driven; on conflict,
   reconcile carefully or fail safe (D7). Failures never halt independent work.
6. **Stopped means stopped** — a `tick` does nothing until `queue start`.
