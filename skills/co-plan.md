## Instructions

Resolve the problem, constraints and consequential choices at the builder's chosen
architectural contribution depth (see `docs/agents-detail.md#architectural-contribution`).
Investigate code and propose answers before asking. In model-led work, perform the
architectural analysis and design rather than requiring the builder to specify it.
Ask about unresolved intent or material product/risk tradeoffs; do not repeat
settled decisions or invent an interview for a clear, already authorized task.

**Ask one question at a time.** Wait for feedback before continuing. Provide your recommended answer with each question.

If a question can be answered by exploring the codebase, explore it instead of asking.

### During the session

**Sharpen fuzzy language.** When the user uses vague or overloaded terms, propose a precise canonical term: "You're saying 'account' — do you mean Customer or User? Those are different things."

**Challenge against prior decisions.** If `design.md` already exists for this feature, surface conflicts immediately: "Your design.md defines 'cancellation' as X, but you seem to mean Y — which is it?"

**Stress-test with concrete scenarios.** Invent edge cases that force precision about boundaries between concepts.

**Cross-reference with code.** When the user states how something works, verify against the codebase. Surface contradictions: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Capture decisions in design.md

When a term or decision is resolved, write it to `./docs/<feature-slug>/design.md` immediately — don't batch. State the slug before writing so the user can correct it.

```markdown
# Design: <Feature Name>

## Outcome
- Owner problem and desired observable change:
- Constraints and failure consequences:
- Outcome evidence: unknown until observed; name the intended check.
- Architectural contribution: link the task mode or record the builder's direction.

## Preservation obligations
- Data, behavior or interfaces that must survive replacement:
- Authoritative executable contracts: link schemas, migrations, fixtures or tests.
- Reproduction/observation entry point: link code or a source-verified run.

## Assumptions
| Consequential assumption | Disconfirming probe | Evidence / unknown | Revision if wrong |
|---|---|---|---|
| … | … | unknown | … |

## Canonical Vocabulary
| Term | Definition |
|------|-----------|
| Foo  | … |

## Decisions
### <Decision title>
**Decision:** …
**Rationale:** …
**Alternatives considered:** …

## Visualizations
<!-- Mermaid preferred; ASCII fallback for simple structures -->

### <Diagram title>
```mermaid
…
```

## Edge Cases & Scenarios
- Scenario: … → expected behavior: …

## Q&A Summary
**Q:** …
**A:** …
```

`design.md` is a glossary and decision record — not a spec or implementation plan.

Treat requirements as hypotheses. Inspect the domain and real call/state paths;
record what would show the proposed behavior is wrong. Compare alternatives when
uncertainty or replacement cost justifies it; a known repetitive operation needs
no artificial design contest. When evidence changes a premise, revise the decision
in place and propagate it to the PRD and unfinished plan before resuming. Bring only
unresolved owner intent or consequential tradeoffs back to the user.

Keep this document to intent and consequential decisions. Types, module interfaces,
tests and schemas own current facts; generate maps from source and label recorded
runs with source hashes. Link those sources instead of maintaining a prose mirror.
Comments capture constraints and rationale that cannot be inferred from the code.

### Visualizations — add as structure becomes clear

Produce diagrams as domain relationships, flows, and states crystallise during the Q&A — don't wait until the end. Use **Mermaid** by default; fall back to ASCII for simple structures or when spatial layout matters more than tooling support.

Diagram when it adds clarity over prose:

| Situation | Diagram type |
|---|---|
| Entities and their relationships | `erDiagram` |
| How a request flows through the system | `sequenceDiagram` |
| States an entity moves through | `stateDiagram-v2` |
| High-level component boundaries | `graph TD` or `C4Context` |
| Decision logic / branching | `flowchart` or ASCII tree |

Prefer one clear diagram over several partial ones. If a diagram would just restate the vocabulary table, skip it.

### Callable units — decide at design time

When the feature adds a tool, script, skill, or bin command, resolve during the Q&A:

- **Where does it go?** Pick the home from `docs/agent-authoring-requirements.md` §1 — `scripts/`, `tools/`, `bin/`, or `.claude/skills/`. Ask if it is unclear.
- **What is its contract?** Name, inputs/outputs, exit codes, idempotency, test approach. For a skill: triggers, what it calls, what it does NOT reimplement.

Capture the decision in `design.md` under a "Callable unit" section. Do not leave this to the coding phase.

### ADRs — offer sparingly

Only offer an ADR when all three are true: hard to reverse, surprising without context, result of a real trade-off. Otherwise capture in `design.md`. ADRs go in `./docs/adr/NNNN-<slug>.md`.

### When design is complete

Summarize the resolved decisions and canonical vocabulary. Run `/design-review` in auto-fix mode — it will patch `design.md` directly and resolve any blockers. Then automatically proceed to `/to-prd` without waiting for permission.

Adapted from Matt Pocock ([MIT notice](../THIRD_PARTY_NOTICES.txt)).
