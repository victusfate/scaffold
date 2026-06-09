# Agent Guidelines

## Session Start

On your first response in a new session:

1. **Sync check** — A `SessionStart` hook fetches `origin/main` and warns if
   the current branch is behind. If you see that warning, rebase before
   starting new feature work (`git rebase origin/main`) or pull if on `main`
   (`git pull origin main`).
2. **PR watch** — If the current branch has an open PR, subscribe to it with
   `subscribe_pr_activity`. Only watch the PR for this session's branch — not
   PRs from other branches.
3. **Artifacts check** — Check `./docs/` for existing feature artifacts
   (`design.md`, `prd.md`, `plan.md`).

- **Artifacts exist:** acknowledge them and ask how to continue.
- **No artifacts:** start `/feature-chain` — no permission needed. If the user's
  intent is vague or unstated, the grill (Phase 1) resolves it through Q&A.
  Do not ask a pre-question first.

## Minimum Viable Diff

Prefer the smallest change that achieves the goal.

- Single, targeted edits. Don't rewrite when a few-line change works.
- Preserve existing structure, naming, and patterns unless a rewrite is asked for.
- No opportunistic refactors — surface them as separate suggestions.
- No style-preference rewrites. Working code stays as-is.
- When in doubt, ask before producing a diff larger than ~30 lines.

## The Chain

Run `/feature-chain` to execute all phases automatically. Or invoke individually:

1. **Design** — `/grill-with-docs`. Interview one question at a time until
   the design tree is resolved. Produces `design.md` with Q&A, decisions, and
   a **canonical vocabulary**. Run `/design-review` (auto-fix mode) before
   advancing — patches `design.md` directly. Auto-advances to PRD when complete.

2. **PRD** — `/to-prd`. Synthesize context and codebase into `prd.md` without
   re-interviewing. Auto-advances to TDD when complete.

3. **Plan** — break `prd.md` into **vertical slices** (each cuts through all
   layers: data → logic → UI → tests). Output `plan.md`. Confirm granularity
   once before coding.

4. **TDD** — `/tdd`. Execute `plan.md` one slice at a time: RED → GREEN →
   REFACTOR. When all slices pass, run `/code-quality-review` (auto-fix mode)
   — patches source files directly before advancing to the review summary.
   Maintain `tdd-log.md` with per-slice status.

**Stop** the chain at any point by saying "stop", "pause", or "just answer".

## Artifacts — One Folder Per Feature

State the slug before writing the first file so I can correct it.

```
./docs/<feature-slug>/
  ├── design.md      # Q&A, decisions, scenarios, canonical vocabulary
  ├── prd.md         # full PRD
  ├── plan.md        # vertical slices
  └── tdd-log.md     # per-slice TDD status
```

Feature-slug rule: kebab-case, drop articles, keep it under ~30 chars.

## Git Commits — One Per Step

Commit each artifact before moving on:

- `docs(<slug>): design Q&A and vocabulary`
- `docs(<slug>): PRD`
- `docs(<slug>): implementation plan`

For TDD, commit per phase per slice:

- `test(<slug>): slice N red — <behavior>`
- `feat(<slug>): slice N green — <behavior>`
- `refactor(<slug>): slice N — <what changed>` (only if refactor happened)

## Retry Semantics

Each step's input is the prior step's artifact:

- Bad TDD slice → revert those commits, re-run from `plan.md` slice N.
- Plan off → re-plan from `prd.md`.
- PRD missed something → extend `design.md`, then rewrite `prd.md`.
- Terms drift → update vocabulary in `design.md`, then propagate.

## What This Doesn't Apply To

Skip the chain for:

- Bug fixes under ~10 lines
- One-off scripts or throwaway prototypes
- Config edits, dependency bumps, lint fixes
- Doc-only changes
- Anything where I say "just write it", "no tests", or "quick fix"

## PR Workflow

1. Pull latest main: `git checkout main && git pull origin main`
2. Create a clean branch: `git checkout -b <prefix>/<short-descriptive-name>`
3. Do the work, verify with build/tests
4. Commit, push: `git push -u origin <branch>`
5. When changes are ready for review, run `/create-pr` — it creates the PR and subscribes to activity atomically. Do not split these steps.
6. On a `<github-webhook-activity>` merge event: run `git checkout main && git pull origin main` automatically, then confirm main is up to date.

Never commit directly to main for feature work.
A session spans the full lifetime of a branch — from creation until it is merged or discarded. Only switch branches after the current feature branch is merged or the user explicitly asks; keep committing to the current branch until then. The one permitted exception is checking out main solely to pull and immediately create a new feature branch.
A new session always starts from a fresh branch off main.

## File Delivery

When the user asks to copy, download, or share a file (any type), always use the SendUserFile tool to deliver it — never print the contents inline.
