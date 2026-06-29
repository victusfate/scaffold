# Design: Agentic Task Queue

> Source: user-supplied feature specification
> Purpose: Structured work queue for agent execution — prevents session pollution,
> agent divergence, and token blowup during long execution cycles.

---

## Problem Statement

Long agent sessions accumulate context from multiple unrelated tasks, leading to
session pollution, divergent execution paths, and ballooning token usage. A
structured task queue isolates each unit of work: one task per agent session,
with a shared registry tracking state, dependencies, and provenance.

---

## Decisions

### D1 — Registry format

Tasks are stored in `.agent/queue.json` — a flat JSON array of task objects.
Each task is self-contained: it carries its own context file list, validation
command, dependency references, status, and result log. The registry is the
single source of truth; no state lives in agent sessions.

### D2 — Topological ordering

Tasks declare explicit `dependsOn` arrays (by task ID). The queue executor
never starts a task until all declared dependencies are `"completed"`. The
slicer that produces tasks is responsible for inferring these relationships
at ingest time — the executor is stateless with respect to ordering logic.

Among tasks that are all dependency-eligible, selection is **FIFO (insertion
order)**. The `dependsOn` gate does the real ordering work; an explicit
`priority` field is intentionally omitted from v1 and can be added later without
schema disruption.

### D3 — Dual ingestion paths

Manual ingestion (`/queue ingest`) runs an interactive alignment loop before
slicing. Automated ingestion (watchers, cron hooks) skips the alignment loop
and performs a context-collision check instead: if any file in the proposed
task's `contextFiles` is claimed by a pending manual task, the automated task
is dropped or deferred.

### D4 — Isolation model: worktree per task

Each task executes in its **own git worktree** on its **own branch**, cut from
the integration branch (see D6). The agent loads only the task's `contextFiles`;
no session state carries between tasks.

- **Success + validation passes:** commit on the task branch, merge that branch
  back into the integration branch, delete the worktree, mark `"completed"`.
- **Failure:** **delete the worktree** — nothing shared was touched, so there is
  no `git reset` to perform. Mark `"failed"`, write the trace to
  `result.outputLog`.

This replaces the original `git reset --hard` rollback. A shared working tree
forced serial execution and risked clobbering unrelated uncommitted work;
disposable worktrees give real isolation and make rollback a no-op (throw the
tree away).

### D5 — Skill home and harness targets

The `/queue` skill lives in the `system/agentic/queue-manager` namespace. It
ships as a scaffold skill following the standard harness format, emitted to
**all three harnesses — Claude, Cursor, and Antigravity** — via `hoist-skill`,
consistent with the rest of the scaffold skill set.

### D6 — Merge-back machinery: integration branch

The queue maintains a single **integration branch** — its running trunk. The
dependency relationship is realized through branch topology, not worktree
nesting (worktrees are flat checkouts sharing one object database; they do not
nest):

1. Each task branches off the integration tip into its own worktree.
2. On completion, the task branch merges back into integration.
3. A dependent task's worktree is cut from the integration tip **only after all
   its `dependsOn` branches have merged there.** So when task 4 (depends on
   1–3) begins, integration already contains 1, 2, and 3 — task 4 sees their
   work automatically, with no per-task octopus merge.

Two consequences:

- **Integration merges serialize even when execution parallelizes.** Tasks 1–3
  may *run* concurrently, but they merge into integration one at a time;
  conflicts between sibling tasks resolve at merge, sequentially. Merging is
  cheap relative to execution, so this is acceptable.
- **A dependent task sees everything merged before it, not strictly its
  declared deps.** For feature breakdown this is usually desired (work
  accumulates on the trunk). A strict "only my dependencies" base — cutting the
  task branch and merging exactly the parent branches — is possible when genuine
  isolation between unrelated tasks is required, at the cost of more merge
  machinery. Default is the integration model; strict mode is deferred.

### D7 — Merge-back conflict: replay, don't re-run

When a completed task branch fails to merge cleanly (a sibling landed on
integration first and touched adjacent lines), the queue **never re-executes the
task** — the worker already did valid work that may have cost minutes. Instead it
**replays the existing commits** onto the updated integration tip:

1. **Rebase** the task branch onto the current integration tip. Git replays the
   worker's commits; non-overlapping changes auto-resolve. No agent involvement,
   no re-execution.
2. **Clean rebase →** re-run `validationScript` only (cheap relative to redoing
   the work) to confirm the combined state still passes, then merge. Done.
3. **Rebase conflict, or post-rebase validation failure →** spawn a scoped
   **reconciliation step** that receives the task's full context (task spec, the
   branch diff, the conflicting hunks or failing test) and resolves *only the
   delta* — the conflicting hunks or the broken assertion — not the whole task.

The worker's commits are the preserved context: re-running is the last resort,
reserved for genuine semantic conflict, and even then it is scoped to the
conflict rather than the entire task. Re-execution of the full task from scratch
is never the default path.

### D8 — `run-all` failure policy: continue on independent work

A task failure does **not** halt the queue. The failed worktree is discarded and
the integration branch is untouched, so every remaining dependency-eligible task
still runs. Only the failed task's **transitive dependents** are skipped — their
base never landed — and they are reported in the run summary. This maximizes
throughput of an unattended drain; halting on first failure would strand ready
independent work.

### D9 — Automated ingestion is in scope for v1

Both ingestion paths ship in v1 (D3). Automated ingestion keeps the
context-collision check: a proposed automated task whose `contextFiles` overlap
a `pending` or `running` manual task's `contextFiles` is **deferred, re-evaluated
on the next watcher cycle**, and only dropped after a bounded number of deferrals
(configurable; default 3) to avoid an indefinitely starved automated task. Manual
work always wins the lock; automated maintenance yields.

---

## Canonical Vocabulary

| Term | Definition |
|------|------------|
| **task** | A single independent unit of work with its own context, command, and validation |
| **registry** | `.agent/queue.json` — the shared file tracking all tasks |
| **slicer** | The ingest-time component that breaks a feature prompt into tasks and infers dependencies |
| **alignment loop** | The interactive Q&A phase during manual ingest that resolves design parameters |
| **integration branch** | The queue's running trunk; completed task branches merge back into it |
| **task branch** | The per-task branch, cut from the integration tip and checked out in the task's worktree |
| **worktree** | A disposable git checkout (one per running task) sharing the repo's object database |
| **merge-back** | Merging a completed task branch into the integration branch |
| **context collision** | Conflict when an automated task claims files already claimed by a pending manual task |
| **context lock** | Implicit claim on `contextFiles` held by a `pending` or `running` manual task |
| **origin** | How a task entered the queue: `"manual"` or `"automated/routine/<subtype>"` |

---

## Task Schema

```json
{
  "id": "task-001",
  "title": "Build native telemetry metrics interface",
  "status": "pending",
  "origin": "manual",
  "dependsOn": [],
  "contextFiles": ["src/telemetry/index.ts", "src/telemetry/types.ts"],
  "command": "npm test",
  "validationScript": "scripts/validate-telemetry.sh",
  "branch": null,
  "worktreePath": null,
  "deferrals": 0,
  "result": {
    "mergeCommit": null,
    "outputLog": null
  }
}
```

`branch` and `worktreePath` are populated when the task enters `"running"` and
the worktree is created. `result.mergeCommit` records the integration-branch
commit produced by merge-back on success. `deferrals` counts collision-check
deferrals for automated tasks (D9); manual tasks leave it at `0`.

**Status transitions:**

```
pending → running → completed
                  ↘ reconciling → completed | failed   (merge-back conflict, D7)
                  ↘ failed                              (task or validation failure)
```

`reconciling` is the transient state while a completed task branch is being
rebase-replayed and, if needed, reconciled against the integration tip.

---

## Work Ingestion Lifecycle

```
[ Human Feature Prompt ]          [ Automated Background Monitors ]
          |                                       |
          v                                       v
/queue ingest "<msg>"              Watcher / cron / telemetry trigger
          |                                       |
          v                                       v
 Alignment Loop (Q&A)             Context Collision Check
          |                           |               |
          v                       no conflict      conflict
  Topological Slicer                  |               |
          |                      Silent insert      Drop / defer
          v                           |
 Append to .agent/queue.json  ←───────┘
```

### 3.1 Manual Ingestion (`/queue ingest`)

1. **Alignment loop** — query design parameters, storage backends, and
   verification metrics interactively. One question at a time until resolved.
2. **Topological slicing** — compile alignment results into independent
   execution units; infer chronological dependencies; assign `dependsOn` arrays.
3. **Queue insertion** — write tasks with `origin: "manual"`, `status: "pending"`.

### 3.2 Automated Ingestion

1. **Trigger** — file-watcher, telemetry monitor, or cron hook fires.
2. **Collision check** — compare proposed task's `contextFiles` against files
   claimed by any `pending` or `running` manual task. Drop or defer on conflict.
3. **Silent insertion** — non-conflicting tasks written with
   `origin: "automated/routine/<subtype>"`, `status: "pending"`.

---

## Skill Interface (`/queue`)

### `/queue ingest "<prompt>"`

Enters the alignment loop. On completion, slices and appends tasks to the registry.

### `/queue next`

Scans the registry for the highest-priority task where `status == "pending"` and
all `dependsOn` entries are `"completed"`. Returns that task block.

### `/queue step <task_id>`

1. Set task `status = "running"`. Cut a `task branch` from the integration tip
   and `git worktree add` a fresh worktree; record `branch` and `worktreePath`.
2. Load only the task's `contextFiles` — no other session state.
3. Apply code changes to satisfy the task requirements.
4. Run `command` then `validationScript`.
5. **Success (exit 0):** commit on the task branch, then merge-back per D6/D7:
   - Clean merge → record `result.mergeCommit`, delete the worktree, set
     `status = "completed"`.
   - Merge conflict → **rebase the task branch** onto the integration tip and
     replay (D7). Clean rebase + passing validation → merge and complete.
     Otherwise enter scoped reconciliation; only genuine semantic conflict
     re-engages the worker, scoped to the delta.
6. **Failure:** delete the worktree (no reset needed — the integration branch was
   never touched), set `status = "failed"`, write trace to `result.outputLog`.

### `/queue run-all`

Loop: `/queue next` → `/queue step`. On a task **failure, continue** with the
remaining dependency-eligible tasks — the failed worktree is discarded and the
integration branch is untouched, so independent work still runs (D8). The failed
task's **dependents are skipped** (their base never landed) and reported.
Terminate when no eligible task remains; emit:
`<queue_engine_state>TERMINATED_CLEANLY</queue_engine_state>`

---

## Resolved Decisions

All open questions from the prior revision are resolved:

| # | Question | Resolution | Encoded in |
|---|----------|------------|------------|
| OQ1 | Priority ordering | FIFO among dependency-eligible tasks; no `priority` field in v1 | D2 |
| OQ2 | Collision resolution for automated tasks | Defer and re-evaluate next watcher cycle; drop after N deferrals (default 3); manual work wins the lock | D9 |
| OQ3 | Harness target | Ship to all three: Claude, Cursor, Antigravity | D5 |
| OQ4 | `run-all` failure behavior | Continue with independent tasks; skip the failed task's transitive dependents | D8 |
| OQ5 | Merge-back conflict handling | Rebase-replay existing commits, never re-run the task; scoped reconciliation only on genuine conflict | D7 |

## Remaining Implementation Notes

These are sequencing details for the plan phase, not open design questions:

- **Concurrency cap** — how many worktrees run in parallel. A simple fixed cap
  (e.g. CPU-bound) is fine for v1; tune later.
- **Reconciliation worker context** — exact payload handed to the D7
  reconciliation step (diff format, how the failing assertion is surfaced).
  A plan-phase concern.
- **Strict "only my deps" base** (D6) — deferred; default integration model
  ships in v1.
