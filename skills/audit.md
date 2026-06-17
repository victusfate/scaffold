## Purpose

Score any scope of source files against the four rubric dimensions and report the worst-offending files first, with cited violations. Use this to understand where quality debt lives before diving in to fix it.

**Difference from `/code-quality-review`:** `code-quality-review` runs in the chain (changed files only, auto-fix default, feeds PR body). `audit` is standalone: configurable scope, ranked full report, review mode default.

@../lib/code-quality-rubric.md

## Usage

```
/audit [<path>] [--fix]
```

- **`<path>`** — directory or glob to score. Defaults to all source files in the repo (`git ls-files`), excluding generated files, lock files, and fixtures.
- **`--fix`** — after reporting, apply auto-fixes for violations under 30 lines. Surfaces larger violations for user approval.

## Procedure

1. **Resolve scope** — collect target files from the path argument or `git ls-files`.

2. **Score each file** — apply all four rubric dimensions. Produce the per-file score table and violation list exactly as defined in the rubric's Score Report Format. Every deduction requires a `filename:line` citation.

   Before deducting, check whether the preceding line — or, for a whole-file criterion, the first non-blank, non-shebang line — carries a `// quality-override: <criterion> — <reason>` pragma. If the criterion is model-driven and the reason is non-empty, suppress that deduction and emit it as an accepted override at zero weight: `path:line [<criterion>/override] accepted — <reason>`. Mechanical criteria are never suppressed. A malformed pragma (unknown criterion, blank reason, or missing separator) is itself a `[Clarity/minor]` violation.

3. **Rank worst-first** — sort files by their lowest single-dimension score (ascending), then by total violation count. Files with all 10/10 scores appear last.

4. **Emit the ranked report:**

```
## Audit Report — <scope>

### Worst offenders
| File | Quality | Readability | Encapsulation | Clarity | Violations |
|------|---------|-------------|---------------|---------|-----------|
| path/to/worst.js | 6 | 8 | 10 | 7 | 4 |
| path/to/next.js  | 8 | 9 | 10 | 9 | 2 |

### All scores
| File | Quality | Readability | Encapsulation | Clarity |
|------|---------|-------------|---------------|---------|
| ... |

### Violations
- path/to/worst.js:47 [Readability/minor] bare number 86400 — extract to MAX_AGE_SECONDS
- path/to/worst.js:102 [Quality/major] dead branch — condition can never be false
```

5. **If `--fix` passed** — apply fixes for violations ≤30 lines, then re-score and re-emit the report showing before/after scores.
