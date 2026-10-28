## Instructions

Interview the user relentlessly about every aspect of the plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one at a time.

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
