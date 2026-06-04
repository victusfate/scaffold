## Overview

Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups.

**Args (pass after `/code-review`):**
- `--effort low|medium|high|max` — scope of findings (default: `medium`)
- `--comment` — post findings as inline PR review comments via GitHub MCP tools
- `--fix` — apply findings directly to the working tree

## Procedure

1. Run `git diff main...HEAD --name-only` to get changed files.
2. Run `git diff main...HEAD` to read the full diff.
3. For each changed file apply two passes:

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

4. Deduplicate and rank by confidence then severity.

5. **Output format:**
   ```
   file.ext:line — [type] description
   ```
   Group by file.

6. **Flags:**
   - Default (no flags): print findings and wait for the user to decide.
   - `--fix`: apply fixes to the working tree; re-run tests if a runner is detectable; summarize what changed.
   - `--comment`: post each finding as a line-level comment on the open PR.
   - Both flags together: fix first, then comment on what was changed.

## Effort levels

| Level | Coverage |
|---|---|
| `low` | Correctness only, high confidence |
| `medium` | Correctness + obvious quality issues, high confidence |
| `high` | Correctness + quality, includes lower-confidence findings (tagged `[uncertain]`) |
| `max` | All of `high`, plus speculative simplifications |

## Rules

- Do not read files outside the changed set.
- Do not spawn subagents.
- At `low`/`medium`: omit uncertain findings rather than flagging them.
- `--fix` applies only what was identified as a finding — no opportunistic extras.
