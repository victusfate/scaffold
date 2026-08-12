## Purpose

A **visible, editable Markdown work queue** that loop-driven agents drain one task
at a time. The queue lives in a single file you can open and edit at any moment —
`.agent/queue/queue.md` — so you can see everything that's pending, reprioritize by
moving lines, stop or restart the worker, and add or remove work by hand. An agent
wakes on an interval (default 6 min), works the current task or starts the next
one, and marks it done — then sleeps until the next wake.

The reliable read/mutate layer is `scripts/queue.ts`; never hand-rewrite the file
programmatically — go through the CLI so the format stays intact. Humans editing
the file by hand is expected and safe.

## The queue file

One Markdown file, fully human-readable. **Line order is priority** (top runs
first). A checkbox encodes each task's status:

```markdown
# Work Queue

<!-- queue:config
status: running
interval: 6m
-->

- [ ] task-001 — Add telemetry interface
- [>] task-002 — Refactor the parser
- [x] task-003 — Fix the login bug
- [!] task-004 — Broken migration
```

- `[ ]` pending · `[>]` active (the current task) · `[x]` done · `[!]` failed
- `status: running | stopped` — a stopped queue makes every `tick` a no-op.
- `interval` — how often the loop wakes; editable, default `6m`.

To **reprioritize**, move a line up (or run `queue top <id>`). To **edit or
remove** work, change or delete a line. To **pause**, set `status: stopped` (or run
`queue stop`). The worker re-reads the file every tick, so hand edits take effect
on the next wake.

## Command surface (`scripts/queue.ts`)

```
node scripts/queue.ts list                    # show the queue
node scripts/queue.ts add "Do the thing"      # append a pending task (--top to prepend)
node scripts/queue.ts add-many                # seed many tasks from stdin, one per line
node scripts/queue.ts next                     # print the next actionable task (no mutation)
node scripts/queue.ts tick                     # loop entry: begin/continue the current task
node scripts/queue.ts done <id> | fail <id>    # mark the current task's outcome
node scripts/queue.ts top <id>                 # reprioritize a task to the top
node scripts/queue.ts remove <id>              # drop a task
node scripts/queue.ts start | stop             # run or pause the worker
node scripts/queue.ts interval 6m              # edit the wake interval
```

Override the file location with `QUEUE_FILE=<path>` (useful for a scratch queue).

## Creating a queue from in-memory items

When you (the agent) already hold a list of work items, pipe them straight in —
one per line — to build or extend the queue in a single call. Leading Markdown
bullets/checkboxes are stripped, so a pasted list works as-is:

```bash
printf 'Write the README\nAdd unit tests\nWire the CI\n' | node scripts/queue.ts add-many
```

`add-many` **appends** to any existing queue (it never clobbers), and also accepts
items as positional args: `node scripts/queue.ts add-many "task a" "task b"`.

## The tick cycle (what the worker does on each wake)

This is the loop body. Keep it tight — one task per wake:

1. **Read state:** `node scripts/queue.ts tick`.
   - `queue: STOPPED` → do nothing; end the turn. The user paused it.
   - `queue: IDLE — no pending tasks` → nothing to do; end the turn.
   - Otherwise it prints the current task inside a `<queue_task id="…">` block and
     has marked it `active`. That is your one unit of work for this wake.
2. **Do the work** described by the task title, in the current repo. Load only what
   that task needs — don't drag in unrelated context.
3. **Validate** with the repo's checks (tests / typecheck / lint) as appropriate.
4. **Record the outcome:**
   - success → `node scripts/queue.ts done <id>`
   - failure → `node scripts/queue.ts fail <id>` (leave a note; move on — a failed
     task never blocks the rest of the queue).
5. **Commit** the work so each drained task is a reviewable checkpoint.

On the next wake the queue advances automatically: a resumed `active` task is
preferred, otherwise the topmost pending task starts.

## Running it on a loop

Drive the tick cycle with the `/loop` skill (or any recurring runner). The
interval is editable in two places — keep them in sync:

- **`/loop <interval> <prompt>`** sets the wake cadence, e.g.
  `/loop 6m work the next task in the queue: run \`node scripts/queue.ts tick\`, do it, then mark it done or fail`.
- **`queue interval 6m`** records the intended interval in the file so it's visible
  to anyone reading the queue.

Change the cadence any time with `/loop`'s own interval and `queue interval`; stop
the drain with `queue stop` (or by pausing the loop), restart with `queue start`.

## Critical rules

1. **The file is the source of truth and it's the user's to steer.** Re-read it
   every tick; honor hand edits (reordering, added/removed lines, `status:
   stopped`) immediately.
2. **One task per wake.** Don't batch-drain the whole queue in a single tick unless
   explicitly asked — small, inspectable steps keep the user able to redirect.
3. **Never auto-rewrite the file by hand.** Mutate only through `scripts/queue.ts`
   so the format round-trips; humans may edit freely, the CLI may not corrupt.
4. **Failures don't halt the queue.** Mark `fail` and continue; a stuck task
   shouldn't strand independent work behind it.
5. **Stopped means stopped.** When `status: stopped`, a `tick` does nothing —
   never resume on your own; wait for `queue start`.
