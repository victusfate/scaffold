# Plan: Quality skill isolation + codebase fixes

Findings from dogfooding all four review skills on this branch. Two phases:
Phase 1 fixes breaking/correctness issues; Phase 2 resolves quality violations.

---

## Phase 1 — Correctness fixes (skill changes)

### 1A · code-quality-review: cross-file DRY check broken in isolated context
**File:** `skills/code-quality-review.md`
**Problem:** DRY check requires grepping the codebase, but the reviewer Agent only
received changed file contents. It cannot grep what it was not given.
**Fix:** Move the grep to Phase 1 (main agent). Main agent runs the cross-file grep
for each changed file and embeds the results in the reviewer prompt alongside file contents.

### 1B · audit: re-score loop passes nothing to second reviewer
**File:** `skills/audit.md`
**Problem:** Phase 3 says "spawn a second reviewer Agent" after `--fix` but gives it
no file contents. The reviewer cannot score files it cannot read.
**Fix:** Phase 3 must read the fixed files and embed their contents when spawning the
second reviewer, same as Phase 1 does for the first pass.

### 1C · audit: reviewer filesystem access not stated
**File:** `skills/audit.md`
**Problem:** Phase 2 says the reviewer "reads the files itself" but never states it
has Read tool access. A reader following the skill cannot tell whether to embed
contents or rely on tools.
**Fix:** Explicitly state the reviewer uses its Read tool to read each file from disk.

### 1D · code-review: Phase 2 heading wrong for --full path
**File:** `skills/code-review.md`
**Problem:** Phase 2 opens with "For each changed file apply:" — correct for diff mode,
wrong for `--full` (all tracked files are in scope, not just changed ones).
**Fix:** Replace heading with scope-aware language: "For each file in scope apply:"

### 1E · code-quality-review: Phase 3 has no mode detection
**File:** `skills/code-quality-review.md`
**Problem:** Phase 3 says "apply the appropriate mode" with no reference to where
mode is defined. The Mode section is below and disconnected.
**Fix:** Add a forward reference in Phase 3: "See Mode section below for auto-fix vs
review behaviour."

---

## Phase 2 — Quality fixes

### 2A · Execution model preamble duplicated across all three skill files
**Files:** `skills/code-review.md`, `skills/code-quality-review.md`, `skills/audit.md`
**Problem:** The "Run the review as a separate Agent… A fresh subagent has no such
priors." paragraph is copy-pasted verbatim into all three files.
**Fix:** Extract to `lib/review-isolation-note.md` and `@include` it at the top of
each skill's Execution model section.

### 2B · Vocabulary: "subagent" vs "reviewer Agent" in code-review.md
**File:** `skills/code-review.md`
**Problem:** Line 13 says "subagent"; lines 20 and 25 say "reviewer Agent". Two
terms for one concept in the same file.
**Fix:** Standardise on "reviewer Agent" throughout (matches the other two skill files).

### 2C · Override pragma spec duplicated between code-quality-review and audit
**Files:** `skills/code-quality-review.md`, `skills/audit.md`
**Problem:** Both files independently define the same pragma parsing, suppression,
and reporting contract. The canonical home is `lib/code-quality-rubric.md`,
which both files already `@include`.
**Fix:** Move the override pragma spec into `lib/code-quality-rubric.md` and remove
it from both skill files (they inherit it via @include).

### 2D · Stale per-harness descriptions for code-review
**Files:** `.claude/skills/code-review/SKILL.md`, `.cursor/rules/code-review.mdc`,
`.agents/skills/code-review/SKILL.md`, `.agent/workflows/code-review.md`
**Problem:** All four say "Review current diff for correctness bugs" — `--full` flag
and whole-codebase scope not mentioned.
**Fix:** Update description in all four harness wrappers to reflect `--full`.

### 2E · audit exclusion list stated twice within audit.md
**File:** `skills/audit.md`
**Problem:** "generated files, lock files, and fixtures" appears in both the Usage
section and Phase 1, within the same file.
**Fix:** Keep it in Usage only; Phase 1 references "scope resolved above."

### 2F · Magic number 30 (fix threshold) bare literal in two files
**Files:** `skills/code-quality-review.md`, `skills/audit.md`
**Problem:** The 30-line threshold for auto-fix vs approval is a bare literal
repeated in both files with no named constant or cross-reference.
**Fix:** Name it inline ("the 30-line threshold") and add a parenthetical in one
file noting it matches the threshold in the other.

---

## Phase 3 — Pre-existing codebase findings

### 3A · check-resolvable.ts: existsSync guard after parse call
**File:** `scripts/check-resolvable.ts:60`
**Problem:** `parseResolverRows` is called before the `existsSync` guard that is
meant to short-circuit it. Works by accident (returns `[]` on missing file).
**Fix:** Move the `existsSync` check to before the `parseResolverRows` call.

### 3B · hook.sh: lock not released in record_read()
**File:** `.claude/read-once/hook.sh`
**Problem:** `record_read()` calls `acquire_lock()` but never calls `release_lock()`.
On non-flock systems (mkdir spin-lock path) a subsequent `acquire_lock()` call
sees `_locked=1` and fast-returns without acquiring, breaking concurrent write
serialisation.
**Fix:** Add `release_lock` at the end of `record_read()`, or restructure to use the
EXIT trap exclusively.

### 3C · check-quality-mechanical.sh: check_file does three scan passes
**File:** `scripts/check-quality-mechanical.sh`
**Problem:** `check_file` runs file-length, magic-number, and commented-out-code
scans as sequential loops in one function — three responsibilities.
**Fix:** Split into `check_length`, `check_magic`, `check_commented`; caller composes them.

### 3D · resolver-phases.ts: compileIgnore alias breaks canonical vocabulary
**File:** `scripts/resolver-phases.ts:208`
**Problem:** `const compileIgnore = compileKeepMatcher` introduces a second name
for the same function. Clarity/major + thin-wrapper Encapsulation/major.
**Fix:** Delete the alias; call `compileKeepMatcher` directly in `phaseManifestCompleteness`.

### 3E · safe-write.ts: deeply nested conditionals
**File:** `tools/lib/safe-write.ts:79`
**Problem:** The `safeWrite` function has 3+ levels of nesting for the
kept/unchanged/force/check branches. Readability/major.
**Fix:** Refactor with early returns:
`if (identical) return; if (kept) return; if (!force && !check) { sidecar; return; }`

### 3F · policy.ts: god-function parsePolicy
**File:** `tools/sync/policy.ts:22`
**Problem:** 110-line function conflating YAML parsing state machine, section
tracking, and field validation. String-encoded section sub-hierarchy adds
reader load. Readability: 4/10.
**Fix:** Extract inner `indentOf`/`unquote`/`flushGuarded` helpers to module scope;
replace string section sub-hierarchy with a discriminated union or section enum.

### 3G · hoist.ts: hoist() dispatches three modes in one function
**File:** `tools/hoist-skill/hoist.ts:193`
**Problem:** list/plan/emit modes interleaved in one 109-line function body with
four boolean flags. Quality/major + Readability/major.
**Fix:** Extract `hoistList`, `hoistPlan`, `hoistEmit`; `hoist()` becomes a thin dispatcher.

### 3H · run.ts: removedFilesHint is a standalone concern in main()
**File:** `tools/sync/run.ts:98`
**Problem:** 35-line function that reads disk, parses TSV, filters, and prints — a
distinct concern embedded alongside orchestration logic.
**Fix:** Move to `tools/sync/removed-files-hint.ts`; import and call from `run.ts`.

---

## Commit plan

```
fix(skills): correctness fixes — 1A through 1E
fix(skills): quality fixes — 2A through 2F
fix(scripts): check-resolvable existsSync guard order (3A)
fix(hooks): release lock in record_read (3B)
refactor(scripts): split check_file into focused functions (3C)
refactor(scripts): remove compileIgnore alias (3D)
refactor(tools): flatten safe-write nested conditionals (3E)
refactor(tools): extract parsePolicy helpers and section enum (3F)
refactor(tools): split hoist() into mode-specific functions (3G)
refactor(tools): extract removedFilesHint to own module (3H)
```
