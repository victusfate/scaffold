## Philosophy

Seek **ambitious structural simplification** — not just the absence of bad patterns. Actively hunt for *code judo moves*: reorganizations that preserve behavior while dramatically reducing complexity. Working code is not enough; push for designs that feel inevitable in hindsight. Missed simplification opportunities are failures, not oversights.

## Scope and approach

Use `git diff main...HEAD --name-only` to get the list of changed files. Read each changed file fully — structural issues like spaghetti, file size, and abstraction violations need full context, not just diff hunks. Apply all criteria in a single pass per file; do not re-read to verify. Do not spawn subagents. Do not read files outside the changed set unless a cross-file criterion (e.g. canonical reuse) specifically requires checking one adjacent file.

@../lib/code-quality-rubric.md

## Mode

**Auto-fix** (called from the chain): Apply fixes to source files directly, re-run the full test suite to confirm nothing broke, then emit the Quality Scores table and continue to the completion summary without pausing.

**Review** (called standalone): Present findings as annotated diffs with the Quality Scores table. Wait for user approval before making any changes.

Detect mode from context: if triggered automatically as part of feature-chain or tdd, use auto-fix. If the user invoked this skill directly, use review mode.

## Gate

All files must score 10/10 on all four dimensions before the completion summary is emitted. Any dimension below 10 triggers the auto-fix loop.

- **< 30 lines changed:** apply the fix directly and re-score.
- **≥ 30 lines or architectural change:** surface the violation, describe the fix, wait for user approval.

Mechanical criteria (file length, magic literals, commented-out code) cannot be overridden — the code must be fixed. Model-driven criteria may be overridden via `quality-override` in the PR body.

## Output

After scoring, emit the Quality Scores table before the completion summary:

```
## Quality Scores
| File | Quality | Readability | Encapsulation | Clarity |
|------|---------|-------------|---------------|---------|
| path/to/file.js | 10 | 10 | 10 | 10 |

Violations: none
```

This table must appear in the TDD completion summary and is included in the PR body by `/create-pr`.
