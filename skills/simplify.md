## Philosophy

Seek **ambitious structural simplification**, not only the absence of bad patterns. Hunt for *code judo moves*: reorganizations that preserve behavior while sharply reducing complexity. Working code is not enough; push for designs that feel inevitable in hindsight. A missed simplification is a failure, not an oversight.

This is the **structural-quality** skill: it scores changed code against the rubric, gates it at 10/10, and in auto-fix mode applies the cleanups. Correctness is `/validate`; a full-repo survey is `/audit`.

## Execution model

// quality-override: No duplicate implementations — isolation rationale is intentionally repeated across skill files; skill composition system pending
Run the review as a separate Agent with isolated context. The agent invoking this skill has already internalized the session's work and cannot review it objectively. A fresh subagent has no such priors.

**Phase 1 — gather (main agent):**
1. Run `git diff main...HEAD --name-only` to get changed files.
2. Read each changed file in full; structural issues need full context, not diff hunks.
3. Capture the diff's shape (`git diff main...HEAD --stat`) for the diff-economy lens.
4. Spawn a reviewer subagent (via the Agent tool) with all changed file contents, the diff stat, the rubric criteria, and the mode embedded verbatim in the prompt. It has no session context.

**Phase 2 — review (reviewer subagent, isolated context):**

Apply all rubric criteria (below), the four cleanup dimensions, and the diff-economy lens in one pass per file.

**Cleanup dimensions** (alongside the rubric):
- **Reuse** — duplicated helpers, repeated logic, copy-pasted error handling. One canonical place per concept.
- **Simplification** — more steps than needed for the same outcome; complex conditionals a simpler structure resolves; dead branches surviving a refactor.
- **Efficiency** — obvious algorithmic inefficiencies, repeated computation in loops, unnecessary allocations.
- **Altitude** — business logic leaking into infrastructure, or plumbing embedded in domain modules. Each layer at its correct level.

**Diff-economy lens** (diff scope only). The change's *economy* is a quality signal; weigh what was added against what was deleted:
- **Additions must earn their lines.** Flag added ceremony, thin wrappers, or speculative abstraction — anything a reader would not miss.
- **Prefer behavior-preserving deletions.** Where an addition could be a deletion (a reorganization that removes complexity while keeping behavior), name that alternative concretely — e.g. "these 40 added lines could be a 5-line deletion of X."
- **Credit deletions.** A change that removes complexity while behavior remains is the target, not a red flag.
- **Out of scope:** whether a deletion *dropped still-needed behavior* is a correctness defect; route it to `/validate`.

**Cross-file DRY check (mandatory):** for every function or block in a changed file that could plausibly exist elsewhere (parsers, merge helpers, matchers, formatters, validators), grep the codebase before concluding no canonical version exists. A canonical equivalent in an unmodified file is a **No duplicate implementations** violation against the changed file; read the canonical file to confirm the overlap and cite both paths.

The reviewer returns scores + violations in the output format below.

**Phase 3 — act (main agent):** apply the mode below to the reviewer's scores and violations.

@../lib/code-quality-rubric.md

## Mode

**Auto-fix** (called from the chain, or with `--fix`): apply fixes to source files directly, re-run the full test suite to confirm nothing broke, then emit the Quality Scores table and continue without pausing.

**Review** (called standalone without `--fix`): present findings as annotated diffs with the Quality Scores table. Wait for user approval before making any changes.

Triggered automatically from feature-chain or tdd: use auto-fix. Invoked directly by the user: review mode unless `--fix` is passed.

## Gate

All files must score 10/10 on all four dimensions before the completion summary is emitted. Any dimension below 10 triggers the auto-fix loop.

- **< 30 lines changed:** apply the fix directly and re-score.
- **≥ 30 lines or architectural change:** surface the violation, describe the fix, wait for user approval.

Mechanical criteria (file length, magic literals, commented-out code) cannot be overridden — the code must be fixed. Non-mechanical (model-driven) criteria — naming, responsibility scope, abstraction quality — may be overridden via `quality-override` in the PR body.

Before deducting, check the preceding line — or, for a whole-file criterion, the first non-blank, non-shebang line — for a `// quality-override: <criterion> — <reason>` pragma. If the criterion is model-driven and the reason is non-empty, suppress that deduction and report it as an accepted override at zero weight: `path:line [<criterion>/override] accepted — <reason>`. A malformed pragma (unknown criterion, blank reason, or missing separator) is itself a `[Clarity/minor]` violation.

## Output

After scoring, emit the Quality Scores table before the completion summary:

```
## Quality Scores
| File | Quality | Readability | Encapsulation | Clarity |
|------|---------|-------------|---------------|---------|
| path/to/file.js | 10 | 10 | 10 | 10 |

Violations: none
```

This table must appear in the TDD completion summary; `/create-pr` includes it in the PR body.
