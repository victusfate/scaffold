## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **Codex** (`$name` or `/skills`) and **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.

Run the real app, drive the changed entry points the way a user would, then fix
what breaks: **test → triage → fix with a regression test → re-verify**. This is
the executable check behind AGENTS.md *Veracity*: a feature is done when a user
entry point reaches it, and `/qa` proves that by going through the entry point.
Unit tests and reviewers cannot.

Adapted from [garrytan/gstack](https://github.com/garrytan/gstack) `qa` (MIT).
gstack's browse daemon, learnings store, and telemetry are not used; `/qa` drives
the target with the tooling the repo already has.

## Arguments

| Argument | Default | Example |
|---|---|---|
| Target | inferred from the diff and repo (dev-server URL, route, CLI command) | `/qa http://localhost:5173/settings` |
| Tier | `standard` | `--quick`, `--exhaustive` |
| Mode | fix | `--report-only` (find and report, no edits) |
| Focus | changed behavior (diff-aware) | `/qa focus on the import flow` |

**Fix tiers:** quick = critical + high; standard = + medium; exhaustive = + low and
cosmetic. Issues outside the tier are reported as deferred.

## When to skip

Skip `/qa`, and say why in one line, when the change has no runtime entry point:
docs-only, config-only, type-only, or internal refactors with no behavior change.
Library code with no app of its own is covered by its tests; skip unless the repo
has an example app or a CLI that exercises it.

## Setup

1. **Clean tree.** Run `git status --porcelain`. If dirty, stop and ask the user to
   commit or stash first. Each QA fix must be its own commit.
2. **Pick the surfaces** from the diff (`git diff main...HEAD --stat`) and the
   feature's entry points:
   - **browser** — pages and components behind a route
   - **API** — HTTP endpoints, webhooks
   - **CLI** — commands, flags, exit codes
   - **job** — workers, queues, scheduled tasks
   Default is diff-aware: changed behavior plus one adjacent happy path per surface.
3. **Start the app** the way the repo documents it (README, `package.json`
   scripts, `Makefile`, `/run` skill if present). Run it in the background, wait
   for readiness by polling (HTTP 200, a log line), never a fixed sleep. Record
   the start command in the report.
4. **Tooling.** Use what the repo already has: its Playwright/Cypress/e2e runner,
   `curl` or its HTTP test client, the CLI binary. Do not add a dependency for QA.
   If a browser surface is required and the repo has no browser tooling, use a
   locally available Playwright via a throwaway script outside the repo; if
   none is available, mark the browser probes **blocked**.
5. **Identity.** Use seeded or synthetic test accounts and data. Never ask the user
   for real credentials in chat, never point probes at production, and never send
   real emails, payments, or webhooks to third parties.

Evidence (screenshots, response dumps, logs) goes in a scratch directory outside
the repo, or a gitignored one. Never commit it.

## Probe

For each surface, write down the steps, run them, and capture evidence:

- **browser** — load the page, perform the user action, then take a screenshot of
  the result. Record every console error and failed network request (4xx/5xx),
  and check the obvious states: empty, loading, error, long content, narrow
  viewport. Read the screenshot. "It rendered" is not a pass when the content is
  wrong.
- **API** — happy path, invalid input, missing auth, and idempotency for writes.
  Assert status code, response shape, and the persisted state (read it back).
- **CLI** — happy path, bad flags, missing input, `--help`. Assert exit code,
  stdout/stderr, and files written.
- **job** — enqueue, let it run, assert the final state and that a retry does not
  duplicate side effects.

Each issue gets: ID (`QA-001`…), severity (critical / high / medium / low), surface,
exact repro steps, expected vs actual, and evidence path.

A surface you could not reach (app won't start, auth wall, missing service) is
**blocked**, with the reason. Blocked is never reported as passed.

## Triage

Sort issues by severity and apply the fix tier. Mark as deferred anything below the
tier, anything in third-party code, and anything that needs infrastructure changes.
In `--report-only` mode, stop here and write the report.

## Fix loop

For each in-tier issue, highest severity first:

1. **Diagnose** with `/investigate` (Phases 1–3). No edit before a root cause.
2. **Regression test first.** Reproduce the issue in the repo's own test style
   (extend an existing test or fixture when one covers the boundary). Run it and
   see it fail for the identified reason. Do not add a production seam that only
   the test needs. A CSS-only defect may use a before/after screenshot instead.
3. **Minimal fix** in the responsible files only. No unrelated refactors.
4. **Re-verify:** re-run the regression test, the original probe, and the adjacent
   happy path. Read the output and screenshots.
5. **Commit** the verified fix with its test, staging explicit paths:
   `fix(qa): QA-NNN — <short description>`.
6. **Classify:** verified / best-effort (fix applied, could not fully re-verify, say
   why) / reverted (the fix broke something: revert only this commit, keep the
   test and evidence, mark deferred).

**Self-regulation:** after every five fixes, and after any revert, check whether
the loop is helping. Stop and report to the user after two reverts, after any
edit to a file unrelated to the issue, or when fixes keep spreading across many
files. Hard cap: 30 fixes per run.

## Final pass

Re-run every probe that touched a fixed area, plus the happy path on each surface.
If anything regressed, say so first in the report.

## Report

When run inside `/feature-chain`, write `docs/<feature-slug>/qa-report.md`;
standalone, print the report in chat (write a file only if asked).

```
## QA: <target>  (<tier>, <date>)
Surfaces: browser ✓  API ✓  CLI —  job blocked (<reason>)
Start command: <cmd>

| ID | Sev | Surface | Issue | Status | Commit |
|----|-----|---------|-------|--------|--------|
| QA-001 | high | browser | Save button stays disabled after edit | verified | abc1234 |

Deferred: <ID — reason>
Blocked:  <surface — reason>
```

End with one line for the PR body:
**"QA found N issues, fixed M (verified V), deferred D, blocked B."**

## Called from other skills

- `/feature-chain` Phase 3 runs `/qa` after `/code-refiner` when the feature has a
  user-facing entry point, and reports the summary line in Phase 4.
