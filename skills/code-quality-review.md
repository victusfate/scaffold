## Philosophy

Seek **ambitious structural simplification** — not just the absence of bad patterns. Actively hunt for *code judo moves*: reorganizations that preserve behavior while dramatically reducing complexity. Working code is not enough; push for designs that feel inevitable in hindsight. Missed simplification opportunities are failures, not oversights.

## Scope and approach

Use `git diff main...HEAD --name-only` to get the list of changed files. Read each changed file fully — structural issues like spaghetti, file size, and abstraction violations need full context, not just diff hunks. Apply all five criteria in a single pass per file; do not re-read to verify. Do not spawn subagents. Do not read files outside the changed set unless a cross-file criterion (e.g. canonical reuse) specifically requires checking one adjacent file.

## Mode

**Auto-fix** (called from the chain): Apply fixes to source files directly, re-run the full test suite to confirm nothing broke, then continue to the completion summary without pausing.

**Review** (called standalone): Present findings as annotated diffs. Wait for user approval before making any changes.

Detect mode from context: if triggered automatically as part of feature-chain or tdd, use auto-fix. If the user invoked this skill directly, use review mode.

## Checklist

**File size** — Files at or approaching 1,000 lines require decomposition, not growth.

**Spaghetti** — Reject ad-hoc conditionals, scattered special cases, and one-off branches in unrelated flows.

**Abstractions** — Reject thin wrappers and identity layers. Every layer must earn its place.

**Types** — Prefer explicit typed models. Flag unnecessary optionality, casts, and loosely-shaped objects.

**Canonical reuse** — Logic in one place. Flag duplicated helpers and feature logic leaking into shared code.

## Blockers

Resolve before the completion summary:
- Visible simpler restructuring left on the table
- File pushed past 1,000 lines
- Ad-hoc branching added to existing flows
- Thin wrappers or cast-heavy contracts introduced
- Feature checks scattered across shared code
