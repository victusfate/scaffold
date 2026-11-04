---
tier: durable
---
# Durability and Mind Meld

## Owner specification

Resolve [#164](https://github.com/victusfate/scaffold/issues/164) and
[#165](https://github.com/victusfate/scaffold/issues/165) together, validate one PR,
then merge it and close both issues with a reference to its branch.

## Decisions

- Extend existing queue fields, SQLite persistence, delivery metrics, linter templates,
  skill registration, and scaffold sync. Keep their existing calling surfaces.
- Treat an omitted tier as durable. Reject invalid explicit values. Persist and render
  the tier rather than infer it from a title or tag.
- A repository declares durability roots with path globs. An import check fails closed
  on invalid configuration or an edge it cannot safely resolve in its supported stack.
  Language-specific adapters remain necessary for Rust and Godot consumers.
- Score system boundaries, state ownership, and entry-point traceability using the
  rubric's existing cited, weighted deductions.
- Measure rigor using recorded gate attempts, including time and outcome. A failure
  becomes a false positive only through an explicit, evidenced review. Missing data
  stays unknown. Rank expensive gates per day.
- Mind Meld ships a build skill, versioned graph/trace contract, offline reference
  viewer, and one executable TypeScript example. Observations come from actual runs;
  static structure and narration never manufacture runtime edges.
- Child repositories own their index and execution adapters. Voidhorizon's five tours
  are its first consumer milestone, not code scaffold can implement in this repository.
- The reference runner executes reviewed example code with explicit permission limits,
  temporary state, a scrubbed environment, and a timeout. Arbitrary child code requires
  an OS sandbox with no network and a read-only checkout; fail closed if unavailable.

## Vocabulary

| Term | Meaning |
|---|---|
| tier | disposable or durable, with durable the conservative default |
| structure edge | a dependency established by an index |
| observed edge | a call or state change recorded by an actual execution |
| flow | an integration entry point executed under tracing |
| piece | one target executed with explicit inputs and in-memory boundary fakes |
| gate attempt | a timed invocation with an outcome and stable stage identity |
| false positive | a failed finding explicitly reviewed as incorrect with evidence |

## Tradeoffs and review

The tension is useful observation versus safe execution. A small reviewed example and
an honest adapter contract give consumers a working starting point without pretending
one runner understands every stack. Local telemetry provides attributable measurements
without treating every CI failure as a scanner mistake. Existing consumer-owned
configuration must survive sync and bootstrap.

Design review: each addition belongs to an existing calling surface or one reference
tool; no parallel queue store, graph inference service, or production execution backend.
Issue acceptance criteria supply the test scope and vertical slices for this authorized
implementation. No new product decision requires an interview.
