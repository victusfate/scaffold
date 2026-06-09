## Instructions

Run the full feature chain end-to-end. **Do not pause for permission between phases.** Pauses *within* a phase belong to the phase's own skill (grill Q&A answers, `to-prd` test-module confirmation, `tdd` granularity confirmation); the chain itself stops only at the end for user review.

---

## Entry-point detection (run before any phase)

Check `./docs/<feature-slug>/` for existing artifacts and detect whether a document was supplied externally (uploaded file, pasted content, or a path the user named).

| State | Entry point |
|---|---|
| External doc supplied (any format) | Place as `design.md` → start at Phase 2 |
| `plan.md` exists | Resume Phase 3 at first incomplete slice |
| `prd.md` exists, no `plan.md` | Skip Phases 1–2 → start at Phase 3 |
| `design.md` exists, no `prd.md` | Skip Phase 1 → start at Phase 2 |
| Nothing / intent unclear | Start at Phase 1 — grill resolves what to build |

State the slug before writing the first file so the user can correct it. Infer it from the document title if obvious; ask once if not.

**Accepting an external document (any format):**

Always treat a pasted or uploaded document as a design doc — regardless of whether it looks like a PRD, spec, or proposal.

Rationale: Phase 2 (`to-prd`) adds genuine value even when the input is already a complete PRD. It cross-references the codebase, catches conflicts with existing code, identifies modules already in place, and derives testing decisions the external doc cannot know. The output `prd.md` is always codebase-aware.

1. Infer the feature slug from the document title. Ask once if it is not obvious.
2. Write the content to `./docs/<feature-slug>/design.md` verbatim. Reformat into the standard design-doc structure only if it aids legibility — preserve every decision, requirement, and vocabulary term.
3. Run `/design-review` in auto-fix mode to patch structural gaps.
4. Commit `docs(<slug>): design Q&A and vocabulary (external)`.
5. **Grill on ambiguity** — read `design.md` and assess whether any decisions are unresolved, vocabulary is fuzzy, or edge cases are missing. If so, run Phase 1 (grill) targeting only the open questions — do not re-ask settled decisions. If the doc is complete and unambiguous, skip Phase 1 and proceed directly to Phase 2.
6. Proceed to Phase 2 (PRD synthesis).

---

## Phase 1: Design

Run `/grill-with-docs` — it owns the interview, the design-tree resolution, and
`design.md`. Chain-specific glue only:

- State the slug before the first file is written so the user can correct it.
- **Callable units — decide at design time.** If the feature adds a tool,
  script, skill, or bin command, the Q&A MUST resolve which home it belongs in
  (`docs/agent-authoring-requirements.md` §1) and its descriptor contract.

**When `design.md` is committed:** run `/design-review` in auto-fix mode — it
patches `design.md` and resolves any blockers. Then proceed immediately to
Phase 2.

---

## Phase 2: PRD

Run `/to-prd` — it owns codebase synthesis, the PRD template, and the
testing-decisions step (including its user confirmations). Do not re-interview
design questions; only `to-prd`'s own confirmations apply.

**When `prd.md` is committed:** proceed immediately to Phase 3.

---

## Phase 3: Plan + TDD

Run `/tdd` — it owns plan creation (vertical slices from `prd.md`, with its
one-time granularity confirmation), the RED → GREEN → REFACTOR loop, per-slice
commits, and `tdd-log.md`.

**When all slices are complete and the full test suite passes:** run
`/code-quality-review` in auto-fix mode — it will patch source files and
resolve any blockers. Then proceed to Phase 4.

---

## Phase 4: Review

Present a summary and stop for the user to review before anything is merged.

```
## Feature complete: <feature-slug>

### What was built
- <file or module>: <one-line description>
- …

### Tests
- <N> tests passing across <M> slices
- Behaviors covered: <list>

### Decisions that deviated from the plan
- <any divergence, or "none">
```

Then prompt: **"All tests pass. Please review the generated source before merging."**

Wait here. Do not proceed until the user confirms or requests changes.

---

## Stopping and resuming

If the user says "stop", "pause", or "just answer" — stop the chain immediately. Resume any phase individually: `/grill-with-docs`, `/to-prd`, `/tdd`.
