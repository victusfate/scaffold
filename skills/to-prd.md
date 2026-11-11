## Instructions

Synthesize the current context and codebase into a PRD. **Do not interview the user** — use what's already known from the conversation and any existing `design.md`.

### Process

1. **Explore the codebase** to verify claims and understand current state.
   - Use canonical vocabulary from `design.md` if it exists.
   - Respect any ADRs in the area being touched.

2. **Sketch major modules** to build or modify.
   - Look for deep module opportunities: small, stable interfaces hiding complex implementation.
   - Confirm with the user which modules need tests.

3. **Write `./docs/<feature-slug>/prd.md`** using the template below.
   State the slug before writing so the user can correct it.

### PRD Template

```markdown
# PRD: <Feature Name>

## Problem Statement
The problem from the user's perspective.

## Solution
The solution from the user's perspective.

## Outcome and Evidence
- Desired observable improvement and its owner-defined constraints
- Consequential assumptions, disconfirming probes, and observed or unknown evidence
- What evidence would require revising the design or acceptance criteria
- Product/risk outcome evidence, separately from delivery speed and passing tests
- Preservation obligations with links to authoritative schemas, migrations,
  compatibility fixtures or behavioral tests; avoid copying their specifications

## User Stories
Numbered list covering the full surface area including edge cases:
1. As a <actor>, I want <feature>, so that <benefit>.

## Implementation Decisions
- Modules to build or modify
- Interface changes and API contracts
- Architectural and schema decisions
- Technical clarifications
(No file paths or code snippets unless a snippet encodes a decision more precisely than prose.)

## Testing Decisions
- What makes a good test here
- Which modules will be tested
- Prior art in the codebase
- A reproduction or trace that lets a maintainer diagnose and verify a repair

## Out of Scope
What this PRD explicitly does not cover.

## Further Notes
Open questions or follow-on considerations.
```

### When PRD is complete

Commit `prd.md` with message `docs(<slug>): PRD`. Then automatically proceed to `/tdd` without waiting for permission.

Adapted from Matt Pocock ([MIT notice](../THIRD_PARTY_NOTICES.txt)).
