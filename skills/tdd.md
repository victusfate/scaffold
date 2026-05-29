## Instructions

Execute `./docs/<feature-slug>/plan.md` using TDD — one vertical slice at a time.

If `plan.md` doesn't exist yet, create it first: break `prd.md` into vertical slices (each cuts through all layers: data → logic → UI → tests). Confirm granularity once with the user before coding.

### Philosophy

Tests verify **behavior through public interfaces**, not implementation details. A good test reads like a specification and survives internal refactors. A bad test breaks when you rename an internal function even though behavior hasn't changed.

### Anti-pattern: horizontal slicing

Never write all tests first, then all implementation.

```
WRONG: RED(1,2,3,4) → GREEN(1,2,3,4)
RIGHT: RED→GREEN, RED→GREEN, RED→GREEN ...
```

Tests written in bulk verify imagined behavior and become insensitive to real changes.

### Workflow per slice

**Before writing any code:**
- Confirm interface changes with the user
- Confirm which behaviors to test (prioritize critical paths)
- List behaviors to test — not implementation steps

**Tracer bullet:** Write ONE test for ONE behavior → RED → minimal code → GREEN. Proves the path works end-to-end.

**Incremental loop:**
```
RED:      Write next test → confirm it fails
GREEN:    Write minimal code to pass → confirm it passes
REFACTOR: Extract duplication, deepen modules — only after GREEN, never while RED
```
Rules: one test at a time, only enough code to pass, don't anticipate future tests.

**Per-cycle checklist:**
- Test describes behavior, not implementation
- Test uses public interface only
- Test would survive an internal refactor
- Code is minimal for this test
- No speculative features added

### Commits and log

After each slice:
```
test(<slug>): slice N red — <behavior>
feat(<slug>): slice N green — <behavior>
refactor(<slug>): slice N — <what changed>   # only if refactor happened
```

Append to `./docs/<feature-slug>/tdd-log.md`:
```markdown
## Slice N — <behavior>
- Status: done
- Notes: …
```

### When all slices pass

When the full test suite is green, run `/code-quality-review` in auto-fix mode — it will patch source files directly and resolve any blockers. Then present a summary and stop for review:

```
## Feature complete: <feature-slug>

### What was built
- <file or module>: <one-line description>

### Tests
- <N> tests passing across <M> slices
- Behaviors covered: <list>

### Deviations from plan
- <any divergence, or "none">
```

Prompt: **"All tests pass. Please review the generated source before merging."**

Wait for the user to confirm or request changes.
