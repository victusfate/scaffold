## Purpose

Validate that a change is **correct** — hunt for bugs. Default scope is the current
branch diff; `--full` scans the entire codebase to catch issues before CI.

Correctness only. Structural quality (reuse, simplification, abstraction,
readability scoring) belongs to `/simplify`; a full-repo quality survey belongs
to `/audit`. This skill defers all three to those skills rather than duplicating
them.

**Args (pass after `/validate`):**
- `--effort low|medium|high|max` — scope of findings (default: `medium`)
- `--full` — review all tracked source files instead of just the branch diff
- `--comment` — post findings as inline PR review comments via GitHub MCP tools
- `--fix` — apply findings directly to the working tree

## Execution model

// quality-override: No duplicate implementations — isolation rationale is intentionally repeated across skill files; skill composition system pending
Run the review as a separate Agent with isolated context. The agent invoking this skill has already internalized the session's work and cannot review it objectively. A fresh subagent has no such priors.

**Phase 1 — gather (main agent):**

Without `--full`:
1. Run `git diff main...HEAD --name-only` to get changed files.
2. Run `git diff main...HEAD` to capture the full diff.
3. Spawn a reviewer Agent with the diff text and all review criteria embedded verbatim in the prompt.

With `--full`:
1. Run `git ls-files` to get all tracked source files, excluding generated files, lock files, and fixtures (same exclusions as `/audit`).
2. Read each file in full.
3. Spawn a reviewer Agent with all file contents and all review criteria embedded verbatim in the prompt.

In both cases: pass the effort level, flags, and scope (`diff` or `full`) so the reviewer knows what it is looking at.

**Phase 2 — review (reviewer Agent, isolated context):**

For each file apply:

**Pass 1 — Correctness** (all effort levels):
- Logic errors, off-by-ones, wrong comparisons
- Missing null/boundary checks at external system boundaries
- Race conditions, resource leaks
- Incorrect types or API misuse

**Pass 2 — Test integrity** (diff scope only; skipped under `--full`, which has no diff):
A test weakened to make it pass is a **defect**, not a simplification — and the
one failure mode isolated review exists to catch. Flag any test in the diff that
was:
- stripped of assertions, or had them softened (e.g. an exact check turned into
  `assert True` / `expect(x).toBeDefined()`),
- made vacuous or narrowed so it no longer exercises the behavior it named,
- skipped, `xit`/`it.skip`-ed, or deleted while the code it covered remains.
Removing test behavior to reach green is a bug. If the covered behavior was
genuinely deleted, confirm the test's removal matches — otherwise flag it.

Also flag **tested-but-unreachable**: a new user-facing feature whose only proof
is an isolated unit test with no live caller. A passing unit test does not make a
feature reachable — grep for non-test callers of the new export (`grep -rn
<symbol> src/ | grep -v test`); zero callers means it is unwired, and "done"
claims on it are false. This is the correctness face of the rubric's Vestige R5.

**Pass 3 — Callable-unit checklist** (when the scope includes a tool, script, skill, or bin command):
Check each item in `docs/agent-authoring-requirements.md` §6. A missing descriptor, test, guard, or index entry is a finding even at `low` effort.

At `high`/`max`: expand to lower-confidence correctness findings; tag these `[uncertain]`.

Deduplicate and rank by confidence then severity. Return findings as plain text in the format below — the main agent acts on them.

**Output format (reviewer returns this):**
```
file.ext:line — [type] description
```
Group by file.

**Phase 3 — act (main agent):**
Receive the reviewer's findings, then:
- Default (no flags): present findings to the user and wait.
- `--fix`: apply fixes to the working tree; re-run tests if a runner is detectable; summarize what changed.
- `--comment`: post each finding as a line-level comment on the open PR via GitHub MCP tools.
- Both flags together: fix first, then comment on what was changed.

## Effort levels

| Level | Coverage |
|---|---|
| `low` | High-confidence correctness only |
| `medium` | Correctness + test integrity, high confidence |
| `high` | Correctness + test integrity, includes lower-confidence findings (tagged `[uncertain]`) |
| `max` | All of `high`, plus subtle correctness edge cases |

## Rules

- Without `--full`: the reviewer Agent must not read files outside the changed set.
- `--comment` is only valid without `--full` (there is no single PR to comment on when reviewing the whole codebase); warn and skip if both are passed.
- Test integrity (Pass 2) needs a diff — skip it under `--full`.
- At `low`/`medium`: omit uncertain findings rather than flagging them.
- `--fix` applies only what was identified as a finding — no opportunistic extras.
- Structural quality is out of scope — route it to `/simplify` (apply) or `/audit` (survey).
