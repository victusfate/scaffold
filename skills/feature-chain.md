## Instructions

Run the full feature chain end-to-end. **Do not pause for permission between phases.** Only pause within Phase 1 for Q&A answers, and at the end for user review.

---

## Phase 1: Design (grill-with-docs)

Interview the user relentlessly about every aspect of the plan until the design tree is resolved. Ask one question at a time with your recommended answer. Explore the codebase instead of asking when facts can be verified.

**During the session:**
- Sharpen fuzzy language — propose a canonical term when the user uses vague or overloaded terms
- Challenge against prior decisions in `design.md` if it exists
- Stress-test with concrete edge-case scenarios
- Cross-reference claims against the codebase; surface contradictions

**Capture in `./docs/<feature-slug>/design.md`** as decisions resolve (don't batch):
- Canonical vocabulary table
- Each decision with rationale and alternatives considered
- Edge cases and Q&A summary

State the slug before writing so the user can correct it.

**When design.md is written and decisions are resolved:** commit `docs(<slug>): design Q&A and vocabulary`. Run `/design-review` in auto-fix mode — it will patch `design.md` and resolve any blockers. Then proceed immediately to Phase 2.

---

## Phase 2: PRD (to-prd)

Synthesize the conversation and codebase into a PRD. **Do not re-interview.**

1. Explore the codebase to verify claims. Use canonical vocabulary from `design.md`.
2. Sketch major modules to build or modify. Identify deep module opportunities.
3. Determine which modules need tests based on complexity and criticality — no user confirmation needed.

Write `./docs/<feature-slug>/prd.md`:

```markdown
# PRD: <Feature Name>

## Problem Statement
## Solution
## User Stories
(numbered, extensive, covering full surface area)
## Implementation Decisions
(modules, interfaces, contracts, schema — no file paths)
## Testing Decisions
(what to test, which modules, prior art)
## Out of Scope
## Further Notes
```

**When prd.md is written:** commit `docs(<slug>): PRD` and proceed immediately to Phase 3.

---

## Phase 3: Plan + TDD (tdd)

**Plan first:** If `plan.md` doesn't exist, create it by breaking `prd.md` into vertical slices (each cuts through all layers: data → logic → UI → tests). Proceed immediately — no confirmation needed.

**Execute one slice at a time:**

```
RED:      Write one test for one behavior → confirm it fails
GREEN:    Write minimal code to pass → confirm it passes
REFACTOR: Extract duplication, deepen modules (only after GREEN)
```

Rules:
- One test at a time — never write all tests first
- Tests verify behavior through public interfaces, not implementation details
- Only enough code to pass the current test
- Never refactor while RED

After each slice commit:
```
test(<slug>): slice N red — <behavior>
feat(<slug>): slice N green — <behavior>
refactor(<slug>): slice N — <what changed>
```

Update `./docs/<feature-slug>/tdd-log.md` with per-slice status after each commit.

**When all slices are complete and the full test suite passes:** run `/code-quality-review` in auto-fix mode — it will patch source files and resolve any blockers. Then proceed to Phase 4.

---

## Phase 4: Review

Present a summary and stop for the user to review before anything is merged.

```
## Feature complete: <feature-slug>

### What was built
- <file or module>: <one-line description>
- …

### Tests
- <N> tests passing across <M> slices
- Behaviors covered: <list>

### Decisions that deviated from the plan
- <any divergence, or "none">
```

Then prompt: **"All tests pass. Please review the generated source before merging."**

Wait here. Do not proceed until the user confirms or requests changes.

---

## Stopping and resuming

If the user says "stop", "pause", or "just answer" — stop the chain immediately. Resume any phase individually: `/grill-with-docs`, `/to-prd`, `/tdd`.
