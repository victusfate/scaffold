# Inline Quality-Override Pragma — Design

> Source: external design doc (uploaded), augmented with codebase-aware Q&A and
> canonical vocabulary during the feature chain. Every decision and requirement
> from the source is preserved below.

## Problem

The rubric's existing override mechanism requires a line in the **PR body**:

```
quality-override: src/foo.ts — criterion — reason
```

This works for PR-scoped exemptions but has three pain points:

1. **Not colocated with the code.** Reviewers must cross-reference the PR body
   and the source line to understand why a violation was accepted.
2. **Lost after merge.** PR bodies aren't checked into the repo, so the
   rationale disappears from the codebase history.
3. **Not machine-readable in audit / code-quality-review.** Those tools run
   against files on disk, not against a PR body, so they cannot honor the
   exemption automatically.

## Proposed pragma syntax

Place the comment on the line **immediately above** the offending line:

```ts
// quality-override: parameter discipline — framework callback; signature is fixed by SDK
export function onRequest(req: Request, res: Response, next: NextFunction): void {
```

The pragma format:

```
// quality-override: <criterion-slug> — <reason>
```

- `<criterion-slug>` must be one of the named non-mechanical criteria (see
  Eligibility below).
- `<reason>` is required; a blank reason is a parse error and treated as
  **no override**.
- Em dash (`—`) is the separator (matches the PR-body override format).

### File-level pragma (for file-length violations)

When a violation applies to the whole file rather than a single line, place the
pragma on the first non-blank, non-shebang line:

```ts
// quality-override: single responsibility — orchestrator; all routes handled here by framework contract
import ...
```

> Note: the example uses an **override-eligible** criterion (single
> responsibility). File **length** is mechanical and therefore **not**
> override-eligible (see Eligibility) — a long file must be fixed, not exempted.
> The file-level placement rule exists only for override-eligible criteria that
> scope a whole file.

---

## Eligibility

Only **model-driven criteria** may be overridden. Mechanical criteria are never
exempt — they must be fixed.

| Criterion | Mechanical? | Override eligible |
|-----------|-------------|-------------------|
| File length (lines) | ✓ | ✗ |
| Magic number / string | ✓ | ✗ |
| Commented-out code | ✓ | ✗ |
| Parameter discipline (>4 params) | borderline | ✓ |
| Single responsibility | ✗ | ✓ |
| Top-to-bottom narrative | ✗ | ✓ |
| Surprise control flow | ✗ | ✓ |
| Stable output identity (hooks) | ✗ | ✓ |
| Opaque internals | ✗ | ✓ |
| Canonical vocabulary | ✗ | ✓ |
| Obvious data flow | ✗ | ✓ |

> **Note on parameter discipline:** although "borderline mechanical" it is
> override-eligible because caller-controlled signatures (framework callbacks,
> math APIs matching a formula) are legitimately irreducible. The reason field
> must explain why grouping into an options object would actively harm the
> caller.

---

## Audit / code-quality-review behavior

When either tool encounters a `// quality-override: X — Y` comment:

1. **Parse** the criterion slug and reason.
2. **Suppress** any deduction on the immediately following line for criterion X.
3. **Report** the override in the violations section as:
   ```
   - path/to/file.ts:47 [parameter discipline/override] accepted — framework callback; signature fixed by SDK
   ```
   Overrides appear in the report but contribute **zero weight** to the score.
4. **Reject invalid pragmas** (unknown criterion slug, blank reason, separator
   absent) and report them as a `[Clarity/minor]` violation — a malformed
   override is worse than no override.

---

## Changes required in scaffold

### 1. `lib/code-quality-rubric.md`

Add a new subsection after the existing Override block:

```markdown
**Inline override (colocated):** place `// quality-override: <criterion> — <reason>`
on the line immediately above the offending line. Suppresses that single deduction
and appears in audit output as an accepted override (zero score weight).
File-level overrides go on the first non-blank, non-shebang line.
Mechanical criteria (file length, magic literals, commented-out code) cannot be
overridden inline or via PR body. A malformed pragma (unknown criterion, blank
reason, missing separator) is itself a [Clarity/minor] violation.
```

Because `lib/code-quality-rubric.md` is `@`-included by `audit.md`,
`code-quality-review.md`, **and** `tdd.md`, this single edit is the canonical
source of the rule and propagates to every skill that loads the rubric.

### 2. `skills/audit.md` (Procedure step 2)

Add after "apply all four rubric dimensions":

```
Before deducting for a violation, check whether the preceding line contains
// quality-override: <criterion> — <reason>. If the criterion matches and the
reason is non-empty, suppress the deduction and emit it as an accepted override
(zero weight). Malformed pragmas (unknown criterion, blank reason) are
themselves a [Clarity/minor] violation. Mechanical criteria are never suppressed.
```

### 3. `skills/code-quality-review.md` (scoring instructions)

Same paragraph as above — `code-quality-review` runs in the chain against
changed files, so it needs the same pragma-awareness. Because `create-pr.md`
invokes `code-quality-review` for its Step 5 gate, the PR gate inherits inline-
pragma awareness through this change.

---

## What does NOT change

- The PR-body override (`quality-override: file — criterion — reason`) remains
  valid; both forms coexist.
- Mechanical criteria (file length, magic literals, commented-out code) are
  still never overridable by either mechanism.
- The `--strict` flag in `check-resolvable.mjs` / `check-quality-mechanical.sh`
  is unaffected — it operates on structural properties, not inline pragmas. (A
  `// quality-override:` comment line is skipped by the mechanical script's
  comment filter and does not match its commented-out-code token list, so it
  produces no false positive.)
- `skills/tdd.md` and `skills/create-pr.md` are **not** edited: tdd inherits the
  rule via its `@`-include of the rubric, and create-pr inherits the behavior by
  invoking `code-quality-review`.

---

## Example — before and after

**Before (violation with no recourse):**

```ts
// scoring.ts:115 — [Readability/minor] mfLearnOne has 6 positional params
export function mfLearnOne(
  params: MfParams, globalMean: number, n: number,
  user: FactorRow, item: FactorRow, rating: number,
): ...
```

**After (inline override if refactor is genuinely worse):**

```ts
// quality-override: parameter discipline — BiasedMF SGD formula; options object obscures the math and breaks published API
export function mfLearnOne(
  params: MfParams, globalMean: number, n: number,
  user: FactorRow, item: FactorRow, rating: number,
): ...
```

Audit output:

```
- src/scoring.ts:116 [parameter discipline/override] accepted — BiasedMF SGD formula; options object obscures the math and breaks published API
```

Score stays 10; the rationale is colocated and in git history.

---

## Resolved decisions (codebase-aware Q&A)

These were resolved against the actual scaffold codebase during the chain; they
extend — not contradict — the source doc.

**Q1 — How should the new pragma tests gate?**
The skill/rubric test scripts (`test-rubric-format.sh`, `test-audit-skill.sh`,
`test-code-quality-review.sh`, and siblings) all pass but are **not wired into
`npm test`**, so CI (which runs `npm test` + `check-quality-mechanical.sh`) never
executes them.
**Decision:** Wire the skill/rubric test scripts into the `npm test` chain so CI
enforces the new pragma assertions and closes the latent gap for the existing
orphaned tests. All currently pass, so the wiring is low-risk.

**Q2 — Which files are in scope beyond the design's three?**
`create-pr.md`'s Step 5 gate already honors inline pragmas behaviorally (it
invokes `code-quality-review`), and `tdd.md` inherits the rule via its
`@`-include of the rubric.
**Decision:** Scope is exactly the three design files (rubric + audit +
code-quality-review). `create-pr.md` and `tdd.md` are left untouched and gain
pragma-awareness automatically. (MVD — matches the source doc's stated scope.)

**Test convention.** Verification follows the established scaffold pattern:
`grep`-based assertion scripts (`check "desc" "pattern"`) appended to the
existing per-file test scripts. No new test framework is introduced.

---

## Canonical vocabulary

| Term | Meaning |
|------|---------|
| **Inline override / pragma** | A `// quality-override: <criterion> — <reason>` comment colocated with the offending code. |
| **PR-body override** | The pre-existing `quality-override: <file> — <criterion> — <reason>` line in the pull-request description. Both forms coexist. |
| **criterion-slug** | The name of a rubric criterion (e.g. `parameter discipline`, `file length`). Must match a named rubric criterion. |
| **reason** | Required free-text justification after the em-dash separator. Blank reason ⇒ no override. |
| **Mechanical criterion** | A criterion checked by a script (`file length`, `magic number / string`, `commented-out code`). Never override-eligible. |
| **Model-driven criterion** | A criterion judged by the reviewer/model (single responsibility, narrative, surprise control flow, opaque internals, canonical vocabulary, obvious data flow, parameter discipline). Override-eligible. |
| **Accepted override** | A valid pragma that suppresses one deduction; reported with the `[<criterion>/override] accepted — <reason>` tag at **zero** score weight. |
| **Malformed pragma** | A pragma with an unknown criterion, blank reason, or missing separator. Itself a `[Clarity/minor]` violation. |
| **File-level pragma** | A pragma placed on the first non-blank, non-shebang line, scoping a whole-file (override-eligible) criterion. |
| **Suppress** | To skip the deduction for the named criterion on the immediately following line. |
