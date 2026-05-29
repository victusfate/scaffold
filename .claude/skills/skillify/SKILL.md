---
name: skillify
description: Capture a completed session as a reusable, registered skill. Run when the user wants to turn the current session into a skill, extract a repeatable workflow, or create a new skill from work just finished. Reconstructs context, interviews briefly, generates a SKILL.md + tests, registers it in RESOLVER.md, and opens a PR to scaffold.
---

## Purpose

Turn a completed piece of work into a durable skill: a `SKILL.md` other agents
(Claude, Codex, Gemini, Cursor) can invoke, registered in the routing table and
propagated upstream to `scaffold` so every downstream repo inherits it.

## Hard rules

- **One skill per run.** If the session covered several reusable workflows, pick
  the most valuable and say so — don't bundle.
- **Slug is canonical.** kebab-case, drop articles, ≤30 chars. State it before
  writing the first file so the user can correct it. The slug is the directory
  name AND the RESOLVER `Skill` cell AND the `^\/<slug>` regex anchor.
- **Register or it doesn't exist.** A skill not in `.claude/skills/RESOLVER.md`
  and `.github/scaffold-files.txt` is orphaned. Both edits are mandatory.
- **Stay MECE.** Before generating, scan RESOLVER for a skill with overlapping
  purpose. If one exists, extend it with a parameterized arg instead of adding a
  near-duplicate.
- **Validate before save is final.** Run `node scripts/check-resolvable.mjs` and
  resolve every error before opening the PR.

## Pipeline

### Phase 0 — Context Reconstruction

Rebuild what actually happened without asking the user to re-explain:

- Recent conversation history — what was the user trying to achieve, what worked.
- Project manifests — `package.json`, `Cargo.toml`, `pyproject.toml`, etc. — for
  language, scripts, and test runner.
- `git diff --stat` (and `git log --oneline -20`) — which files changed and the
  shape of the work.

Produce a one-paragraph reconstruction and confirm it in a single line before
interviewing.

### Phase 1 — Structured Interview (4 rounds, one question at a time)

Swift loop — recommend an answer with each question so the user can just confirm:

1. **Intent** — what should invoking this skill accomplish? (becomes `description`)
2. **Inputs** — what does it need to start? (args, files, preconditions)
3. **Steps** — what is the canonical pipeline? (the happy path, in order)
4. **Edge cases** — what must it refuse, guard, or handle specially?

Stop early if all four are already unambiguous from Phase 0.

### Phase 2 — Generation

Write `.claude/skills/<slug>/SKILL.md`:

- **Frontmatter** — `name` (slug) and a trigger-rich `description` derived from
  intent. The description is how non-Claude harnesses decide to activate it.
- **Hard rules** — the refusals and guardrails from round 4, as imperatives.
- **Pipeline** — the round-3 steps as a clean, numbered sequence. Each step is
  an action, not a paragraph. Factor shared routines into `lib/` rather than
  repeating them (the validator's DRY phase enforces this).

Mirror it as `.cursor/rules/<slug>.mdc` (frontmatter `description` +
`alwaysApply: false`) so Cursor activates on the same intent. Codex and Gemini
read it through `AGENTS.md` — no separate file needed.

### Phase 3 — Review, Save, and PR to scaffold

1. **Register** — add a row to `.claude/skills/RESOLVER.md` (unique `^\/<slug>`
   anchor) and append the new paths to `.github/scaffold-files.txt`.
2. **Tests** — write `scripts/check-resolvable.mjs`-passing structure, then add a
   focused test for the skill's own logic if it ships a script. At minimum the
   skill must survive the validator.
3. **Validate** — `node scripts/check-resolvable.mjs`. Fix every error.
4. **PR to scaffold** — new skills belong upstream so all repos inherit them:
   ```
   git fetch scaffold main
   git checkout -b skillify/<slug> scaffold/main
   # copy the new/changed scaffold-managed files onto this branch
   git push -u scaffold skillify/<slug>
   ```
   Then open a PR against `victusfate/scaffold` titled `feat(skill): <slug>`,
   body summarizing intent and pipeline. Do not merge — leave it for review.
   (If the `scaffold` remote isn't configured, run `bin/sync-from-scaffold.sh`
   once first; it adds the remote.)
5. **Summarize** — slug, what it does, files written, validator result, PR link.
   Stop for the user to review.
