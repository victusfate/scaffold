# Code Quality Rubric

## Reviewer Persona

You are a thoughtful senior engineer reading for pleasure. Your single question is:
*"Does this code ask anything unnecessary of me?"*

Correctness is assumed. You are looking for signal, not ceremony. You write and review from the same voice — the reviewer persona is the generative voice, not a separate judge. Code that would violate this rubric is never written in the first place.

**What 10/10 means:** a reader opens the file, reads top to bottom without backtracking, understands every decision, and feels nothing was wasted. No confusion, no ceremony, no line noise. Just as much code as the problem requires and not one character more.

---

## Scoring

Every score is derived from cited violations. The model must provide `filename:line` for every deduction. No citation → no deduction.

```
Score = 10 − Σ(violation weights)
```

| Severity | Weight | Meaning |
|----------|--------|---------|
| minor    | −1     | Reader notices it but is not slowed |
| major    | −2     | Reviewer would flag it; fixable in one PR |
| critical | −4     | Fundamental structure problem |

A score of 9 means exactly one minor violation, cited.

**Override (model-driven criteria only):** add `quality-override: <file> — <criterion> — <reason>` to the PR body to exempt a file from a specific non-numeric criterion. **File length** may be overridden inline with a cited reason (see the file-length pragma below) when a file is genuinely one cohesive unit that a split would only fragment; **commented-out code** cannot be overridden — the code must be fixed.

**Inline override (colocated):** place `// quality-override: <criterion> — <reason>` on the line immediately above the offending line. It suppresses that single deduction for `<criterion>` and appears in audit output as an accepted override at **zero** score weight. For a violation that scopes the whole file, place the pragma on the first non-blank, non-shebang line. `<reason>` is required and the em dash `—` is the separator. A malformed pragma (unknown criterion, blank reason, or missing separator) is itself a `[Clarity/minor]` violation, since a broken override is worse than none.

**Magic-number pragma:** the magic-number check (`check-quality-mechanical.sh`) is intentionally narrowed to catch hidden thresholds, not every bare digit. Most legitimate cases are already excluded automatically:
- *Test files* (`*.test.*`, `*.spec.*`, `test-*`) — assertion literals are specs, not thresholds.
- *`return`/`exit` values* — protocol-defined (HTTP status codes, shell exit codes).
- *Named constants* — `const NAME = N`, `UPPER_CASE = N`, etc.
- *String-literal contents* — numbers inside quoted strings are data.
- *`@generated` files* — a file with `@generated` in its first 5 lines is skipped whole (the same convention ESLint/Prettier honor). Use only for genuinely machine-produced/data files (geometry, fixtures, compiled tables) — never to silence a lint on hand-maintained logic.

When a bare literal survives those exclusions and is genuinely self-documenting (e.g. `86400` where the context makes "seconds in a day" obvious), place `# quality-ok: magic-number — <reason>` (or `//` for JS/TS) on the **immediately preceding line**. The `<reason>` is required.

**File-length pragma:** the ≤500-line limit is a smell, not a law — its remedy is to split at cohesive seams, never to strip comments or densify. But a file that is genuinely **one cohesive unit** (a model/schema/state-machine that reads top-to-bottom over a single type, where every candidate seam is shallow and a split would scatter one concept across files) may be blessed with `# quality-ok: file-length — <reason>` (or `//`) placed on the **first non-shebang line**. Like the magic-number pragma, the keyword is the gate and the `<reason>` is required (enforced at review). Prefer a real split whenever a clean seam exists; reach for the override only when keeping the file whole genuinely aids comprehension more than fragmenting it. **Commented-out-code** has no override — it must be fixed in the code.

---

## Score Report Format

After scoring, emit this table followed by all citations:

```
## Quality Scores
| File | Quality | Readability | Encapsulation | Clarity |
|------|---------|-------------|---------------|---------|
| path/to/file.js | 10 | 10 | 10 | 10 |

Violations: none
```

Or with violations:

```
Violations:
- path/to/file.js:47 [Readability/minor] bare number 86400 — extract to MAX_AGE_SECONDS
- path/to/util.js:12 [Quality/major] dead branch — condition can never be false given caller contract
```

---

## 1. Quality

A file scores 10 when:

- **Single responsibility** — the file does one thing. If you cannot describe it in one sentence without "and", it does too much. (major)
- **No god objects** — no class, hook, or component accumulates unrelated concerns. (major)
- **No workarounds in wrong place** — workarounds (stable refs, one-shot flags, manual cooldowns) live at the source of the problem, not patched at the call site. (major)
- **No dead logic** — no code that handles conditions that cannot occur, no feature flags for shipped features, no backwards-compat shims for callers that no longer exist. (major)
- **No duplicate implementations** — every piece of logic has exactly one home. Within a file: two or more functions sharing the majority of their body must extract the shared logic into a helper. Across files: before implementing, search the codebase for an existing canonical equivalent; if one exists, import it instead. Re-implementing something that already exists elsewhere is always a violation, even if the duplicate works correctly. (major)
- **No error handling theater** — only validates at real system boundaries (user input, external API responses). Trusts internal contracts. (minor)
- **Correct dependency declarations** — all `useEffect`/`useCallback`/`useMemo` deps are accurate; no suppression comments that paper over a stale-closure bug. *[framework-specific: skip for non-React code]* (major)

---

## 2. Readability

A file scores 10 when:

- **Fits in one mental model** — a reader holds the whole file after one pass. All file types: ≤500 lines. *[mechanical: check with `wc -l`]* (major) — **the remedy for a long or growing file is always to split it into cohesive modules, never to cram**: do not strip comments, densify code, or hold back edits to fit under the limit. Cramming to hit a line count trades readability for the metric and defeats this criterion's intent. When a file is genuinely one cohesive unit with no clean seam, an inline `quality-ok: file-length — <reason>` override (see the file-length pragma) is preferable to an arbitrary split — but a real seam always wins over the override.
- **Top-to-bottom narrative** — declarations, derived state, effects, return appear in that order with no backtracking. (minor)
- **No destructuring walls** — when a hook or function returns >8 names, callers group them or the hook is split. *[mechanical: count destructured names at call site]* (minor)
- **No surprise control flow** — early returns are fine; deeply nested conditionals in JSX or effects are not. (major)
- **No magic numbers or strings** — every threshold or key is a named constant at the top of the file or in a config module. *[mechanical: scan for bare literals]* (minor)
- **No ceremony** — no line exists only to satisfy a pattern. Every line earns its place. (minor)
- **Parameter discipline** — functions/methods/hooks with >4 parameters are a violation; group related args into a named options object. The caller should not need to remember argument order. *[mechanical: count parameters]* (minor)
- **Reader load** — understanding a single line should never require simultaneously holding >1 external concept in mind. Cite what the reader would need to look up. (major)
- **Consistent naming convention** — all identifiers follow the same pattern as the rest of the codebase. (minor)

---

## 3. Encapsulation

A file scores 10 when:

- **Minimal public surface** — exports only what callers need; internal helpers are not exported. (minor)
- **Opaque internals** — callers cannot reach inside and mutate state, ref contents, or implementation details. (major)
- **No prop drilling of internals** — if a caller must thread an internal implementation detail through multiple layers, the abstraction is wrong. (major)
- **Effects own their side effects** — an effect that belongs inside a hook is not hoisted to the component that calls it. (major)
- **Stable output identity** — functions and objects returned from hooks are stable across renders unless their inputs change. *[framework-specific: skip for non-React code]* (major)
- **No thin wrappers** — every abstraction layer earns its place. A function that only delegates without adding behaviour, safety, or clarity is deleted. (major)

---

## 4. Clarity

A file scores 10 when:

- **Self-documenting names** — identifiers say what they represent without a comment. No abbreviations unless universal in the domain. (minor)
- **Comments explain why, never what** — the only comments present capture a hidden constraint, a subtle invariant, or a workaround for a specific external bug. If removing the comment would not confuse a future reader, delete it. (minor)
- **No commented-out code** — dead code is deleted, not archived inline. *[mechanical: scan for commented code blocks]* (minor)
- **Canonical vocabulary** — terms match the domain model and are used consistently across all files. Two names for the same concept do not co-exist. (major)
- **Obvious data flow** — the reader can trace data from source to consumer without jumping between files for the happy path. (major)

---

## 5. System Quality

Score the **system** as well as its files. A collection of clear files can still
hide an unclear dependency graph. Report five independent scores using the same
`10 − Σ(violation weights)` formula and minor (−1), major (−2), critical (−4)
weights above. Cite `filename:line` for every deduction, including both ends of a
cross-module edge. Do not average away a boundary violation with clean files.

Prioritize understanding/modification, then data/compatibility, then architectural
boundaries. The latter support safe change; layering alone earns no points.

| Criterion | A score of 10 means | Deduction examples |
|---|---|---|
| Understanding and modification | A maintainer can explain behavior, reproduce a failure, identify the code to change, and verify a modification or replacement through executable evidence. | major: modification depends on a generating prompt rather than discoverable code/contracts; critical: claimed behavior cannot be reproduced or safely changed. |
| Preservation and compatibility | Versioned schemas, migrations, behavioral contracts and old-data fixtures make preservation obligations executable. | major: a persisted format changes without a compatibility probe; critical: replacement destroys saved data or silently breaks a promised interface. |
| Module boundaries and dependency direction | Dependencies and state ownership allow independent modification; declared import rules protect concrete contracts; cycles do not cross ownership boundaries. | major: domain code depends on a replaceable UI mechanism; critical: a dependency cycle makes independent replacement impossible. |
| Data-flow clarity | Every piece of state has one owner; mutations cross explicit interfaces; serialization preserves that ownership. | minor: a documented transfer lacks a source link; major: two modules mutate shared state without an owner; critical: hidden mutation bypasses persistence or security invariants. |
| Entry-point traceability | A reader can follow user action → handler → core → persistence and back through concrete callers. | minor: one hop requires an unnecessary lookup; major: an event bus hides producer/consumer identity; critical: the advertised path has no reachable implementation. |

```markdown
## System Quality Scores
| System scope | Modification | Preservation | Boundaries | Data flow | Entry points |
|---|---|---|---|---|---|
| checkout → order → storage | 10 | 10 | 10 | 8 | 10 |

Violations:
- src/cart.ts:42 and src/orders.ts:18 [Data flow/major] both mutate order totals;
  give the order core ownership and pass cart changes through its command interface.
```

Use the repository's declared import rules and gate as boundary evidence. Use a source
index for static callers and recorded integration/piece runs for observed paths
(see `skills/mind-meld.md`). Label static and observed evidence separately; a
missing trace is not proof that a branch cannot run. Review an entry point's error
and save/load paths as well as its happy path.

Common system failures: globally writable state with several owners; a domain
module importing UI experiments; plugin callbacks with no discoverable registration;
and persistence spread across handlers. Fix ownership or dependency direction at
its source rather than adding narration over the ambiguity.

Current facts have one executable home: types/interfaces own state contracts;
behavioral examples and assertions own invariants; schemas, migrations and
compatibility fixtures own preservation. Queue/design records link to these
sources. Generate maps and traces rather than hand-maintaining a second system
description. Comments explain hidden constraints and rationale. Mark snapshots
stale when their source hashes no longer match; a fast lookup of stale context
still gives a wrong answer.

## 6. Design Validity

Review whether the change solves the right problem before rewarding its file
scores. Apply the same cited minor (−1), major (−2), critical (−4) deductions to
each criterion below. Cite artifact lines for intent and assumptions, code or
trace lines for behavior, and the relevant comparison when evidence contradicts
the design. Tests passing is implementation evidence, not proof of customer value.

| Criterion | A score of 10 means | Deduction examples |
|---|---|---|
| Intent and outcome validity | The owner problem, desired observable outcome, constraints, and success evidence are explicit; unknown outcome evidence stays unknown. | major: merge count substitutes for usefulness; critical: the implementation contradicts the owner's actual need despite green tests. |
| Assumption testing and learning | Consequential assumptions have a disconfirming probe and an observed result or an explicit unknown; contradictory evidence revises the design and plan. | minor: a low-risk assumption has no probe; major: a hard-to-reverse decision rests on an untested premise presented as fact; critical: a failed premise is ignored to keep the pipeline moving. |
| Architectural understanding | A reviewer can explain state ownership, dependency direction, constraints, and failure consequences; alternatives are explored in proportion to uncertainty and reversibility. | major: an agent's plausible boundary is accepted without checking real callers; major: a hard-to-reverse design has no comparison or rationale. A routine formatter change needs no speculative alternatives. |
| Diagnosability and repairability | A maintainer can reproduce a failure, follow its source/state path, and verify a repair without relying on the generating prompt. | minor: reproduction omits a required input; major: only a polished narration exists, without source or execution evidence; critical: persisted failures cannot be diagnosed or safely recovered. |

Report `Intent`, `Learning`, `Understanding`, and `Repairability` beside system
scores. Missing production outcome data is an explicit unknown, not a fabricated
success or an automatic demand for production access. Judge whether the proposed
check is appropriate for the stage and failure consequences; inspect the real result when available.

For example, an implementation can score 10 in every file dimension and still
lose four Intent points at `docs/search/design.md:14` and `src/search.ts:81` if it
optimizes automatic query submission when the owner needed an editable preview.
An observed Mind Meld tour can explain the mismatch and reproduce the failure;
its existence alone does not establish that the new behavior helps users.

This framing follows Rob West's
[design-engineering argument](https://robwest.info/articles/the-agentic-software-factory-is-the-wrong-metaphor)
(19 September 2026). Agents can investigate, challenge, implement, and compare
candidate designs. Owner intent, domain tradeoffs, and release authority stay
explicit. Architectural contribution can be builder-led, collaborative or model-led;
owners may delegate technical design while focusing on UX/product. Score design
evidence and outcomes regardless of who supplied the architecture. The dial never
relaxes preservation or verification. Repeatable delivery automation remains valuable; it is one part of the
design feedback loop. The owner-supplied Joe Maddalone video summary motivates
the maintainability/understanding concern; no transcript was independently verified.

## Common Failure Patterns

| Pattern | Dimension | Severity | Fix |
|---------|-----------|----------|-----|
| God component / hook | Quality, Encapsulation | major | Extract sub-hooks or sub-components at natural seams |
| Workaround ref in caller | Quality, Encapsulation | major | Fix instability at source |
| >8-name destructure at call site | Readability | minor | Split hook or namespace returns |
| Effect with suppressed deps | Quality | major | Fix stale closure; use a ref if genuinely stable |
| Magic number inline | Readability, Clarity | minor | Named constant at top of file |
| Comment restating code | Clarity | minor | Delete the comment |
| Exported internal helper | Encapsulation | minor | Move to module scope, unexported |
| Two names for same concept | Clarity | major | Pick one; update all call sites |
| >4 parameters | Readability | minor | Group into named options object |
| Thin wrapper / identity layer | Encapsulation | major | Delete; inline or remove the layer |
| Ceremony / boilerplate | Readability | minor | Every line earns its place or is deleted |
| Reader must hold >1 concept | Readability | major | Extract named intermediate or simplify |
| Duplicate implementation (within file) | Quality | major | Extract shared logic into a helper |
| Duplicate implementation (cross-file) | Quality | major | Import from canonical source; delete local copy |
| Soft-deleted / neutered path (never executes) | Quality | major | Delete it — don't flag it off (R1) |
| Domain module imports a mode/feature module | Encapsulation | major | Invert: mode → domain, never the reverse (R2) |
| Discriminator field carrying two concepts | Quality, Clarity | major | Split into separate fields (R3) |
| Same symbol exported by two modules | Quality | major | Finish the migration — delete/quarantine the old (R4) |
| "Live" function with only test callers | Quality | major | It's dead — remove or rewire to a live entry point (R5) |

---

## Vestige & Layering

Subsystems get replaced incrementally, and the failure mode is that the **old
system is neutered instead of removed** — it stays load-bearing through shared
modules and becomes invisible ("looks live, isn't"). These rules keep
replacements clean; apply them with extra weight on any PR touching a
replaced or legacy subsystem.

- **R1 — No soft-deletes. Delete disabled paths; don't neuter them.** *(Quality, major)*
  A code path that can never execute must be removed, not flagged off. Flag
  identity/all-ones lookup tables (e.g. `ARMOR = {a:1, b:1, …}`), constant-false
  guards, feature flags with no true-path, and — statically — union/enum members
  with **no producer** (compared against but never assigned) or **no consumer**
  (assigned but never read). A neutered branch keeps compiling and keeps its
  imports alive; that is how vestige anchors itself into live code.
- **R2 — Dependency direction: mode → domain, never domain → mode.** *(Encapsulation, major — highest leverage)*
  Separate what a thing **is** (domain: geometry, identity, catalog data) from how
  it **behaves under a mode/feature** (rules: combat, mounts, scoring). Feature/mode
  modules import domain modules, never the reverse. Flag a core/domain module
  importing a mode/feature/legacy module, and import cycles across the layer
  boundary. When mode data lives inside shared domain modules, changing modes
  can't remove it — the root cause of entanglement.
- **R3 — One field, one concept.** *(Quality/Clarity, major)*
  A discriminator field must carry a single semantic axis. Flag an enum/union whose
  values fall into unrelated groups (e.g. `arc: fore | broadside` [geometry] mixed
  with `point-defense | support` [role]). Overloaded fields can't be partially
  retired — split them so each concept lives and dies independently.
- **R4 — One system, one name. Replace, don't co-locate.** *(Quality, major)*
  Flag the same symbol name exported by two modules (a tell of a parallel/duplicate
  system). A migration is "done" only when the replaced system is **deleted** or
  quarantined behind an explicit boundary — never left co-resident sharing types
  with its successor. Every "add the new path" change must schedule "remove the old."
- **R5 — Liveness is the call graph, not tests or comments.** *(Quality, major)*
  Flag production functions whose only references are tests (green tests make dead
  code look load-bearing — pin them to a live entry point instead), and comments
  asserting current behavior for code with no live caller (a stale claim, not
  documentation). Verify "is this used?" against producers/consumers in the graph,
  never against prose.

**Reviewer prompt** — on any PR touching a replaced/legacy subsystem, ask:

- Does anything here only exist to keep an old path compiling? Delete it.
- Does a domain module import a mode/feature module? Invert or move it.
- Is any field carrying two unrelated meanings? Split it.
- Is the replaced system fully gone, or still co-resident? Finish the removal.
- Does any "live" function have only test callers? It's dead — remove or rewire.
