[← Scaffold at a glance](system-map.md)

# Queue task lifecycle

The states a queue task passes through, from the owner's request to a merged PR.

```mermaid
flowchart LR
  n_add["Add"] --> n_pending["Pending"]
  n_pending["Pending"] --> n_active["Active"]
  n_active["Active"] --> n_outcome["Outcome"]
  n_outcome["Outcome"] --> n_deliver["Deliver"]
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  classDef lane2 fill:#ddd6fe,stroke:#6d28d9,color:#1f2937
  class n_add lane0
  class n_pending,n_active,n_outcome lane1
  class n_deliver lane2
```

- [Add](#add): The owner asks for work and the agent records it with the owner's words.
- [Pending](#pending): The task waits its turn; the top eligible line runs first.
- [Active](#active): A worker or slot claims the task and a lease clock starts.
- [Outcome](#outcome): Running validate on done, or an explicit fail, decides done, retry or failed.
- [Deliver](#deliver): In per-task mode, the task's PR must merge before the queue moves on.

## Add

The owner asks for work and the agent records it with the owner's words.

Details: [/queue skill](../../../skills/queue.md)

- queue add --requested stores the owner's words with a title, an accept note and a validate command.
- queue.db is the store; queue.md is its committed, readable view, re-rendered on each change.

## Pending

The task waits its turn; the top eligible line runs first.

- Three kinds of waiting
  - Eligible: its deps are done and it is not held.
  - Waiting: a dep or gate is unfinished.
  - Held: set aside; the drain skips it until unheld.

## Active

A worker or slot claims the task and a lease clock starts.

Details: [One loop tick](loop-tick.md)

- A tick or claim --worker sets the task's owner to the worker or slot.
- release, or park --resume, returns it to pending.

**Where it breaks**

- The lease is the age of the claim, not a process id; tick never reclaims an expired lease, it stops and reports.

## Outcome

Running validate on done, or an explicit fail, decides done, retry or failed.

- A failure below maxFailures goes back to pending for a retry.
- At maxFailures it is marked failed and stays visible; requeue revives it.
- A done task auto-archives to archive.md, but stays while unfinished work depends on it.

**Task markers in queue.md**

| Marker | Meaning |
|---|---|
| [ ] | pending |
| [>] | active (claimed) |
| [~] | parked with a resume note |
| [x] | done |
| [!] | failed |

## Deliver

In per-task mode, the task's PR must merge before the queue moves on.

Details: [PR workflow](pr-workflow.md)

- PR, real checks, and the owner approves the merge.
- Then a fresh branch and queue advance --pr --branch.

**Where it breaks**

- tick exits 7 until the task is advanced; that means delivery is pending, not that the queue drained.

## Detailed flow

![Queue task lifecycle, detailed](../generated/queue-lifecycle.svg)

## Glossary

- **Lease**: How long a claim has been held; not a process id.
- **Gate**: A task every other task depends on, used to block work temporarily.
- **maxFailures**: The retry cap before a task fails for good.
- **advance**: Records the merged PR and the fresh branch so the queue moves on.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how a task moves through scaffold's work queue, from request to merged PR.
Read this page: https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/queue-lifecycle.md
Scaffold: https://github.com/victusfate/scaffold

Questions worth asking:
- Why does a done task still hold up the queue until its PR merges?
```
