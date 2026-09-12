# Plan: Multi-Queue Board (isolated consoles)

## Slice 1 — Two-console isolation test (RED → GREEN)
- Behavior: two `queue-console.ts` processes with distinct `QUEUE_FILE`s on isolated ports serve independent state; an op on A never touches B's file/API; concurrent mutations don't contend; lane sidecars stay per-console; both bind loopback-only.
- Test: new `scripts/queue-isolation.test.ts` (real HTTP against two real servers, disk contents as ground truth).
- Code: test only (no production changes expected; fix leaks if found).

## Slice 2 — Runbook + test wiring (RED → GREEN)
- Behavior: `npm test` runs the isolation test; operators find the two-console setup in `skills/queue.md`.
- Test: `package.json` test chain includes the new file; runbook paragraph present and accurate.
- Code: `package.json` test script entry + `skills/queue.md` Console subsection paragraph.
