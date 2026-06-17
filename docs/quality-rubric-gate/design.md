# Design: Quality Rubric Gate

## Canonical Vocabulary

| Term | Definition |
|------|-----------|
| Rubric | The four-dimension scoring framework (Quality, Readability, Encapsulation, Clarity), each 1–10 |
| Dimension | One of the four rubric axes; scores 10 when every item in it is satisfied |
| Gate | A hard stop in the TDD/review flow that blocks advancement until all dimensions reach target score |
| Auto-fix | The code-quality-review mode in which findings are applied directly without user approval |
| Review mode | The code-quality-review mode in which findings are presented as diffs for user approval |
| Slice | One vertical TDD unit (data → logic → UI → tests) from plan.md |

## Decisions

### D1 — Augment, not replace
**Decision:** The new four-dimension rubric augments the existing `code-quality-review` criteria. Existing examples (file size, spaghetti, thin wrappers, types, canonical reuse) are remapped into the appropriate rubric dimensions rather than discarded.

**Rationale:** The rubric is the organizing framework; the existing criteria are concrete examples that fit naturally inside it. Keeping them preserves institutional knowledge while gaining the structured scoring vocabulary.

**Mapping:**
- File size (≥1000 lines) → Readability ("fits in one mental model")
- Spaghetti / ad-hoc conditionals → Quality ("no workarounds in wrong place", "no dead logic")
- Thin wrappers / abstraction violations → Encapsulation ("opaque internals")
- Types (unnecessary optionality, casts) → Quality / Clarity
- Canonical reuse → Clarity ("canonical vocabulary", "obvious data flow")

**Alternatives considered:** Replace outright — rejected because it discards concrete worked examples that help the model recognize violations.

### D2 — Rubric lives in lib/, referenced by @-include
**Decision:** Rubric content lives in `lib/code-quality-rubric.md`. Both `skills/code-quality-review.md` and `skills/tdd.md` `@`-include it.

**Rationale:** The rubric runs after every code gen — at each TDD slice's REFACTOR phase, not just the final review. Two skills need it; a shared lib doc avoids duplication and gives downstream repos a single file to override.

**Alternatives considered:** Embed in `code-quality-review.md` only — rejected because the REFACTOR phase in `tdd.md` also needs the rubric, and duplicating prose across skills creates drift.

### D3 — Rubric check is per-slice in REFACTOR, not just end-of-feature
**Decision:** The four-dimension rubric check runs at the REFACTOR step of every TDD slice, as well as at the final `code-quality-review` pass after all slices complete.

**Rationale:** User requirement — "runs after any code gen" to prevent structurally poor code accumulating slice by slice. Catching violations per-slice is cheaper than fixing them all at the end.

**Scope:** The per-slice check is a self-assessment against the rubric criteria; the final `code-quality-review` is the authoritative scored pass in auto-fix mode.

### D4 — Auto-fix in place; block only for large/architectural changes
**Decision:** Rubric violations found during REFACTOR are fixed immediately in-place. Tests re-run to confirm green before committing. Block and surface only when the fix would exceed ~30 lines or require architectural rethinking.

**Rationale:** Keeps the chain moving without per-slice interruptions while still catching structural problems early.

### D5 — Scored report shown after TDD, included in PR
**Decision:** After all TDD slices complete and all auto-fixes are applied, the final `code-quality-review` produces a scored report (dimension × file, 1–10 each) that is shown to the user before PR creation and included in the PR body.

**Rationale:** User requirement — visibility into scores at PR time, not just a pass/fail gate. The report surfaces any remaining 8–9 scores so the user can decide to accept or fix before merging.

