## Purpose

Turn a completed piece of work into a durable skill: a file other agents
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

Write five files per skill (the validator requires every form):

1. **`skills/<slug>.md`** — canonical instructions, no frontmatter. This is the
   single source of truth; all harnesses read from here via `@` includes.

2. **`.claude/skills/<slug>/SKILL.md`** — thin Claude wrapper:
   ```markdown
   ---
   description: <trigger-rich description>
   ---

   @../../../skills/<slug>.md
   ```

3. **`.cursor/rules/<slug>.mdc`** — thin Cursor wrapper:
   ```markdown
   ---
   description: <same description>
   alwaysApply: false
   ---

   @../../skills/<slug>.md
   ```

4. **`.agents/skills/<slug>/SKILL.md`** — Antigravity skill (literal Markdown,
   no include resolution — link + read instruction):
   ```markdown
   ---
   name: <slug>
   description: |
     <same description>
   license: MIT
   metadata:
     author: victusfate
     version: "1.0"
   ---

   Read and follow the complete skill instructions in [`skills/<slug>.md`](../../../skills/<slug>.md).
   ```

5. **`.agent/workflows/<slug>.md`** — Antigravity workflow:
   ```markdown
   ---
   description: <same description>
   ---

   Read and follow the complete skill instructions in [`skills/<slug>.md`](../../skills/<slug>.md).
   ```

Codex and Gemini read through `AGENTS.md` — no separate file needed.

Keep `description:` trigger-rich (it's how non-Claude harnesses decide to activate
the skill) and **identical across all four wrapper forms** — the validator's
parity phase rejects drift. Factor shared routines into `lib/` rather than
repeating them.

### Phase 3 — Review, Save, and PR to scaffold

1. **Register** — add a row to `.claude/skills/RESOLVER.md` (unique `^\/<slug>`
   anchor, path pointing to `skills/<slug>.md`) and append all five new file
   paths to `.github/scaffold-files.txt`.
2. **Tests** — the skill must survive `node scripts/check-resolvable.mjs`. Add a
   focused test for any logic the skill ships in a script.
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
