---
description: Rigorous structural code quality review — run as design gate (after RED, before writing code) and code gate (after tests pass).
---

## Run Twice Per Slice

**Design gate** — after RED, before writing implementation: review the proposed approach for structural problems before any code is written.

**Code gate** — after GREEN/REFACTOR: review the resulting code against all five criteria.

## The Five Criteria

1. **File size** — Any file at or approaching 1,000 lines requires a decomposition plan. Do not add to it; split it.

2. **Spaghetti** — Reject ad-hoc conditionals, scattered special cases, and one-off branches inserted into unrelated flows.

3. **Abstractions** — Reject thin wrappers and identity abstractions that add indirection without meaningful clarity. Every layer must earn its place.

4. **Types** — Prefer explicit typed models. Flag unnecessary optionality, casts, and loosely-shaped objects.

5. **Canonical reuse** — Logic lives in one place. Flag duplicated helpers and feature logic leaking into shared layers.

## Blockers

These are presumptive failures — resolve before proceeding:

- Simpler restructuring is visible but left on the table
- File pushed past 1,000 lines
- Ad-hoc branching added to existing flows
- Thin wrappers or cast-heavy contracts introduced
- Feature checks scattered across shared code

Tone: direct and uncompromising on structural regressions. Not harsh — just clear about what must change.
