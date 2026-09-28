# TDD Log: Queue Host Telemetry

## Slice 1 — Portable host pressure reaches the queue header

- Status: done
- RED: the host module import was absent; the loopback host route returned 404; the page lacked the endpoint and passive status mount.
- GREEN: sampled CPU, memory, and queue-filesystem status now flows through `GET /api/host` into the header beside desired/active worker lanes.
- Verification: 164 queue-console assertions, 4 host-status assertions, typecheck, lint, and whitespace checks pass.

## Slice 2 — Optional GPU and explicit lane constraints

- Status: done
- RED: NVIDIA parsing, configured reserve/worker limits, resource guards, cache coalescing, and lane-constraint presentation had no implementation.
- GREEN: a one-second optional `nvidia-smi` probe, typed unavailable fallback, configurable guards, two-second coalescing cache, and separate desired-lane/worker-limit labels now share the live host path.
- Verification: 168 queue-console assertions, 8 host-status assertions, typecheck, lint, and whitespace checks pass.

## Review correction — bounded storage and truthful multi-platform pressure

- Status: done
- Review findings: queue rendering awaited the host probe; Linux used free rather than available memory; only the first NVIDIA device affected the guard; subprocess timeout settlement was coupled to child exit; flex styling could hide list semantics in Safari; the task contract's active-worktree total was missing.
- GREEN: queue and lane state render before telemetry; Linux reads `MemAvailable` with a conservative cross-platform fallback; GPU pressure aggregates every device and guards on minimum per-device headroom; `nvidia-smi` settles at a hard deadline; active worktrees are sized in a terminable worker thread; the metric list has explicit semantics.
- Verification: 171 queue-console assertions, 10 host-status assertions (including a real worker-thread scan), typecheck, lint, and whitespace checks pass. Full-suite and integration reruns remain the final pre-PR gate.

## Slice 3 — Read-only task-string filter

- Status: done
- RED: six template-contract assertions failed because the page had no labelled search control, result status, task-field matcher, input handler, or clear path.
- GREEN: a native search input beside task creation filters ids, titles, and task-field values across all columns, preserves source order and shared queue state, and announces the shown/total count. Hidden active cards do not create false free-lane indicators.
- Verification: 178 queue-console assertions, typecheck, and whitespace checks pass. Live Chromium proved id and non-title-field matches, zero results, full restoration after clear, and an unchanged `/api/queue` response; root inspected desktop and phone captures.
