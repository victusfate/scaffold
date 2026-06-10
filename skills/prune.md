## Purpose

Run every quality lens on the current branch — correctness review, structural quality, and simplification — then funnel all findings into a full feature chain (design → PRD → TDD → PR) to fix them systematically.

Use this when fixes are too large for a one-shot apply: the findings need a plan, tests, and a proper PR.

## When to use

- After a long feature sprint to clean up accumulated debt
- When taking over code that needs a full quality pass before further development
- When `/code-quality-review` + `/simplify` alone aren't enough — the improvements warrant a structured plan

## Pipeline

Do not pause between phases. The only pause is at the end of Phase 4 (feature-chain review step).

---

### Phase 1: Audit

Collect findings only — nothing is fixed until the chain's TDD phase.

1. **`/code-review --effort max`** (no `--fix` flag — its default prints
   findings and waits). Record as `FINDINGS_REVIEW`.
2. **Structural-quality lens** — apply the `/code-quality-review` checklist
   (file size, spaghetti, abstractions, types, canonical reuse) as a read-only
   audit. Do not invoke the skill itself: invoked from this chain it would
   auto-fix. Record as `FINDINGS_QUALITY`.
3. **Simplification lens** — apply the `/simplify` dimensions (reuse,
   simplification, efficiency, altitude) the same way; `/simplify` itself has
   no list-only mode. Record as `FINDINGS_SIMPLIFY`.

Produce a consolidated findings table with source tags: `[review]`, `[quality]`, `[simplify]`.

---

### Phase 2: Design

State the slug before writing. Default: `quality-<branch-short>` where `<branch-short>` is the last path segment of the current branch name.

Write `./docs/<slug>/design.md`:

```markdown
# Design: Quality Rework — <scope>

## Canonical Vocabulary
| Term | Definition |
|---|---|

## Findings
| ID | Source | File | Finding | Severity |
|---|---|---|---|---|
| F-01 | [review] | … | … | high |

## Decisions
(how each finding class will be addressed — group related findings, not one-by-one)

## Scope
In: …
Out: …

## Edge Cases
(anything fragile the fixes must not break)
```

Commit: `docs(<slug>): audit findings and design`

Run `/design-review` in auto-fix mode. Then proceed immediately to Phase 3.

---

### Phase 3: PRD

Run `/to-prd`. Do not re-interview — synthesize from the design and findings.

- User Stories: each class of fix as a story, referencing finding IDs.
- Implementation Decisions: map finding IDs to concrete changes.
- Testing Decisions: identify which fixes are risky enough to require tests.

Commit: `docs(<slug>): PRD`

Proceed immediately to Phase 4.

---

### Phase 4: TDD

Run `/tdd` from `prd.md`. Each vertical slice should correspond to one cohesive group of fixes (e.g., "extract duplicated helpers", "fix correctness bugs in module X").

After all slices pass, run `/code-quality-review` in auto-fix mode. Then proceed to Phase 5.

---

### Phase 5: PR

Run `/create-pr`. The PR body should include the findings summary and list which finding IDs were addressed.

---

## Stopping

If the user says "stop", "pause", or "just answer" — stop immediately.

## Resuming

- Audit: re-run Phase 1
- Design: edit `design.md` directly, then re-run `/design-review`
- PRD: run `/to-prd`
- TDD: run `/tdd`
- PR: run `/create-pr`
