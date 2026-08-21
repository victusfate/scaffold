# Design: Queue Console

> Source: queued task — "dedicated interface (CLI + local web page) to manage,
> prune, update, and reprioritize the queue" — run autonomously (no interactive
> grill; decisions below are best-guess resolutions recorded for review).
> Purpose: give a human a fast steering surface over `.agent/queue/queue.md`
> without hand-editing Markdown or memorizing CLI syntax.

---

## Problem Statement

The work queue is already durable and agent-drainable (`scripts/queue.ts` +
`scripts/queue-model.ts`), and the design principle is "the file is the user's
to steer." In practice, steering means hand-editing `queue.md` (error-prone:
checkbox typos, field drift) or issuing CLI commands one at a time with only
`queue top` for reordering — there is no way to place a task at an arbitrary
position, no bulk view of specs while editing, and no live view while a drain
is running.

The console closes that gap with two surfaces over the **same mutation layer**:

1. **CLI** — new `move` / `requeue` commands completing the management verb set
   of `scripts/queue.ts`.
2. **Local web page** — a zero-dependency live dashboard (`scripts/
   queue-console.ts`) to view, add, edit, prune, reorder (drag), and
   start/stop the queue, hot-refreshing as workers write the file.

---

## Decisions

### D1 — Home: repo-local scripts, not a tool/ or bin/ unit

Per `docs/agent-authoring-requirements.md` §1, this is repo-local plumbing run
by a human or a skill → `scripts/queue-console.ts` (server) + a template HTML
file, with new pure operations added to `scripts/queue-model.ts` and new
commands added to `scripts/queue.ts`. No `tools/` descriptor and no `bin/`
entry: the console is not agent-called with typed args and not distributed via
npx. The `/queue` skill doc gains a "Console" section as the conversational
front door.

### D2 — All mutations go through the existing model layer

The server never edits Markdown text. Every mutation is a pure
`queue-model.ts` operation (`addTask`, `setField`, `removeTask`, `moveTask`,
`requeueTask`, `setConfig`, …) applied to a freshly parsed queue and written
back via `serializeQueue` — the same round-trip contract as `queue.ts`
(critical rule: agents/tools mutate only through the model so the format never
corrupts). Concurrency stance matches the existing CLI: read-modify-write,
last-writer-wins, each request re-reads the file so the window is one request
wide. This is parity, not a regression; a lock file is out of scope for v1.

### D3 — Management-only surface: the console never executes commands

`done` runs a task's `validate` shell command; exposing that over HTTP turns a
localhost page into a command-execution endpoint. The console is for
**managing** the queue (what runs, in what order), not for **executing** it
(that is the worker's job). Therefore the web surface offers exactly:

- add (title + optional spec fields), edit fields, remove
- reorder (drag to any position; `top` shortcut)
- requeue a failed task (reset to pending, failures cleared)
- start / stop the queue, edit interval / maxParallel
- archive sweep (prune done/failed into `archive.md`)

It deliberately has **no** done/fail/claim/worktree buttons and never spawns a
process. Status transitions beyond requeue stay with workers and the CLI.

### D4 — Server shape: zero-dependency Node HTTP + SSE, loopback only

Follow the proven `mermaid-watch.ts` pattern: `node:http`, `fs.watchFile`,
Server-Sent Events, TypeScript run via Node type-stripping, no packages. The
server binds `127.0.0.1` only (never `0.0.0.0`) — it is a personal local
console, so no auth layer is added. Routes:

| Route | Method | Behavior |
|---|---|---|
| `/` | GET | the console page (template with inline JS/CSS, no CDN) |
| `/api/queue` | GET | current queue as JSON (`ConsoleState`) |
| `/api/op` | POST | one `Op` JSON body → apply → save → return new state |
| `/events` | SSE | pushes `changed` when `queue.md` changes on disk |

Default port `8722`, `--port` to override; `QUEUE_FILE` env honored exactly as
in `queue.ts`. Usage: `node scripts/queue-console.ts [--port 8722]`.

### D5 — One op endpoint with a typed dispatcher, mirroring the CLI

`POST /api/op` carries `{ "op": "<name>", ...args }`. A pure, exported
`applyOp(queue, op)` validates the name + args and returns the new queue (or a
typed error) — the web twin of `queue.ts`'s command switch, unit-testable
without a server. Op set (v1): `add`, `set`, `remove`, `move`, `top`,
`requeue`, `start`, `stop`, `config` (interval/maxFailures/leaseMinutes/
maxParallel/integrationBranch/idlePoll/pausePoll), `archive`. Unknown op or
malformed args → HTTP 400 with a message, queue untouched.

### D6 — Reordering: `move` to an explicit position, pure and clamped

New pure op `moveTask(q, id, toIndex)` — remove the task from its slot, insert
at `toIndex` (0-based, clamped to the list bounds); unknown id is a no-op
returning the queue unchanged (same tolerance as `moveToTop`). The CLI gains
`queue move <id> <pos>` where `<pos>` is 1-based to match the numbering
`queue list` prints, plus `up`/`down` as relative one-step aliases. Drag-drop
on the web page emits the same op with the drop index.

### D7 — Requeue: the prune-adjacent recovery verb

`requeueTask(q, id)` — pure: only meaningful for a `failed` (or stuck
`pending`-with-failures) task; resets `status: 'pending'`, `failures: 0`,
clears `note`/`owner`/`startedAt`. Keeps its position. CLI: `queue requeue
<id>`. Rationale: today a terminal-failed task can only be removed or
hand-edited back to life; requeue makes "I fixed the spec, run it again" a
first-class management action from both surfaces.

### D8 — Live refresh that never fights the user's edit

The page holds a `ConsoleState` snapshot and re-renders on every SSE `changed`
event **unless** an edit form/drag is in progress; then it shows a "queue
changed on disk — refresh" banner instead and defers. After any successful
`/api/op` POST the server returns the fresh state, so the actor's own view
updates immediately without waiting for the watcher. `watchFile` interval
500ms.

### D9 — Layout (best guess, single page)

- **Header bar**: status pill (`running` / `stopped` / `paused until …`),
  pending/active/done/failed counts, interval + maxParallel inline-editable,
  Start/Stop button, Archive-sweep button, drain hint when `drainSignal` fires.
- **Add row**: one-line title input + "Add" (top or bottom toggle); an
  expandable detail area for mode/slug/deps/files/validate/accept.
- **Task list** (the priority order, top = next): each row shows status badge,
  id, title, tag chips (chain, deps, retries, owner), drag handle, and buttons
  ↑-top / requeue (failed only) / edit / remove. Edit expands the row into a
  field grid (title, mode, slug, deps, files, validate, accept, note) with
  Save/Cancel.
- Empty queue → "(empty — add a task above)". No pagination; queues are small.
- Styling: small hand-written CSS in the template, dark-friendly, no fonts or
  assets fetched.

### D10 — Testing strategy

- Pure layer (`moveTask`, `requeueTask`, `applyOp`, state shaping): unit tests
  in the existing `node:assert` style, added to the queue test files.
- Server layer: integration test that boots the server on an ephemeral port
  with a temp `QUEUE_FILE`, exercises GET `/`, GET `/api/queue`, a POST op
  round-trip (mutation visible in the file), a 400 on a bad op, and loopback
  binding; wired into `npm test`.
- Template: asserted to contain the required mount points/op names (no browser
  automation in v1).

### D11 — Naming and discoverability

Everything is "queue console": `scripts/queue-console.ts`,
`scripts/queue-console.template.html`, `scripts/queue-console.test.ts`. The
`/queue` skill's command-surface block adds one line for `move`/`requeue` and
a short **Console** subsection ("`node scripts/queue-console.ts` → open
http://localhost:8722"). `queue.ts`'s usage header lists the new commands.

---

## Canonical Vocabulary

| Term | Meaning |
|---|---|
| **console** | the management interface as a whole (CLI verbs + web page) |
| **console server** | the local HTTP process (`scripts/queue-console.ts`) |
| **console page** | the single HTML page served at `/` |
| **`ConsoleState`** | JSON snapshot of the queue the page renders: config + ordered tasks + derived flags (eligible, deadlocked, drain signal) |
| **op** | one named, validated mutation posted to `/api/op` and dispatched by `applyOp` |
| **move** | reorder a task to an explicit position (0-based in the model, 1-based in the CLI) |
| **requeue** | reset a failed task to pending with failures cleared, position kept |
| **prune** | removing tasks and/or sweeping done/failed to `archive.md` |
| **management surface** | the verb set the console exposes — never task execution (no done/fail/claim, no shell commands) |

---

## Scenarios

1. **Reprioritize mid-drain** — a worker is active on task-004; the user drags
   task-009 to position 2. The file is rewritten through the model; the worker
   picks up the new order on its next tick; the active task is untouched.
2. **Prune after a bad batch** — user multi-removes three stale tasks and hits
   Archive; done/failed rows leave the live queue; `archive.md` gains a block.
3. **Revive a failed task** — task-007 is terminal-failed with a `needs-spec`
   note; user edits its `accept` field, hits requeue; it is pending again with
   failures 0 and gets picked up (drain hint shows if no driver is attached).
4. **Concurrent write** — a worker archives a finished task while the page is
   idle; SSE fires; the page re-renders the shrunken queue within ~500ms.
5. **CLI-only reorder** — `node scripts/queue.ts move task-012 1` puts the
   task at the head, identical to dragging it there.

---

## Out of scope (v1)

- Any execution verbs on the web surface (done/fail/claim/worktree/validate).
- File locking / multi-writer serialization beyond last-writer-wins parity.
- Auth, TLS, non-loopback binding, or serving beyond one machine.
- Editing `log.md` / `archive.md` from the page (read-only artifacts).
- Browser-automation tests.
