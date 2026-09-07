# PRD: Agent loop

## Problem Statement

Agents end turns with unfinished work. A skill-only instruction cannot restart
them. Users need an external driver with an interval and a concrete instruction.

## Solution

A discoverable loop skill wraps native scheduling tools or a systemd-backed
TypeScript CLI, with durable command configuration and lifecycle controls.

## User Stories

1. Schedule a quoted agent instruction every 10min without shell evaluation.
2. Run an explicit argv command repeatedly, independent of the chat lifetime.
3. Inspect configured interval, process state, failure count, and logs.
4. Stop future invocations without killing in-flight work, or explicitly cancel it.
5. Refuse duplicates, malformed input, and unsupported scheduler environments.
6. Bound runaway jobs by runtime, lifetime, and consecutive failures.
7. Recover scope from a durable handoff, respecting existing queue and lane limits.

## Implementation Decisions

CLI verbs: start, status, stop, logs, plus an internal timer-run entrypoint.
Inputs: checkout, interval, lifetime, timeout, failure limit, and argv.
Structured JSON on stdout; child output retained in private logs. Unit identity
is derived from canonical checkout. Configuration never overwrites repo source.
Systemd provides non-overlap and process-tree timeout. No global settings change.

## Testing Decisions

Test the CLI from temporary checkouts: argv preservation, validation, duplicate
start, recurrence, non-overlap, graceful stop, cancellation, failure limits, and
unsupported manager failure. Use harmless local commands, never real agent calls.
Run an opt-in real systemd integration smoke and scaffold sync/discovery checks.

## Out of Scope

Windows-native/macOS external drivers, reboot persistence, billing prediction,
new agent permissions, and a replacement for queue or subagent management.
