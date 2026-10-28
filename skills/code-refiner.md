## Purpose

Review the current diff **and fix it**, in one composite pass: run the
correctness review (`validate`) and the structural-quality review (`simplify`)
**in parallel**, merge their findings, then apply every fix in a **single serial
pass** and re-verify. One command for "review this change fully, then make it
right and clean."

This is a thin orchestrator — it delegates the review criteria to `validate` and
`simplify` and does not reimplement them. Use it as the feature-chain's post-TDD
gate, or standalone before a PR. For a full-repo survey (not a diff), use
`/audit` instead.

**Args (pass after `/code-refiner`):**
- `--effort low|medium|high|max` — passed through to the correctness review (default: `medium`)
- `--fix` — apply the merged fixes (default standalone: review-only, present and wait)
- `--comment` — post the merged findings as inline PR comments

## Execution model

The two reviews are **read-only**, so they run concurrently with no write
conflict. The fix is a **single serial pass**, so two agents never edit the same
files at once (the failure mode that would otherwise force worktree isolation).

**Phase 1 — parallel review (two isolated reviewers, find-only):**

Spawn **two reviewer Agents in the same message** so they run concurrently. Each
has isolated context (no session priors) and applies its source skill's criteria
verbatim — neither writes any files:

1. **Correctness reviewer** — apply Phase 2 of [`skills/validate.md`](validate.md):
   correctness bugs + the test-integrity check (a test weakened to pass is a
   defect). Return `FINDINGS_CORRECTNESS` as a findings list.
2. **Structural reviewer** — apply the rubric and cleanup dimensions of
   [`skills/simplify.md`](simplify.md): the four rubric dimensions, the four
   cleanup dimensions, the diff-economy lens, and the cross-file DRY check.
   Return `SCORES_STRUCTURE` (the Quality Scores table) + violations.

Pass each the diff (`git diff main...HEAD`) and the changed-file contents.

**Phase 2 — merge (main agent):**

Combine the two result sets into one ordered work list:
- **Dedupe** overlaps — a correctness finding and a structural violation on the
  same lines become one work item.
- **Order** the work: correctness fixes first (keep behavior stable), then
  structural fixes. Note where a structural refactor would dissolve a correctness
  finding — do that once, not twice.
- If both review sets are clean (no correctness findings, all dimensions 10/10),
  skip Phase 3 and report success.

**Phase 3 — refine (single serial fixer):**

A **single** agent applies the merged work list to the working tree in one
coherent pass — never two agents writing at once. Then:
1. Re-run the test suite (if a runner is detectable). A test must not be weakened
   to pass — if a fix would require changing a test, surface it instead.
2. **Re-verify** — spawn a fresh correctness + structural check on the new diff to
   confirm findings resolved and nothing regressed. Gate: structural dimensions
   at 10/10, correctness clear. Loop Phase 3 once if the re-verify surfaces a
   regression; if it still fails, surface the remaining items and stop.

## Mode

- **Auto-fix** (from the chain, or with `--fix`): run Phases 1–3, apply, re-verify, report.
- **Review** (standalone default, no `--fix`): run Phases 1–2 and present the
  merged findings + Quality Scores table; wait for approval before Phase 3.

Detect mode from context: triggered by feature-chain/tdd → auto-fix; invoked
directly without `--fix` → review.

## Output

```
## Code Refiner — <scope>

### Correctness (validate)
- <finding>  |  none

### Structure (simplify)
| File | Quality | Readability | Encapsulation | Clarity |
|------|---------|-------------|---------------|---------|
| ...  |

### Applied (auto-fix mode)
- <what was changed, ordered>  |  nothing to fix

Re-verify: correctness clear · all dimensions 10/10
```

## Rules

- Phase 1 reviewers are read-only — no file writes during review.
- Phase 3 is single-agent and serial — never parallelize the fix.
- Delegate criteria to `validate` and `simplify`; do not restate them here.
- A test weakened to reach green is a defect, not a fix (per `validate`).
