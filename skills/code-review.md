## Overview

Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups.

**Args (pass after `/code-review`):**
- `--effort low|medium|high|max` — scope of findings (default: `medium`)
- `--comment` — post findings as inline PR review comments via GitHub MCP tools
- `--fix` — apply findings directly to the working tree

## Execution model

Run the review as a separate Agent with isolated context. The agent invoking this skill has already internalized the session's work and cannot review it objectively. A fresh subagent has no such priors.

**Phase 1 — gather (main agent):**
1. Run `git diff main...HEAD --name-only` to get changed files.
2. Run `git diff main...HEAD` to capture the full diff.
3. Spawn a reviewer Agent (via the Agent tool) with the diff text and all review criteria embedded verbatim in the prompt. Pass the effort level and flags so the reviewer knows the scope.

**Phase 2 — review (reviewer Agent, isolated context):**

For each changed file apply:

**Pass 1 — Correctness** (all effort levels):
- Logic errors, off-by-ones, wrong comparisons
- Missing null/boundary checks at external system boundaries
- Race conditions, resource leaks
- Incorrect types or API misuse

**Pass 2 — Quality** (medium and above):
- Duplicated logic that should be extracted
- Over-engineered solutions where a simpler approach works
- Inefficient constructs with obvious alternatives
- Altitude mismatches (domain logic in infrastructure layers, etc.)

**Pass 3 — Callable-unit checklist** (when the diff adds a tool, script, skill, or bin command):
Check each item in `docs/agent-authoring-requirements.md` §6. A missing descriptor, test, guard, or index entry is a finding even at `low` effort.

At `high`/`max`: expand to lower-confidence findings; tag these `[uncertain]`.

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
| `low` | Correctness only, high confidence |
| `medium` | Correctness + obvious quality issues, high confidence |
| `high` | Correctness + quality, includes lower-confidence findings (tagged `[uncertain]`) |
| `max` | All of `high`, plus speculative simplifications |

## Rules

- The reviewer Agent must not read files outside the changed set.
- At `low`/`medium`: omit uncertain findings rather than flagging them.
- `--fix` applies only what was identified as a finding — no opportunistic extras.
