# Executable understanding and safe modification

## Owner specification

Resolve [#164](https://github.com/victusfate/scaffold/issues/164),
[#165](https://github.com/victusfate/scaffold/issues/165), and the owner's added
[#166](https://github.com/victusfate/scaffold/issues/166) together, validate one PR,
then merge it and close the issues with a reference to its branch.

## Outcome

The owner wants a codebase people can understand and repair, with useful
automation and a rubric that rejects a well-tested implementation of the wrong
problem. Observe executable contract preservation, actual execution traces, attributable gate
costs, and visible design feedback. Customer impact beyond these probes remains
unknown until a consumer uses the changes.

Priorities: understanding/modification first, saved data/compatibility second,
architectural boundaries third. Keep implemented facts in executable code and
checks; keep this document to owner intent and consequential tradeoffs. A binary
durable/disposable classifier was rejected during owner review and is not part
of this design.

The owner approved issue #166's architectural contribution dial after manual
review. For this implementation, models own technical architecture and verification
within the requested UX/product intent. The builder is not required to prescribe
the architecture or approve each low-level decision. The queue mode is the typed
source of this contribution contract; release authority and checks remain separate.

## Assumptions

| Assumption | Disconfirming probe | Evidence / unknown | Revision if wrong |
|---|---|---|---|
| Existing queue surfaces can carry contract references | CLI/store migration round trip | pending validation | repair all storage paths before delivery |
| A reference execution sandbox is available | run flow, piece, denial and timeout probes | pending validation | fail closed; do not claim a live execution |
| Gate cost can be attributed without guessing | record retry and explicit review through CLI | pending validation | retain unknown rather than infer outcomes |
| Current workflow can expose learning without extra ceremony | independent review of canonical templates and rubric | pending review | remove redundant prompts, retain outcome/probe evidence |

## Decisions

- Extend existing queue fields, SQLite persistence, delivery metrics, linter templates,
  skill registration, and scaffold sync. Keep their existing calling surfaces.
- Queue contract references point to executable files without duplicating their specifications.
  Preserve them through every storage/editing path; reject malformed references.
- A repository declares concrete forbidden dependency rules with path globs. An import check fails closed
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
- The reference runner executes reviewed example code inside a container with no
  network, read-only source/root, isolated temporary state, and resource/time limits.
  Child adapters must enforce equivalent OS isolation; fail closed if unavailable.
- Extend design-validity scoring and canonical templates with owner outcomes,
  disconfirming probes, proportional alternatives, understanding, and repairability.
  The delivery report labels its operational scope and does not infer customer value.

## Vocabulary

| Term | Meaning |
|---|---|
| executable contract | authoritative source, schema, migration, fixture or test defining a guarantee |
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
