# PRD: Inline Quality-Override Pragma

## Problem Statement

A developer who hits a model-driven quality violation that is genuinely
irreducible (a framework-fixed callback signature, a math API matching a
formula) can only exempt it with a `quality-override:` line in the **PR body**.
That mechanism is not colocated with the code, is lost from the repo after
merge, and is invisible to the on-disk tools (`audit`, `code-quality-review`)
that score files rather than PR descriptions. The reviewer is left
cross-referencing two places, and after merge the rationale is gone entirely.

## Solution

Add a second, colocated override form: a `// quality-override: <criterion> —
<reason>` comment placed on the line immediately above the offending line (or on
the first non-blank, non-shebang line for whole-file criteria). The scoring
skills suppress that single deduction, report it as an accepted override at zero
score weight, and keep the rationale in git history. The PR-body form remains
valid; both coexist. Mechanical criteria stay non-overridable by either form.

The rule has a single canonical home — `lib/code-quality-rubric.md` — which is
`@`-included by `audit.md`, `code-quality-review.md`, and `tdd.md`, so every
skill that loads the rubric gains awareness from one edit. The two scoring
skills get an operational reinforcement paragraph telling them to check the
preceding line before deducting.

## User Stories

1. As a developer, I want to write `// quality-override: parameter discipline —
   <reason>` directly above an irreducible signature so the exemption lives next
   to the code and survives merge.
2. As a reviewer, I want the override rationale colocated with the violation so I
   don't have to cross-reference the PR body.
3. As an auditor running `/audit` or `/code-quality-review`, I want valid inline
   pragmas to suppress the matching deduction and appear as an accepted override
   at zero score weight, so the file can still reach 10/10.
4. As an auditor, I want the override reported (not hidden) — e.g.
   `path:line [parameter discipline/override] accepted — <reason>` — so accepted
   exemptions remain visible.
5. As a maintainer, I want mechanical criteria (file length, magic literals,
   commented-out code) to remain non-overridable by inline pragma, so structural
   debt can't be waved through.
6. As a reviewer, I want a malformed pragma (unknown criterion, blank reason,
   missing separator) flagged as a `[Clarity/minor]` violation, so a broken
   override is treated as worse than none.
7. As a developer overriding a whole-file criterion, I want to place the pragma
   on the first non-blank, non-shebang line and have it scope the file.
8. As a maintainer of scaffold's own CI, I want the skill/rubric test scripts run
   by `npm test` so the pragma assertions (and the existing orphaned tests)
   actually gate pull requests.

## Implementation Decisions

- **Canonical source — `lib/code-quality-rubric.md`.** Add an "Inline override
  (colocated)" subsection immediately after the existing PR-body Override block.
  It defines the pragma grammar, the immediately-above / first-line placement,
  zero score weight, the mechanical-criteria exclusion, and the malformed-pragma
  rule. This single edit propagates to `audit`, `code-quality-review`, and `tdd`
  through the existing `@`-include.
- **Operational reinforcement — `skills/audit.md`.** In Procedure step 2, after
  "apply all four rubric dimensions," add the "before deducting, check the
  preceding line" instruction, including suppression, accepted-override emission,
  the malformed-pragma rule, and the mechanical-criteria exclusion.
- **Operational reinforcement — `skills/code-quality-review.md`.** Add the same
  instruction to its scoring section. Because `create-pr.md` Step 5 invokes
  `code-quality-review`, the PR gate inherits inline-pragma awareness with no
  edit to `create-pr.md`.
- **Pragma grammar (contract).** `// quality-override: <criterion-slug> —
  <reason>`. The em-dash `—` is the separator (matches the PR-body form);
  `<criterion-slug>` must name a model-driven criterion; `<reason>` is required.
  Blank reason, unknown criterion, or missing separator ⇒ malformed ⇒ no
  override + `[Clarity/minor]` violation.
- **No edits to `tdd.md` or `create-pr.md`.** Both inherit the rule (tdd via
  `@`-include, create-pr via invocation). Editing them would be redundant
  duplication of the canonical rule.
- **CI wiring — `package.json`.** Add the skill/rubric test scripts
  (`test-rubric-format.sh`, `test-audit-skill.sh`, `test-code-quality-review.sh`,
  and the sibling skill tests that currently pass) to the `npm test` chain so CI
  enforces them. They all pass today, so wiring is non-breaking.
- **Unaffected.** `check-quality-mechanical.sh` and `check-resolvable.mjs` are
  not changed. A `// quality-override:` line is skipped by the mechanical
  script's comment filter and matches none of its commented-out-code tokens, so
  it raises no false positive.

## Testing Decisions

- **Convention (prior art).** Scaffold verifies prompt/skill markdown with
  `grep`-based assertion scripts (`check "desc" "pattern"` → PASS/FAIL count →
  non-zero exit on any miss). The pragma feature follows this exact pattern — no
  new test framework.
- **Modules under test:**
  - `scripts/test-rubric-format.sh` — assert the inline-override subsection
    exists: pragma syntax token (`quality-override`), the inline/colocated
    framing, the mechanical-criteria-not-overridable statement, and the
    malformed-pragma rule.
  - `scripts/test-audit-skill.sh` — assert `audit.md` contains the
    preceding-line check and accepted-override emission.
  - `scripts/test-code-quality-review.sh` — assert `code-quality-review.md`
    contains the same pragma-awareness instruction.
- **Gate verification.** After wiring into `npm test`, `npm test` must run the
  skill/rubric scripts and pass — this is the end-to-end check that the gate is
  real, not just that the scripts pass in isolation.
- **Good test here** = asserts the *instruction is present and unambiguous* in
  the markdown a model will load, not the wording verbatim. Patterns use
  alternation where phrasing could reasonably vary.

## Out of Scope

- Editing `skills/tdd.md` or `skills/create-pr.md` (covered by inheritance).
- Changing `check-quality-mechanical.sh` or `check-resolvable.mjs`.
- Removing or altering the PR-body override form.
- Making any mechanical criterion override-eligible.
- A runtime parser/linter that executes the pragma outside the skill prompts —
  the skills are model-executed; the pragma is honored by the model following
  the instruction, not by a compiled parser.

## Further Notes

- The source design doc's file-level example originally used `file length` (a
  mechanical, non-eligible criterion); the design was corrected to use an
  override-eligible whole-file criterion (`single responsibility`) so the example
  models a valid override.
- Wiring the full skill/rubric test set into `npm test` closes a pre-existing
  latent gap (those tests were created by the quality-rubric-gate feature but
  never gated). Verify each passes before adding it to the chain.
