## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **Codex** (`$name` or `/skills`) and **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.

Root-cause a bug, test failure, CI failure, or unexpected behavior before changing
code. Guess-and-patch loops cost more than the investigation they skip, and a
symptom fix leaves the cause in place to fail again somewhere else.

Adapted from [obra/superpowers](https://github.com/obra/superpowers) `systematic-debugging` and `verification-before-completion` (MIT).

## The rule

**No fix without a root cause.** Until Phase 1 is done you may add logging or
probes, but not change behavior. "Try X and see" is not a phase.

Use it every time, including when the bug looks simple, when there is time
pressure, and above all after one fix has already failed.

## Phase 1 — Reproduce and read

1. **Read the whole error.** Full stack trace, every warning above it, exit codes,
   file:line references. The answer is often printed there.
2. **Reproduce on demand.** Write down the exact command or steps. If it does not
   reproduce reliably, gather more data (run it N times, vary inputs, capture
   timing); do not guess.
3. **Check what changed.** `git log --oneline -15`, `git diff main...HEAD`, recent
   dependency or config changes, and environment differences (CI vs local, OS,
   runtime version).
4. **Instrument boundaries.** When data crosses components (CI → script → tool,
   route → service → DB), log what enters and leaves each boundary in one run.
   The run shows which boundary breaks; investigate only that one.
5. **Trace backwards.** From the bad value, ask what produced it, then what called
   that, until you reach the first place behavior diverges from intent. That is
   the root cause. Fix there, not where the symptom surfaced.

## Phase 2 — Compare against working code

- Find similar code in the same repo that works. List every difference between it
  and the broken path, including ones that "can't matter".
- When following a reference implementation or documented pattern, read all of it
  before applying it.
- Note what the broken path assumes: config, env vars, ordering, file layout.

## Phase 3 — Hypothesis

- State one hypothesis in writing: "X is the root cause because Y."
- Test it with the smallest possible change, **one variable at a time**.
- Confirmed → Phase 4. Refuted → new hypothesis from the evidence. Do not stack a
  second change on an unconfirmed first one.
- If you don't understand something, say so and research it. Don't pretend.

## Phase 4 — Fix

1. **Write the failing test first.** The smallest reproduction as an automated
   test in the repo's existing test style (via `/tdd` when inside a slice). Run it
   and see it fail for the reason you identified, not a bad fixture or import.
2. **One fix at the root cause.** No bundled refactors or "while I'm here" edits.
3. **Verify with fresh evidence.** Re-run the new test, the original failing
   command, and the surrounding suite. Read the output and exit code.
4. **If the fix did not work:** count the attempts. Fewer than three → back to
   Phase 1 with the new information. **After three failed fixes, stop.** Each
   fix exposing a new problem somewhere else is the signature of a wrong design,
   not a wrong patch. Report to the user what you tried, what each attempt
   showed, and the architecture question it raises (is this pattern sound? is
   shared state or coupling the real issue?) before attempting a fourth.

## Evidence before claims

Never say fixed, passing, or working without evidence produced in this turn:

| Claim | Requires | Not enough |
|---|---|---|
| Tests pass | Test command output, 0 failures, exit 0 | An earlier run, "should pass" |
| Bug fixed | The original reproduction now behaves correctly | Code changed |
| Regression test works | It failed before the fix and passes after | It passes once |
| CI fixed | The failing job re-run green on the new commit | Local tests green |
| Subagent fixed it | You read the diff and re-ran the check | The agent's report |

"Should", "probably", and "looks fixed" in a status line mean verification has
not happened yet.

## Not a root cause

- **"Flaky."** Timing-dependent failures have causes: shared state, ordering,
  missing awaits, real deadlines. Replace sleeps with condition-based waits; find
  the test that pollutes state by bisecting the test order.
- **"Environment."** Possible, but prove it: show the same commit passing in one
  environment and failing in another, and name the difference.

If the investigation truly ends at an external cause, record what you checked,
add handling (clear error, retry with a limit, timeout), and add logging that will
catch it next time.

## Report

```
Symptom:     <what failed, exact command>
Root cause:  <file:line — why it diverges from intent>
Evidence:    <the log/trace/diff that shows it>
Fix:         <one-line change summary>
Regression:  <test file — failed before, passes after>
Verified:    <commands re-run, results>
```

## Called from other skills

- `/create-pr` Step 2 uses Phases 1–3 for its "Diagnose" step when an integration
  test fails.
- `/tdd` uses it when a test fails for a reason the current slice did not predict
  (a RED that fails for the wrong reason, or a previously green test that breaks).
