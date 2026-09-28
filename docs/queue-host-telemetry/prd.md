# PRD: Queue Host Telemetry

## Problem Statement

The queue console lets an operator change worker-lane parallelism but currently provides no host-capacity context. A quiet machine may be able to accept another lane, while a disk-heavy checkout or a full harness makes the same change unsafe. Operators must leave the console and manually reconcile CPU, RAM, disk, GPU, queue claims, and harness limits.

## Solution

Add a bounded cross-platform host snapshot endpoint and a compact status panel adjacent to the existing Lanes control. The panel reports current resource pressure, configured safety limits, active queue claims, desired parallelism, and an optional worker-lane limit. It provides evidence for an operator decision and never changes queue configuration itself.

## User Stories

1. As a queue operator, I want CPU, available memory, and queue-filesystem free space visible beside Lanes, so I can judge whether another worker is safe.
2. As a GPU-work operator, I want NVIDIA utilization, VRAM headroom, and compute-process count when available, so I do not oversubscribe the accelerator.
3. As a cross-platform user without NVIDIA tooling, I want the remaining metrics to work and GPU to read unavailable, so a missing optional tool does not break the console.
4. As an operator with project-specific floors, I want environment-configured reserves reflected in the status, so the generic console can honor my repository's safety policy.
5. As an operator under a harness concurrency cap, I want active claims and the optional worker-lane limit shown separately from host capacity, so an idle host is not mistaken for a free agent slot.
6. As a queue user, I want telemetry probes cached and time-bounded, so auto-refresh never stalls queue reads or writes.
7. As a screen-reader user, I want status expressed with semantic text rather than color-only or noisy live announcements.

## Implementation Decisions

- Add a focused TypeScript host-status module with a stable async snapshot interface. It owns CPU sampling, memory and filesystem readings, optional NVIDIA probing, safety-limit parsing, caching, and guard classification.
- Use two short `os.cpus()` samples for utilization on every supported Node platform. Keep Unix load average as supplementary data, not the portable CPU signal.
- Use Node filesystem statistics for the filesystem containing the queue. Do not recursively size worktrees on the request path.
- Invoke only `nvidia-smi`, with an explicit timeout and fixed query arguments. Never collect command lines, usernames, environment data, or process arguments.
- Add a loopback-only `GET /api/host` endpoint. Queue state and mutation endpoints remain independent of the telemetry collector.
- Extend the existing header with a passive semantic list of metrics and a text guard state. Fetch host, queue, and lane state together on refresh.
- Support `QUEUE_MEMORY_RESERVE_GIB`, `QUEUE_DISK_FLOOR_GIB`, `QUEUE_VRAM_RESERVE_GIB`, and `QUEUE_WORKER_LIMIT`. Invalid values fall back to documented defaults or unavailable rather than producing `NaN`.
- Keep `maxParallel` operator-controlled. The UI may say host resources are clear or constrained, but must not recommend a numeric lane count it cannot substantiate.

## Testing Decisions

- Add deterministic unit coverage for CPU delta calculation, NVIDIA CSV parsing, safety-limit parsing, and guard classification using non-default sentinel values.
- Exercise `GET /api/host` through a real loopback server with an injected probe, proving the public response path without depending on the test machine's GPU or pressure.
- Extend the template contract test to require the host endpoint, semantic status mount, worker-limit language, and non-color status text.
- Run the existing queue console suite, typecheck, linter, and full local CI gate.
- The critical caller path is browser refresh → `/api/host` → cached collector → rendered header; verify every link, not only helper functions.

## Out of Scope

- Automatically changing `maxParallel`.
- Discovering a harness's concurrency limit without explicit configuration.
- Per-process command lines, identities, or memory use.
- Recursive worktree or scratch-directory sizing during browser refresh.
- AMD, Intel, or Apple GPU utilization APIs in this first slice; they degrade to unavailable.
- Remote exposure, authentication, or telemetry export. The console remains loopback-only.

## Further Notes

- A consumer with a 205 GiB disk floor and three worker slots can launch the console with `QUEUE_DISK_FLOOR_GIB=205 QUEUE_WORKER_LIMIT=3`.
- Future platform GPU adapters can implement the same typed metric without changing the HTTP or page contract.
