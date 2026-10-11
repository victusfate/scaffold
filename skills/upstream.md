## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **Codex** (`$name` or `/skills`) and **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.

Move a change that belongs to every scaffold consumer (a rule, skill, script or tool)
**up** into the scaffold repo, then bring it back into the repo you started from:

1. Open a scaffold PR.
2. Merge it once real CI is green.
3. Sync scaffold back into this consumer.

This is the reverse direction of `/hoist-skill` (scaffold → consumer) and finishes
with `/sync-scaffold`.

Invocation: `/upstream <what to add or change>`. Example: `/upstream codify the daily owner status email`.

The user invoking `/upstream` authorizes merging the scaffold PR and the consumer sync
PR, once each one's checks pass for real. Stop at a ready PR instead when either
repo's policy needs a separate merge approval, or when the user says "PR only".

## Step 1 — split generic from project-specific

Decide what is universal and what belongs only to this project.

- **Universal** goes to scaffold, written harness-neutrally (Claude Code, Codex,
  pi, agy, Cursor). That means rules, skill steps and tooling.
- **Project-specific** stays in this consumer's own policy file (for example
  `.agent/<project>.md`, the handoff, or a `.scaffold-keep`-protected file). That
  means addresses, times, URLs, product names and surfaces.
- Never put a person's email address, credentials or project names into scaffold.
  Scaffold text refers to "the project's policy file" instead.

## Step 2 — work in a clean scaffold worktree

Find the local scaffold clone (commonly `~/code/scaffold`), or clone
`git@github.com:victusfate/scaffold.git`.

**Do not switch branches or edit files in its main checkout.** Another session may
own the branch it's on. Instead:

```bash
git -C <scaffold> fetch origin
git -C <scaffold> worktree add -b <type>/<slug> <tmp-dir>/scaffold-<slug> origin/main
ln -s <scaffold>/node_modules <tmp-dir>/scaffold-<slug>/node_modules   # if absent
```

## Step 3 — make the change the scaffold way

- **Rule or guidance:** edit `AGENTS.md`, or the relevant `skills/*.md`, in its
  existing style.
- **New skill `<name>`:** add each of these, mirroring an existing skill such as
  `deslop`:
  - `skills/<name>.md`, the canonical instructions;
  - `.claude/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`,
    `.agent/workflows/<name>.md` and `.cursor/rules/<name>.mdc`, the thin
    per-harness wrappers;
  - a row in `.claude/skills/RESOLVER.md` with the trigger regex, path and
    one-line description;
  - all five paths added to `.github/scaffold-files.txt`, the sync manifest;
  - a regenerated `docs/skills.md` (`node scripts/update-skills-doc.ts`);
  - `scripts/test-<name>-skill.sh`, an acceptance test using
    `scripts/lib/skill-test.sh`, wired into `package.json` `test`;
  - the README skill list, if the change is user-visible.
- **Script or tool:** add it with a test, and add it to the manifest if consumers
  should receive it.

## Step 4 — run scaffold's gates locally

```bash
npm test            # includes the RESOLVER and docs/skills.md freshness checks
npx eslint .        # 0 errors (existing warnings are not yours to fix here)
npm run typecheck   # when TypeScript changed
```

Fix every failure before pushing. Hosted CI confirms; it isn't the place to find failures.

## Step 5 — PR, real checks, merge

1. Commit with a conventional message. Push the branch, then open the PR with
   `/create-pr` (or `gh pr create`). The PR body says why the change is
   universal and which consumer it came from.
2. Watch the checks and read their actual conclusions:
   `gh pr checks <n> --watch; echo "EXIT=$?"`. A **skipped** required check is
   not a pass.
3. Merge when every required check passed and the merge is authorized (see
   Purpose). Delete the branch and remove the scaffold worktree.

## Step 6 — sync it back into this consumer

In the consumer repo, follow its own PR workflow:

1. Branch from updated main, or use the current task branch when the consumer's
   policy allows it.
2. Run `/sync-scaffold` (`bash bin/sync-from-scaffold.sh`).
3. Resolve conflicts:
   - Keep the consumer's local content in `.scaffold-keep` paths.
   - Where the consumer's version of a synced file diverged on purpose, merge
     the new scaffold text in rather than overwriting.
4. Add the project-specific half from Step 1 to the consumer's policy file.
5. Run the consumer's gates, open its PR, verify real checks, then merge (same
   authorization rule).

## Step 7 — report

Report, with links:
- the scaffold PR and its merge commit;
- the consumer sync PR, and the scaffold SHA it synced to;
- any conflicts and how you resolved each;
- anything left unmerged and why.

## Never

- Never push to scaffold `main` directly or force-push.
- Never merge on skipped, failing or unread checks.
- Never upstream secrets, personal data or one project's specifics.
- Never edit, stash or check out branches in a scaffold or consumer checkout another session is using. Use a worktree.
