## Philosophy

Seek **ambitious structural simplification** — not just the absence of bad patterns. Actively hunt for *code judo moves*: reorganizations that preserve behavior while dramatically reducing complexity. Working code is not enough; push for designs that feel inevitable in hindsight. Missed simplification opportunities are failures, not oversights.

## Execution model

// quality-override: No duplicate implementations — isolation rationale is intentionally repeated across skill files; skill composition system pending
Run the review as a separate Agent with isolated context. The agent invoking this skill has already internalized the session's work and cannot review it objectively. A fresh subagent has no such priors.

**Phase 1 — gather (main agent):**
1. Run `git diff main...HEAD --name-only` to get changed files.
2. Read each changed file in full — structural issues need full context, not just diff hunks.
3. Spawn a reviewer Agent (via the Agent tool) with all changed file contents, the rubric criteria, and the mode embedded verbatim in the prompt. The reviewer has no session context and reviews with fresh eyes.

**Phase 2 — review (reviewer Agent, isolated context):**

The reviewer applies all rubric criteria (see below) in a single pass per file.

**Cross-file DRY check (mandatory):** for every function or block of logic in a changed file that could plausibly exist elsewhere — parsers, merge helpers, matchers, formatters, validators — run a grep across the codebase before concluding no canonical version exists. If a canonical equivalent is found in an unmodified file, that is a **No duplicate implementations** violation against the changed file; read the canonical file to confirm the overlap and cite both paths in the violation.

The reviewer returns scores + violations in the output format below. The main agent acts on them.

**Phase 3 — act (main agent):**
Receive scores and violations from the reviewer, then apply the appropriate mode.


@../lib/code-quality-rubric.md

## Mode

**Auto-fix** (called from the chain): Apply fixes to source files directly, re-run the full test suite to confirm nothing broke, then emit the Quality Scores table and continue to the completion summary without pausing.

**Review** (called standalone): Present findings as annotated diffs with the Quality Scores table. Wait for user approval before making any changes.

Detect mode from context: if triggered automatically as part of feature-chain or tdd, use auto-fix. If the user invoked this skill directly, use review mode.

## Gate

All files must score 10/10 on all four dimensions before the completion summary is emitted. Any dimension below 10 triggers the auto-fix loop.

- **< 30 lines changed:** apply the fix directly and re-score.
- **≥ 30 lines or architectural change:** surface the violation, describe the fix, wait for user approval.

Mechanical criteria (file length, magic literals, commented-out code) cannot be overridden — the code must be fixed. Non-mechanical (model-driven) criteria — naming, responsibility scope, abstraction quality — may be overridden via `quality-override` in the PR body.

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
