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

**Test-quality self-audit (run at REFACTOR, before committing):**
- Do any assertions use the default value for the field they verify? Replace with a sentinel (non-default) value — a bug that silently resets to the default will hide behind matching data.
- For every new flag or optional argument: is each form covered? (absent / default / explicit value / combined with each flag it interacts with)
- Is there at least one test written from the *caller's* perspective — an end-to-end path against a real empty destination, not the implementer's internal view? If not, flag it for the integration test suite.

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

### Integration tests (optional, not always run)

Unit and acceptance tests (`tools/<tool>/test`, `scripts/*.test.*`) cover behavior through public interfaces and run on every commit. Integration tests cover end-to-end consumer flows and live in a separate file:

```
tools/<tool>/test-integration   # or scripts/<script>.integration.test.*
```

They are not required for every feature, but write one when:
- The feature crosses a system boundary (writes files a downstream consumer reads, curls a remote, spawns a subprocess)
- The acceptance test cannot simulate a realistic caller without becoming unwieldy
- A reviewer or post-merge bug revealed a gap in the acceptance suite

**Convention:**
- Gate on an env var so CI can run them selectively: `if (!process.env.RUN_INTEGRATION) { console.log('skip — set RUN_INTEGRATION=1'); process.exit(0); }`
- Use a real empty temp directory as the destination — not the scaffold root
- Simulate the caller's full workflow (hoist → read manifest → replay), not individual functions
- Keep them independent and repeatable (no shared state, no network unless the feature requires it)
- Report pass/fail in the same format as the acceptance test so output is uniform

Add a `test-integration` entry to `tool.yaml` when one exists. The pre-commit hook runs only `test`; integration tests run manually or in a dedicated CI job.

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
