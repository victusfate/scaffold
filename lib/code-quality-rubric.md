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

**Override (model-driven criteria only):** add `quality-override: <file> — <criterion> — <reason>` to the PR body to exempt a file from a specific non-numeric criterion. Most mechanical criteria (file length, commented-out code) cannot be overridden — the code must be fixed.

**Inline override (colocated):** place `// quality-override: <criterion> — <reason>` on the line immediately above the offending line. It suppresses that single deduction for `<criterion>` and appears in audit output as an accepted override at **zero** score weight. For a violation that scopes the whole file, place the pragma on the first non-blank, non-shebang line. `<reason>` is required and the em dash `—` is the separator. A malformed pragma (unknown criterion, blank reason, or missing separator) is itself a `[Clarity/minor]` violation, since a broken override is worse than none.

**Magic-number pragma:** the magic-number check (`check-quality-mechanical.sh`) is intentionally narrowed to catch hidden thresholds, not every bare digit. Most legitimate cases are already excluded automatically:
- *Test files* (`*.test.*`, `*.spec.*`, `test-*`) — assertion literals are specs, not thresholds.
- *`return`/`exit` values* — protocol-defined (HTTP status codes, shell exit codes).
- *Named constants* — `const NAME = N`, `UPPER_CASE = N`, etc.
- *String-literal contents* — numbers inside quoted strings are data.

When a bare literal survives those exclusions and is genuinely self-documenting (e.g. `86400` where the context makes "seconds in a day" obvious), place `# quality-ok: magic-number — <reason>` (or `//` for JS/TS) on the **immediately preceding line**. The `<reason>` is required. File-length and commented-out-code cannot be overridden inline or via PR body — those violations must be fixed in the code.

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

- **Fits in one mental model** — a reader holds the whole file after one pass. All file types: ≤500 lines. *[mechanical: check with `wc -l`]* (major)
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
