# PRD: Multi-Queue Board (isolated consoles)

## Problem Statement
An operator running agents in two or more local repos needs confidence that each repo's queue console runs independently — no crossed tasks, locks, lanes, or ports — without ever firing up two live agents to prove it.

## Solution
Each repo runs its own existing console (`QUEUE_FILE=<repo>/queue.md`, own `--port`). A deterministic isolation test stands in for the live two-agent run: two console server processes on isolated ports with distinct queue files, asserting full independence. A short runbook documents the two-console workflow.

## User Stories
1. As an operator, I want to open repo A's console on port 1 and repo B's on port 2, so that I steer one repo at a time.
2. As an operator, I want proof that an op on console A (add/edit/reorder) never touches repo B's file, so that I trust isolation without a live two-agent run.
3. As an operator, I want both consoles to mutate concurrently without lock contention, so that parallel agents never block each other at the board.
4. As an operator, I want lane heartbeats for repo A to appear only on console A, so that live status never crosses streams.
5. As an operator, I want a runbook for the two-console setup (env, ports, bookmarks), so that starting the second console is a copy-paste step.

## Implementation Decisions
- No production code changes expected: per-file locks/sidecars/lanes (`queue-io.ts`, `queue-lanes.ts`) and single-file console binding (`queue-console.ts`) already give isolation; the test proves it rather than building it. If the test finds a leak, fix the leak — the PRD does not pre-authorize new features.
- New test module `scripts/queue-isolation.test.ts`: spawns two `queue-console.ts` child processes with distinct `QUEUE_FILE`s and fixed isolated ports, waits for their `listening` stdout marker, then asserts over loopback HTTP: state separation, op containment (add via A absent from B's file and B's API), concurrent mutation without lock errors, lane separation (heartbeat sidecar in A's dir visible only on A), loopback-only bind on both.
- In-process two-server testing is explicitly rejected: `queueFile()` resolves `process.env.QUEUE_FILE` per call, so two servers in one process race on the shared env. Child processes with per-child env are the honest harness (established prior art in `queue-edit.test.ts` / `agent-loop.integration.test.ts`).
- Fixed test ports chosen off the default 8722 range to avoid colliding with a live console; children are killed and temp dirs removed even on failure; test skips cleanly if ports are occupied rather than failing spuriously.
- Runbook lives in `skills/queue.md` Console subsection (one short paragraph + commands), not a new doc — the skill is where operators already look.
- Test chain: register the new test in `package.json` `test` script alongside the other queue suites.

## Testing Decisions
- What makes a good test here: real HTTP against two real server processes (not mocks), asserting file contents on disk as the ground truth alongside API responses.
- Modules tested: console server isolation across processes (new test); no unit tests for unchanged production modules beyond what their suites already cover.
- Prior art: `queue-console.test.ts` (single-server loopback round-trips,MC SSE/403/content-type checks), `queue-edit.test.ts` (spawnSync with per-child `QUEUE_FILE`), `queue-lock.test.ts` (sidecar lock contention).
- Full `npm test` must stay green; the new test runs inside it.

## Out of Scope
- Federated single-board view, registry API, presence heartbeats, dormant tray, repo chips/colors (superseded by design D9 — YAGNI).
- Repo-namespaced worktrees/branches (design D6 conditional — only if test repos share a checkout; the two-console setup uses separate checkouts).
- Websocket transport (superseded by design D8).
- Cross-machine queues; Redis/broker backends.

## Further Notes
- If the isolation test ever fails on shared-checkout worktree collisions (`queue/<id>` branch reuse), that revives D6 as a real bug with a failing test in hand — the desired outcome of proving isolation first.
- The two-console runbook should call out: one tab per repo, bookmark both, and `queue start`/`stop` per repo.
