# Design: Queue Console Telemetry and Filter

## Canonical Vocabulary

| Term | Definition |
|---|---|
| Host snapshot | One bounded, read-only sample of CPU, memory, disk, and optional NVIDIA GPU state. |
| Active-worktree usage | Allocated bytes beneath worktree paths belonging to currently active queue tasks. |
| Resource guard | A `clear`, `warn`, or `blocked` comparison between current headroom and configured reserve/floor values. |
| Desired parallelism | The queue's existing `maxParallel` worker-lane setting. It is operator-controlled. |
| Worker-lane limit | An optional externally supplied ceiling for worker agents. It is distinct from host capacity and desired parallelism. |
| Unavailable metric | A metric the current platform or installed tools cannot report; it is displayed as unavailable, never synthesized as zero. |
| Task filter | A local, case-insensitive substring view over task ids, titles, and task-field values. It never changes queue order or stored state. |

## Decisions

### Advisory, never automatic

**Decision:** Show host pressure beside the existing Lanes control, including desired parallelism, active queue claims, and an optional worker-lane limit. Telemetry never changes queue configuration.

**Rationale:** Low resource use can justify another lane, but harness concurrency is an independent hard limit. Silent resizing could over-claim work or confuse a user who deliberately set the queue.

**Alternatives considered:** Automatically increase or reduce `maxParallel`; rejected because neither host measurements nor the queue can know every harness's concurrency contract.

### Cross-platform standard-library collector

**Decision:** Add a TypeScript collector using Node's `os` CPU/memory APIs and `fs.statfs` for the queue filesystem. On Linux, use `MemAvailable`; other platforms conservatively fall back to Node's free-memory value. CPU utilization is derived from two bounded `os.cpus()` samples so Windows does not depend on Unix load averages. NVIDIA data is optional and collected with a timed `nvidia-smi` invocation when present.

**Rationale:** These interfaces work on supported Node platforms without adding a package or assuming `free`, `df`, `du`, PowerShell, or procfs. An absent NVIDIA tool is normal on macOS and non-NVIDIA hosts.

**Alternatives considered:** Platform-specific shell commands; rejected because their output and availability differ.

### Bounded active-worktree accounting

**Decision:** Size only active queue worktrees in an isolated Node worker thread. Terminate the worker at a short deadline and report the metric as unavailable on timeout or filesystem failure.

**Rationale:** Worktrees were a material disk consumer in the motivating repository, but recursively walking a large checkout in the console thread would delay queue rendering and mutations. An off-thread, cancellable scan makes the cost visible without putting queue control behind it.

### Bounded cached request path

**Decision:** `/api/host` serves a short-lived cached snapshot. Collection has explicit time bounds and converts unsupported metrics into typed unavailable values. The browser renders queue and lane state before requesting telemetry, so queue reads and writes do not await it.

**Rationale:** Browser refreshes must not multiply subprocesses or delay the queue management surface.

### Configurable safety limits

**Decision:** Read optional environment configuration for memory reserve, disk free floor, GPU VRAM reserve, and worker-lane limit. Defaults are conservative and the response includes the effective values.

**Rationale:** Consumer repositories have materially different disk footprints and harness limits. A generic scaffold must expose configuration rather than encode VoidHorizon's numbers.

### Quiet accessible presentation

**Decision:** Render a semantic host-status list with text and symbols in addition to color. Auto-refresh does not use a live region.

**Rationale:** Resource samples update often and should be inspectable without repeatedly interrupting screen-reader users.

### Local task filtering beside task creation

**Decision:** Add a visibly labelled search control beside the new-task form. Each input change filters every status column immediately against task ids, titles, and field values; a polite result count reports the view. Clearing the input restores the full board.

**Rationale:** Large queues make browser find and repeated task creation poor substitutes for locating related work. Keeping the operation in the browser makes it instant and guarantees that searching cannot mutate the SQLite-backed queue.

**Alternatives considered:** A server query endpoint or new persisted filter state; rejected because the full queue is already present and filter preferences do not belong in shared queue state.

## Visualizations

```mermaid
flowchart LR
  Browser[Queue console] -->|GET /api/host| Server[Loopback server]
  Server --> Cache{Fresh snapshot?}
  Cache -->|yes| Snapshot[Typed host snapshot]
  Cache -->|no| Collector[Bounded collector]
  Collector --> Node[Node OS + statfs]
  Collector --> Worker[Bounded worktree-size worker]
  Collector --> Nvidia[Optional nvidia-smi]
  Snapshot --> Panel[Host pressure beside Lanes]
  Panel -. advisory only .-> Operator[Operator changes maxParallel]
```

## Edge Cases & Scenarios

- Windows host with no Unix load average: sampled CPU utilization remains available.
- macOS or non-NVIDIA host: GPU reads `unavailable`; CPU, memory, and disk still render.
- Hung `nvidia-smi`: the timeout expires, the GPU metric becomes unavailable, and queue endpoints continue serving.
- Multiple NVIDIA devices: utilization is the maximum and the VRAM guard uses the least headroom on any device.
- A huge or unreadable active worktree: its bounded worker terminates and the worktree metric reads unavailable.
- Disk or OS probe error: only that metric becomes unavailable; the endpoint still returns a typed snapshot.
- Resource guard is clear but the worker-lane limit is full: the panel says the host is clear and the harness is full.
- Four queue claims with only three worker slots: active claims and the configured worker limit are shown separately.
- A filter matches mixed-case text in an id, title, dependency, file, acceptance criterion, note, or owner: only matching cards remain, in their original columns and order.
- A filter matches nothing: every column reports zero and the live result count reports zero; no task is added or changed.
- Clearing the filter, including the native clear affordance on a search input, restores every card.

## Q&A Summary

**Q:** Should low resource usage automatically increase lane count?

**A:** No. Show enough evidence to make the choice quickly, while leaving the existing Lanes control operator-owned.

**Q:** Which resources matter for lane sizing?

**A:** CPU pressure, available memory, queue-filesystem free space, optional GPU/VRAM pressure, active claims, desired parallelism, and an optional worker-lane limit.

**Q:** Should finding related tasks require creating a new task or changing queue state?

**A:** No. The task filter is an immediate, read-only view beside the existing creation control.
