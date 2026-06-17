# PRD: Quality Rubric Gate

## Problem Statement

Code generated during the TDD flow is verified for behavioral correctness (tests pass) but not for structural quality. Without a continuous quality gate, structurally poor code — god objects, magic literals, opaque internals, inconsistent naming — accumulates slice by slice and arrives at PR review already entrenched. Scores produced by ad-hoc quality review are unverifiable because they lack evidence: a model can emit a "9/10" without citing a single line.

## Solution

Introduce a four-dimension rubric (Quality, Readability, Encapsulation, Clarity) with evidence-based scoring: every deduction requires a `filename:line` citation. The rubric lives in `lib/code-quality-rubric.md` as a single source of truth. It is `@`-included into the TDD REFACTOR phase (per-slice check) and into `code-quality-review` (final authoritative pass). After all slices complete, a scored report is shown to the user and included in the PR body. Any dimension scoring below 8 is a hard blocker; 10/10 is the target the auto-fix loop drives toward.

## User Stories

1. As a developer running `/tdd`, I want the rubric checked at every REFACTOR phase so violations are fixed before the next slice starts, not discovered at PR time.
2. As a developer, I want every quality score backed by a cited `filename:line` violation so I can audit or dispute the score.
3. As a developer, I want to see a scored dimension × file table after TDD completes so I know exactly where any remaining violations are before creating a PR.
4. As a developer, I want violations auto-fixed in place (and tests re-run) for small fixes (<30 lines) so the chain keeps moving without interruption.
5. As a developer, I want large or architectural fixes surfaced for my approval rather than silently applied.
6. As a PR reviewer, I want the rubric scores in the PR body so I can confirm all dimensions hit 10/10 (or see any explicit overrides with stated reasons).
7. As a scaffold maintainer, I want a mechanical CI check as a required GitHub status so quality gates can't be bypassed by skipping the skill.
7. As a scaffold maintainer, I want the rubric to gate this PR's own changed files (dogfooding) so the implementation is self-validating from day one.

## Implementation Decisions

### Modules to create or modify

- **Create `lib/code-quality-rubric.md`** — the rubric content: four dimensions, per-criterion binary PASS/FAIL rules, violation weights (minor −1, major −2, critical −4), scoring formula `Score = 10 − Σ(violation weights)`, score table, citation requirement, and common failure pattern table. Existing `code-quality-review` criteria (file size, spaghetti, thin wrappers, types, canonical reuse) are folded into the appropriate dimensions as concrete examples.

- **Modify `skills/code-quality-review.md`** — replace the flat five-item checklist with `@../lib/code-quality-rubric.md`. Add scored-report output format: a markdown table of dimension scores per changed file with cited violations. Retain auto-fix / review mode detection. Add the PR-body inclusion instruction.

- **Modify `skills/tdd.md`** — add a per-slice rubric check step inside the REFACTOR phase, after tests are green. The check: `@`-include the rubric, apply the binary violation scan to files touched in this slice, auto-fix violations in place for fixes <30 lines, re-run tests, block and surface if fix >30 lines or architectural. Commit only after the rubric check passes.

### Interface contracts

- **Rubric doc format:** each criterion has a name, a PASS/FAIL rule stated in one unambiguous sentence, a machine-measurable proxy where available (e.g. `wc -l` for file length), and a declared weight (minor/major/critical).
- **Score report format:**

  ```
  ## Quality Scores
  | File | Quality | Readability | Encapsulation | Clarity |
  |------|---------|-------------|---------------|---------|
  | path/to/file.js | 10 | 9 | 10 | 10 |
  Violations:
  - path/to/file.js:47 [Readability/minor] magic number 86400 — extract to MAX_AGE_SECONDS
  ```

- **Gate:** 10/10 on all four dimensions required on every changed file. Any dimension below 10 triggers the auto-fix loop before the summary or PR creation proceeds. A `quality-override: <file> — <criterion> — <reason>` line in the PR body exempts that file from a specific model-driven criterion only. Mechanical criteria (file length, magic literals, commented-out code) cannot be overridden — the code must be fixed. Overrides are visible in the PR record and must be re-justified per PR.

### Mechanical CI check

- **Create `scripts/check-quality-mechanical.sh`** — shell script that runs against `git diff main...HEAD --name-only` to find changed files, then for each: checks line count (`wc -l` > 250 = violation), scans for magic literals (bare numeric/string literals not assigned to a named constant, via regex), scans for commented-out code blocks (`//` or `#` lines containing code patterns). Emits `PASS` or `FAIL` with `filename:line` citations. Exits non-zero on any violation.
- **Create `.github/workflows/quality.yml`** — GitHub Actions workflow that runs `scripts/check-quality-mechanical.sh` as a required check on every PR. Must pass before merge.

### Scaffold-files manifest

`lib/code-quality-rubric.md` and `scripts/check-quality-mechanical.sh` must be added to `.github/scaffold-files.txt` so they propagate to downstream repos on sync.

### Harness wrappers

`lib/` is a new directory. It does not go through the RESOLVER skill machinery (it is a library doc, not an invocable skill). No wrappers, no RESOLVER entry needed. The RESOLVER validator only checks `.claude/skills/` directories.

## Testing Decisions

**What makes a good test here:** the rubric is prose that drives model behaviour — there is no runtime binary to unit-test. Tests verify that the rubric doc is structurally correct (criteria format, weights present, citation requirement stated) and that the modified skills correctly @-include it.

**Tests to write:**

1. `scripts/test-rubric-format.sh` — asserts `lib/code-quality-rubric.md` contains: all four dimension headings, the citation requirement phrase, weight declarations (minor/major/critical), and the score formula. Fails fast on any missing structural element.
2. Inline assertion in `scripts/check-resolvable.mjs` (or a companion script) — verifies that `lib/code-quality-rubric.md` is listed in `scaffold-files.txt`.
3. Manual acceptance: run `code-quality-review` against `lib/code-quality-rubric.md` itself and confirm it produces a valid score table with citations.

**Prior art:** `scripts/check-resolvable.mjs` is the model for structural validation scripts. `scripts/update-skills-doc.mjs` shows how to verify doc content programmatically.

## Out of Scope

- Static analysis tooling (ESLint, AST-based checks) — deferred to future research.
- Language-specific rubric addenda (React hooks, Python dataclasses, etc.) — deferred.
- Automated score history or trend tracking across PRs.
- Changes to any skill other than `code-quality-review` and `tdd`.

## Further Notes

- Violation weights (minor −1, major −2, critical −4) are a starting point. They may need tuning after the first few real PRs; the rubric doc is the single place to change them.
- The `lib/` directory is new. If future lib docs are added, consider whether `check-resolvable.mjs` should also validate lib doc structure.
- React-specific criteria in the rubric (useEffect deps, stable output identity) should be annotated as framework-specific so non-React code skips them cleanly.
