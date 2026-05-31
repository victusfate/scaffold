## Purpose

Review the changed code for reuse, simplification, efficiency, and altitude cleanups — then apply the fixes. Quality-only: does not hunt for correctness bugs (use `/code-review` for that).

## Dimensions

**Reuse** — Duplicated helpers, repeated logic, copy-pasted error handling. One canonical place per concept.

**Simplification** — More steps than necessary to reach the same outcome. Complex conditionals a simpler structure resolves. Dead branches surviving a refactor.

**Efficiency** — Obvious algorithmic inefficiencies, repeated computations in loops, unnecessary allocations.

**Altitude** — Business logic leaking into infrastructure layers, or plumbing embedded in domain modules. Each layer at its correct abstraction level.

## Procedure

1. `git diff main...HEAD --name-only` — identify changed files.
2. Read each changed file fully — structural issues require full context, not just diff hunks.
3. Apply all four dimensions in a single pass per file.
4. Apply fixes directly to the working tree — no approval step.
5. Re-run tests if a test runner is detectable (`package.json scripts.test`, `pytest`, `cargo test`, etc.).
6. Report a compact summary: what was simplified and why.

## Rules

- Apply only what qualifies under the four dimensions. No style preferences, no cosmetic renames.
- Do not introduce new abstractions speculatively — simplification means fewer moving parts, not different ones.
- Do not read or modify files outside the changed set unless a cross-file reuse finding requires checking one adjacent file.
- Do not spawn subagents.
- If tests fail after a fix, revert that specific fix, note it in the summary, and continue.
