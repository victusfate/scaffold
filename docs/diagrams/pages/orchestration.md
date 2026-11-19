[← Scaffold at a glance](system-map.md)

# Orchestration

How one orchestrator turns owner requests into merged work by handing tasks to subagents in their own lanes.

```mermaid
flowchart LR
  n_request["Owner requests"] --> n_dispatch["Dispatch"]
  n_dispatch["Dispatch"] --> n_work["Subagent works"]
  n_work["Subagent works"] --> n_integrate["Integrate"]
  n_integrate["Integrate"] --> n_ship["Authorized merge"]
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  classDef lane2 fill:#ddd6fe,stroke:#6d28d9,color:#1f2937
  class n_request,n_ship lane0
  class n_dispatch,n_integrate lane1
  class n_work lane2
```

- [Owner requests](#owner-requests): Only the owner creates tasks; the agent records the request in the queue.
- [Dispatch](#dispatch): On each loop tick, the orchestrator gives the top suited task to a free worker slot.
- [Subagent works](#subagent-works): The subagent builds its one task in its own worktree and commits locally.
- [Integrate](#integrate): The orchestrator merges the target into the lane, re-runs the gates and merges green work into the one working branch.
- [Authorized merge](#authorized-merge): The owner authorizes; the orchestrator squash-merges, and the task closes when the queue records it.

## Owner requests

Only the owner creates tasks; the agent records the request in the queue.

Details: [Queue task lifecycle](queue-lifecycle.md)

- The agent runs queue add --requested with the owner's words and an acceptance check.
- One shared record
  - queue.db holds typed tasks: status, owner, accept, evidence.
  - queue.md is the committed view; line order is priority.
  - Every worktree reads the same record.

**Where it breaks**

- An agent never adds its own tasks; its findings go to the owner instead.

## Dispatch

On each loop tick, the orchestrator gives the top suited task to a free worker slot.

Details: [One loop tick](loop-tick.md)

- It reads the slots from topology.json.
- It creates the worktree lane first, off the working branch's HEAD, then claims the task for that slot.
- Steering later
  - The orchestrator adds ORCH UPDATE notes to the task.
  - The subagent follows the newest one at its next checkpoint.

## Subagent works

The subagent builds its one task in its own worktree and commits locally.

Details: [Feature chain](feature-chain.md)

- It starts with an ff-only check that it is on the working branch's HEAD.
- A chore is built directly; a feature runs design, PRD, plan, TDD, refine.
- It validates, commits, records evidence and never pushes.

**Where it breaks**

- A subagent that skips its checkpoints misses the orchestrator's steering.

## Integrate

The orchestrator merges the target into the lane, re-runs the gates and merges green work into the one working branch.

Details: [Review gates](review-gates.md)

- Red gates send the work back to the lane.
- Then it opens a PR with Critical changes and real check results.

**Where it breaks**

- There is exactly one working branch per session; two long-lived branches split the work.

## Authorized merge

The owner authorizes; the orchestrator squash-merges, and the task closes when the queue records it.

Details: [PR workflow](pr-workflow.md)

- The PR lands on main as one squash commit.
- queue advance --pr --branch records the merge and the fresh branch.

## Detailed flow

![Orchestration, detailed](../generated/orchestration.svg)

## Glossary

- **Worktree**: An isolated git checkout per worker, so workers never collide.
- **Slot**: A worker seat (a model plus a tool) that the orchestrator hands tasks to; its id names the task owner.
- **ff-only**: Fast-forward only: the worker proves it starts from the working branch's HEAD, or stops.
- **ORCH UPDATE**: The orchestrator's steering note on a running worker's task.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's orchestrator splits work across
subagents and lands it on main.
Read this page:
https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/orchestration.md
Scaffold: https://github.com/victusfate/scaffold

Questions worth asking:
- Why can't the orchestrator merge to main on its own?
```
