# Agent loop

## User contract

`/loop 10min continue working on agreed upon tasks, sending jobs to 1 gpu lane
and up to 3 cpu lanes, merging in worktrees as they complete and managing
subagents to ensure they don't get stuck. If nothing else is pressing review
the work queue for tasks and keep grabbing work from there following its
interface and usage docs`

Ship as a scaffold PR. The user merges and syncs it to consumers. Do not start
an actual work loop or install personal skills as part of developing this PR.

## Decisions and vocabulary

- A loop is an externally scheduled, non-overlapping series of command runs.
- An instruction is natural language passed as one argument to a headless agent.
  It is never evaluated as shell source. An explicit command is an argv array.
- The interval is a delay after a completed run. First execution starts promptly.
- The driver is a native harness scheduler when exposed, or a detached Node
  supervisor on macOS, Linux/WSL, and native Windows. No pretend wakeup and no
  chat-local sleep loop. Cross-OS support is a user requirement, not a follow-up.
- The skill is the conversational front door. A TypeScript helper owns external
  scheduling, bounded execution, status, stop, and log retrieval.
- One external loop per canonical checkout. No concurrent scheduler writes to
  the same checkout. Different worktrees are distinct checkouts.
- Natural-language runs get an explicit durable handoff of the agreed scope,
  branch, authorization, and progress references, not assumed chat memory.
- Defaults are finite lifetime 8h, per-run timeout 30min, three consecutive
  failures. All are configurable. A successful agent exit is not task completion.
- Stop cancels future runs; explicit cancel also terminates current work. Stop
  on fulfilled objective is part of the instruction, not inferred from exit 0.
- The supervisor survives chat closure, not reboot/WSL shutdown or supervisor crash.
  No automatic lingering, permission, trust, or model changes.
- Native `/loop` wins in harnesses that provide it. The scaffold skill is invoked
  explicitly through skill selection there, not installed as a command override.

## Boundaries

The scheduler does not implement queue parsing, GPU scheduling, subagent APIs,
publication policy, or worktree integration. The instruction delegates these to
the repo's existing interfaces and limits. No paid agent invocation in tests.

## Review

Two concerns: conversational scope capture and deterministic scheduling. Native
scheduler support is conditional on actual tools. One portable supervisor owns
recurrence; only process-tree termination differs (POSIX groups vs Windows
taskkill). No separate launchd/systemd/Task Scheduler installation frameworks.
