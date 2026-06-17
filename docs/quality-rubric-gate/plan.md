# Plan: Quality Rubric Gate

## Slice 1 — Rubric doc: persona preamble + four dimensions + format test

**Behavior:** `lib/code-quality-rubric.md` exists, opens with the reviewer persona, defines all four dimensions with binary PASS/FAIL criteria, violation weights, score formula, citation requirement, and common failure table. `scripts/test-rubric-format.sh` passes.

**Files:**
- `lib/code-quality-rubric.md` (create)
- `scripts/test-rubric-format.sh` (create)
- `.github/scaffold-files.txt` (add `lib/code-quality-rubric.md`)

**Tests:** `scripts/test-rubric-format.sh` — asserts all four dimension headings present, citation requirement stated, weight declarations present, score formula present, persona preamble present.

---

## Slice 2 — TDD skill: rubric as generative voice (strange loop)

**Behavior:** The rubric is loaded before GREEN, not just at REFACTOR. The model writes code as the thoughtful senior engineer — the reviewer persona is the generative voice. REFACTOR is a confirmation pass: scores are shown, violations are surfaced (not silently patched). A violation found at REFACTOR signals a GREEN-phase failure; auto-fix applies for <30 lines, surfaces for >30. Slice not committed until all scores are 10/10.

**Files:**
- `skills/tdd.md` (modify — @-include rubric before GREEN step AND in REFACTOR; REFACTOR reframed as confirmation)

**Tests:** Verify `skills/tdd.md` contains the `@`-include before the GREEN step, the confirmation framing in REFACTOR, and the per-slice score display.

---

## Slice 3 — code-quality-review: scored report shown after TDD, before create-pr

**Behavior:** After all TDD slices complete, `code-quality-review` produces a dimension × file score table with cited violations and displays it as part of the TDD completion summary — before the user invokes `/create-pr`. The table shows hard numeric scores. Any score below 10 triggers the auto-fix loop. Override annotations are honoured for model-driven criteria only.

**Files:**
- `skills/code-quality-review.md` (modify — @-include rubric, add scored report format, add override handling)

**Tests:** Verify `skills/code-quality-review.md` contains the `@`-include, the score table format, and the override annotation syntax.

---

## Slice 4 — create-pr: model gate + scores in PR body

**Behavior:** `create-pr` runs the full rubric model gate before opening the PR. If any file scores below 10/10 (excluding valid overrides), PR creation is blocked and violations are surfaced. When all scores are 10/10, the score table is included in the PR body.

**Files:**
- `skills/create-pr.md` (modify — add quality gate step before Step 5)

**Tests:** Verify `skills/create-pr.md` contains the quality gate step and score-table inclusion in PR body template.

---

## Slice 5 — Mechanical CI check + workflow

**Behavior:** `scripts/check-quality-mechanical.sh` runs against changed files, checks file length (>250 lines = violation), magic literals (bare numeric/string not assigned to a named constant), and commented-out code blocks. Emits `filename:line` citations, exits non-zero on any violation. `.github/workflows/quality.yml` runs it as a required check on every PR.

**Files:**
- `scripts/check-quality-mechanical.sh` (create)
- `.github/workflows/quality.yml` (create)
- `.github/scaffold-files.txt` (add script)

**Tests:** Unit test the script against fixture files with known violations and known-clean files. Confirms correct citations emitted and correct exit codes.
