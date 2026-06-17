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

