# Plan: Queue Console Telemetry and Filter

## Slice 1 — Portable host pressure reaches the queue header

- Add a public async host snapshot collector for sampled CPU utilization, available/total memory, queue-filesystem available/total space, and bounded active-worktree usage.
- Add a cached `GET /api/host` route that can receive an injected probe in tests without coupling queue operations to probe success.
- Fetch and render the snapshot beside the existing Lanes control with semantic text and non-color guard state.
- RED: deterministic CPU/guard tests, injected loopback route test, and template contract assertions fail before implementation.
- GREEN: the real browser path renders CPU, memory, disk, active-worktree usage, active claims, and desired parallelism without waiting on telemetry to draw the queue.

## Slice 2 — Optional GPU and explicit lane constraints

- Add timed, fixed-argument `nvidia-smi` collection and parsing across every device; unsupported or timed-out probes become an unavailable GPU metric.
- Parse configurable memory, disk, and VRAM reserves plus the optional worker-lane limit.
- Extend the header to distinguish host resource guard from worker-slot availability and show GPU/VRAM/process data when available.
- RED: non-default sentinel tests cover valid, invalid, unavailable, warning, and blocked cases.
- GREEN: the same live path displays the effective limits without automatically mutating `maxParallel`.

## Slice 3 — Read-only task-string filter

- Place a visibly labelled native search control beside the new-task form with a clear action and polite result count.
- Build one normalized search string from each task's id, title, and task-field values, then filter every existing status column without changing order or queue state.
- RED: template contract assertions require the accessible controls, task-field matching, immediate input handling, and a non-mutating clear path.
- GREEN: live desktop and phone checks prove title/id/field matches, zero results, and full restoration on clear while `/api/queue` remains byte-for-byte equivalent.

## Verification

- `node scripts/queue-console.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- Local PR gate selected by the repository (`make ci` or documented equivalent).
- Browser inspection of the live loopback page at desktop and narrow width; telemetry must remain readable and must not announce every refresh.
- Browser interaction check of task filtering and clearing at desktop and narrow width.
