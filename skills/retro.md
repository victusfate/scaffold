## Purpose

Review a coding session for friction and propose improvements to the agent's
environment that make future work faster and more reliable.
Run only when the user requests `/retro` (Codex: `$retro`) or a session retrospective.
Default to the current session; accept a session log path or session identifier.

## Steps

1. Reconstruct the session from the conversation or the specified primary logs.
   Cite concrete turns, commands, failures, corrections, or repeated searches.
   If the requested record is unavailable, report the missing evidence and stop.
   Mark gaps in a partial record; infer no struggles from the code alone.
2. Read the relevant repository instructions, existing skills, check commands,
   hooks, and CI wiring. Trace each observed struggle to its environmental cause.
   Check whether the remedy already exists but was undiscovered, unwired, or broken.
3. Classify supported candidates using the table below. Prefer repairing an
   existing mechanism over adding another. Keep only findings tied to the session;
   an empty result is valid after a smooth run.
4. Rank candidates by impact and recurrence risk, accounting for implementation
   cost and the ongoing burden of a new rule or check. Present the report below.
   Finish with a recommended selection; wait for the user's choice before edits.

## Candidate categories

| Category | Session signal | Proposed remedy |
|---|---|---|
| Navigation | Repeated searches or a hidden dependency delayed progress | A pointer from an entry point the agent already reads |
| Automated checks | A mechanical error escaped, or a failure went undetected | Wire or repair the repo's lint, type, test, hook, or CI check; propose a new check only for a real gap |
| Review standards | Review missed a judgement call | Clarify the existing reviewer reference, or propose `CODING_STANDARDS.md` and its review entry point |
| Steering size | Relevant guidance was buried in repo or global instructions | Move mechanical rules into checks and judgement rules into review references |
| Tool economy | A call returned excessive output or required repeated work | Narrow the query, batch independent reads, or improve the existing tool |
| No-ops | Repetitive or ineffective steering consumed context | Remove or replace the instruction, preserving its useful constraint |
| Information access | Missing logs, documentation, or read access blocked progress | Propose the smallest access or observability improvement |

Treat missing guardrails as a candidate when inspecting the session's checks:
identify whether a pre-commit hook or CI actually runs the relevant lint, type,
and test commands. Cite that inspection alongside the session evidence.
Classify fixed syntax, banned APIs, import shapes, and file placement as mechanical;
use an executable check for them. Reserve reviewer prose for contextual judgement.

## Report

State the session reviewed, the evidence available, and any gaps. For each candidate:

| ID | Severity | Session evidence | Cause/category | Proposed change and destination | Cost/tradeoff | Verification |
|---|---|---|---|---|---|---|
| R-01 | high/medium/low | Turn, command, or log location | Observed environmental gap | Existing mechanism to repair or smallest addition | Effort and maintenance burden | How to prove it prevents the recurrence |

Explain the highest-value candidate briefly. Report no actionable findings when
the evidence supports none. Keep the retrospective read-only: selecting a remedy
is a separate implementation step; installs, hooks, access changes, and tasks need
that selection. Route selected work through the existing workflow:

- Use [`skillify`](skillify.md) to capture a reusable procedure.
- Use [`add-linter`](add-linter.md) for language linter setup.
- Use [`feature-chain`](feature-chain.md) for a substantial implementation.
- Use [`upstream`](upstream.md) when a generic remedy belongs in scaffold.
- Use [`improve`](../.claude/skills/improve/SKILL.md) for a codebase survey,
  or [`code-refiner`](code-refiner.md) / [`prune`](prune.md) for code-quality work.

When implementing a selected documentation remedy, use short imperative steps,
one home per rule, explicit completion criteria, and conditional pointers to detail.
Keep always-loaded guidance small and use the repository's authoring conventions.

Adapted from Matt Pocock ([MIT notice](../THIRD_PARTY_NOTICES.txt)).
