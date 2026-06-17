# Plan: Inline Quality-Override Pragma

Vertical slices. Each slice is RED → GREEN → REFACTOR against the real `npm test`
suite. Slice 1 wires the skill/rubric tests into `npm test` first, so every later
slice's RED genuinely fails the gate and GREEN restores it.

---

## Slice 1 — Establish the gate: wire skill/rubric tests into `npm test`

**Behavior:** `npm test` runs the skill/rubric assertion scripts so CI enforces
them. All six pass today, so wiring is non-breaking. This closes the latent gap
where the quality-rubric-gate tests existed but never gated.

**Files:**
- `package.json` (extend the `test` script to invoke the skill/rubric test
  scripts: `test-rubric-format.sh`, `test-audit-skill.sh`,
  `test-code-quality-review.sh`, `test-tdd-rubric.sh`, `test-mechanical-check.sh`,
  `test-create-pr-gate.sh`).

**Verification:** `npm test` invokes each newly-wired script and exits 0.
(No behavioral RED — the proof is that `npm test` now runs them and stays green.)

---

## Slice 2 — Rubric: inline-override subsection (canonical source)

**Behavior:** `lib/code-quality-rubric.md` gains an "Inline override (colocated)"
subsection immediately after the existing PR-body Override block. It defines the
`// quality-override: <criterion> — <reason>` grammar, the immediately-above /
first-line placement, zero score weight, the mechanical-criteria-not-overridable
rule, and the malformed-pragma → `[Clarity/minor]` rule. Propagates to `audit`,
`code-quality-review`, and `tdd` via the existing `@`-include.

**Files:**
- `scripts/test-rubric-format.sh` (add assertions)
- `lib/code-quality-rubric.md` (add subsection)

**Tests (RED → GREEN):** assert the rubric contains: the inline/colocated
override framing, the `quality-override` pragma token in inline context, the
"mechanical criteria cannot be overridden inline" statement, and the
malformed-pragma rule.

---

## Slice 3 — audit.md: pragma-awareness in Procedure step 2

**Behavior:** `skills/audit.md` step 2 instructs: before deducting, check the
preceding line for `// quality-override: <criterion> — <reason>`; if the
criterion matches and the reason is non-empty, suppress the deduction and emit it
as an accepted override (zero weight); malformed pragmas are a `[Clarity/minor]`
violation; mechanical criteria are never suppressed.

**Files:**
- `scripts/test-audit-skill.sh` (add assertion)
- `skills/audit.md` (add instruction to Procedure step 2)

**Tests (RED → GREEN):** assert `audit.md` contains the preceding-line pragma
check and the accepted-override emission.

---

## Slice 4 — code-quality-review.md: pragma-awareness in scoring

**Behavior:** `skills/code-quality-review.md` gains the same pragma-awareness
instruction in its scoring section. Because `create-pr.md` Step 5 invokes
`code-quality-review`, the PR gate inherits inline-pragma awareness with no edit
to `create-pr.md`.

**Files:**
- `scripts/test-code-quality-review.sh` (add assertion)
- `skills/code-quality-review.md` (add instruction)

**Tests (RED → GREEN):** assert `code-quality-review.md` contains the inline
pragma check / preceding-line suppression instruction.

---

---

## Slice 5 — README: full refresh against latest flows (doc-only)

**Behavior:** `README.md` documents the current flows. Doc-only — no RED→GREEN;
verify `npm test` stays green and commit separately. Audit the whole file; the
known gap is the quality-rubric gate, which is entirely undocumented.

**Covers:**
- New **Quality gate** section: four-dimension rubric (`lib/code-quality-rubric.md`),
  scoring formula + violation weights, `/audit` and `/code-quality-review` skills,
  the mechanical CI check (`scripts/check-quality-mechanical.sh` +
  `.github/workflows/quality.yml`), and **both** override forms — PR-body and the
  new inline pragma.
- Workflow section: phase-4 mentions the `code-quality-review` 10/10 gate before
  the review summary.
- "How releases work": reflect the two CI jobs (`verify` = `npm test`, now
  including the skill/rubric tests; `Quality Gate` = mechanical checks).
- Verify the remaining sections (harness support, sync, hoist, skill engine,
  branch protection) still match the code; correct any drift.

**Verification:** `npm test` green; manual read-through that documented commands
match actual scripts/flags.

---

## Not in this plan

- `skills/tdd.md`, `skills/create-pr.md` — inherit via `@`-include / invocation.
- `scripts/check-quality-mechanical.sh`, `scripts/check-resolvable.mjs` — unchanged.
