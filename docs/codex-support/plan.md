# Plan: Codex support

The proposed two slices and CLI-based test coverage were surfaced to the user;
the user directed routine choices to be inferred from the multi-harness design.

## Slice 1 — Consumer skill export

- RED: invoke the hoist CLI with Codex against an empty consumer.
- GREEN: accept Codex, emit shared Agent Skills wrappers, and support plan/replay.
- Verify curated and generated wrappers, all-target output, consumer edit
  protection, and sync manifest reachability. Update the CLI contract/docs.

## Slice 2 — Usable workflows and voice

- Adapt startup, skill references, review concurrency, PR monitoring, queue
  scheduling, save/resume, statusline, and delivery instructions to available tools.
- RED: exercise the actual voice entry point with a Codex protocol fixture.
- GREEN: select a Codex backend, parse JSONL replies, and resume the exact session.
- Cover Claude compatibility and subprocess/protocol failures.
- Verify shipped runtime dependencies, full tests, lint/typecheck, mechanical
  checks, and independent correctness/structural review; fix and re-evaluate.

## Completion

Report tested paths and environmental limits. Keep all work on
`feat/codex-support`; prepare reviewable local commits without publishing.
