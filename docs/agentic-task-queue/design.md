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

### D5 — Skill home

The `/queue` skill lives in the `system/agentic/queue-manager` namespace. It
ships as a scaffold skill following the standard harness format.

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
  "result": {
    "mergeCommit": null,
    "outputLog": null
  }
}
```

`branch` and `worktreePath` are populated when the task enters `"running"` and
the worktree is created. `result.mergeCommit` records the integration-branch
commit produced by merge-back on success.

**Status transitions:** `pending` → `running` → `completed` | `failed`

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
5. **Success (exit 0):** commit on the task branch, merge it into the
   integration branch (record `result.mergeCommit`), delete the worktree, set
   `status = "completed"`.
6. **Failure:** delete the worktree (no reset needed — the integration branch was
   never touched), set `status = "failed"`, write trace to `result.outputLog`.

### `/queue run-all`

Loop: `/queue next` → `/queue step` until queue empty or a step fails.
On termination emit: `<queue_engine_state>TERMINATED_CLEANLY</queue_engine_state>`

---

## Open Questions

### OQ1 — Priority ordering

The spec references "highest-priority" in `/queue next` but does not define a
priority field or ordering rule. Options: insertion order (FIFO), explicit
`priority` integer, or dependency-depth ordering. Decision needed before
implementing the slicer.

### OQ2 — Collision resolution for automated tasks

"Drop or defer" is underspecified. Defer to when? On the next watcher cycle?
After the conflicting manual task completes? Needs a concrete rule.

Note: the worktree + merge-back model (D6) lessens the need for upfront
collision-locking — sibling conflicts now surface at merge-back time, where git
resolves them, rather than requiring pre-emptive file locks. Whether to keep the
collision check at all (vs. letting all conflicts surface at merge) is itself
open and tied to OQ5.

### OQ5 — Merge-back conflict handling

When a completed task branch fails to merge cleanly into the integration branch
(a sibling task touched the same lines), what happens? Options: mark the task
`"failed"` and requeue for a re-run against the updated integration tip; pause
the queue for manual resolution; or attempt an automated 3-way merge and only
fail on genuine conflict. Decision needed before building merge-back.

### OQ3 — Skill harness target

Which harnesses does `/queue` ship to: Claude only, or also Cursor / Antigravity?
Determines the emit targets for `hoist-skill`.

### OQ4 — `run-all` failure behavior

Does a single task failure in `run-all` halt the whole queue, or does it skip
and continue with the next non-dependent task? Spec says "halts instantly."

The worktree model makes "skip and continue" safer than it was under
`reset --hard`: a failed task's worktree is discarded with the integration
branch untouched, so unrelated pending tasks could still run cleanly. A failed
task's *dependents*, however, must be skipped (their base never landed). Confirm
whether v1 halts on first failure (simpler) or continues with the independent
remainder (better throughput, requires dependent-skipping logic).
