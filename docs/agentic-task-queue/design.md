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

### D4 — Isolation model

Each `/queue step` invocation loads only the `contextFiles` listed in the task.
No session state carries over between steps. On failure, the executor issues
`git reset --hard` to the pre-step commit hash and marks the task `"failed"`.

### D5 — Skill home

The `/queue` skill lives in the `system/agentic/queue-manager` namespace. It
ships as a scaffold skill following the standard harness format.

---

## Canonical Vocabulary

| Term | Definition |
|------|------------|
| **task** | A single independent unit of work with its own context, command, and validation |
| **registry** | `.agent/queue.json` — the shared file tracking all tasks |
| **slicer** | The ingest-time component that breaks a feature prompt into tasks and infers dependencies |
| **alignment loop** | The interactive Q&A phase during manual ingest that resolves design parameters |
| **context collision** | Conflict when an automated task claims files already locked by a pending manual task |
| **origin** | How a task entered the queue: `"manual"` or `"automated/routine/<subtype>"` |
| **context lock** | Implicit exclusive claim on `contextFiles` held by a `pending` or `running` manual task |

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
  "activeAgentPid": null,
  "result": {
    "commitHash": null,
    "outputLog": null
  }
}
```

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

1. Set task `status = "running"`, record `activeAgentPid`.
2. Load only the task's `contextFiles` — no other session state.
3. Apply code changes to satisfy the task requirements.
4. Run `command` then `validationScript`.
5. **Success (exit 0):** commit, set `status = "completed"`, clear `activeAgentPid`.
6. **Failure:** `git reset --hard <pre-step-commit>`, set `status = "failed"`,
   write trace to `result.outputLog`, clear `activeAgentPid`.

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

### OQ3 — Skill harness target

Which harnesses does `/queue` ship to: Claude only, or also Cursor / Antigravity?
Determines the emit targets for `hoist-skill`.

### OQ4 — `run-all` failure behavior

Does a single task failure in `run-all` halt the whole queue, or does it skip
and continue with the next non-dependent task? Spec says "halts instantly" —
confirm this is the intended behavior even when unrelated tasks remain pending.
