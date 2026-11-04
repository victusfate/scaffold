# PRD: Executable understanding and safe modification

## Problem Statement

Readers need to understand and safely modify a system while preserving its data
and interfaces. Prose-only descriptions drift, dependency boundaries lack checks,
and the cost of enforcing quality is invisible. Readers also lack a reusable way
to explore code through observed execution rather than guessed call graphs.

## Solution

Keep preservation obligations executable and enforce dependency boundaries. Show timed gate attempts
and their reviewed outcomes. Supply a Mind Meld skill and a working offline
example that connects structure, execution, source, and state changes.

## Outcome and Evidence

Issue #166 adds an evidence-driven design mental model, cited weighted design
validity, and workflow prompts to revise assumptions. Flow/gate metrics remain
operational measurements. Tests and QA can establish the requested behaviors;
consumer/customer value is unknown until observed, and must not be inferred from
merge count or CI success. Contradictory probes revise this design and unfinished
slices rather than force the original specification through a green pipeline.

## User Stories

1. An owner can add, edit, import, persist, and inspect a task's executable contract references without losing it.
2. Declared dependency boundaries cannot be crossed unnoticed by CI.
3. A reviewer can cite weighted system-level deductions and concrete failure patterns.
4. A consumer starts with strict defaults and keeps ownership of its settings.
5. An owner can record gate attempts, identify first-try failures, review false positives,
   and rank the most expensive gates each day without inventing missing data.
6. A reader can run an example integration flow or isolated piece, compare two runs,
   and inspect observed values and source spans offline.
7. A child repository can implement stack-specific adapters against a documented
   schema, sandbox policy, cache key, and narration contract.
8. An owner can see which assumptions were tested, what remains unknown, and why
   a design changed, without losing useful delivery automation.

## Implementation Decisions

- Add validated executable-contract path references to the existing queue and migrate storage.
- Resolve supported imports mechanically against repository root declarations.
- Add additive system scoring alongside the existing four file dimensions.
- Record rigor attempts locally through an explicit CLI; retain PR delivery reporting.
- Validate graph and trace payloads at the tool/viewer boundary. Display untrusted
  source and narration as text. Require provenance for runtime observations.
- Cache by source content, adapter/schema version, execution inputs, and isolation
  configuration. Keep derived artifacts outside tracked repository state.
- Deliver new canonical files through the existing managed-file manifest and hoisting.

## Testing Decisions

Test queue CLI and SQLite round trips with non-default contract paths and invalid values;
temporary-repository import violations, safe imports, malformed configs, and overrides;
telemetry with retries, multiple dates, unknown reviews, and invalid input; isolated
reference flow/piece runs and changed inputs; permission denials, timeout, graph schema,
and safe offline viewing. Existing shell acceptance tests verify bootstrap and sync.
Run the repository test, integration, lint, typecheck, mechanical, and security gates.
An independent agent reviews every changed file before merge.

## Out of Scope

Implementing Rust/Godot adapters or Voidhorizon tours in a different repository;
running arbitrary code without an OS sandbox; executing narration; retroactively
guessing durations or false positives from prose; binary durability classifications.

## Further Notes

The implementation extends shared queue and sync contracts, so full suites apply.
