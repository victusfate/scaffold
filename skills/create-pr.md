## Instructions

Create a pull request for the current branch and immediately subscribe to its activity. These two steps are atomic — never create without subscribing.

### Step 1 — verify state

```bash
git status --short
git log --oneline main..HEAD
git diff main...HEAD --stat
```

If the branch has uncommitted changes, stop and tell the user to commit or stash first.

If the branch has no commits ahead of main, stop — there is nothing to PR.

### Step 2 — run integration tests (with auto-correction)

Find all `test-integration` files — both touched by this branch and repo-wide:

```bash
git diff main...HEAD --name-only | grep -E '(^|/)test-integration$'
find tools scripts -name test-integration 2>/dev/null
```

If no `test-integration` files exist anywhere, skip this step silently.

For each file found, run it:

```bash
RUN_INTEGRATION=1 node <path/to/test-integration>
```

**If all pass:** continue to Step 3.

**If any fail — attempt auto-correction (up to 2 rounds):**

Each round:

1. **Diagnose** — read the failing assertions carefully. Read the source file(s) they exercise. Identify the root cause (wrong value written, missing branch, incorrect path, etc.).

2. **Scope check** — if the fix requires more than ~30 lines of change across all files, or touches something architecturally significant, stop and report the diagnosis to the user instead of attempting a fix. Do not guess at large changes.

3. **Fix** — apply the targeted change to source. Do not modify the integration test itself unless the test has a genuine bug (wrong expectation, not a real behavior).

4. **Verify no regression** — run the unit acceptance test (`node <tool>/test`) for the same tool. If it fails, revert the fix and stop.

5. **Re-run integration tests** — if they all pass, commit the fix:
   ```
   fix(<scope>): auto-correct before PR — <one-line description of what was wrong>
   ```
   Then continue to Step 3.

6. **If still failing after 2 rounds** — stop. Report:
   - Which assertions failed and their actual vs expected values
   - What was tried in each round
   - The current state of the source
   Do not create the PR.

**Never silently skip a failing integration test.** Either fix it or surface it.

Track auto-fixes applied (scope + one-liner) to include in the PR body.

### Step 3 — bump version on the branch

If the repo has no `package.json`, skip this step silently.

Bump the release version here, on the branch, so the bump commit is pushed under
your credentials and `verify` runs on it — letting the PR merge cleanly. No CI
job and no extra token are involved. Tagging stays on merge to main (e.g. in
`release.yml`); this step only edits `package.json`.

1. **Skip if already bumped.** If any commit the branch adds already bumps the
   version, do nothing more in this step:
   ```bash
   git fetch origin main -q
   git log origin/main..HEAD --format=%s | grep -q '^chore(release):' && echo "already bumped"
   ```
   If that prints `already bumped`, continue to Step 4.

2. **Read the base version from `origin/main`** — not the branch — so a branch
   cut from an older main still bumps relative to the current release:
   ```bash
   CURRENT=$(git show origin/main:package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")
   ```

3. **Compute the next version** from the conventional commits the branch adds.
   Prefer `compute-bump.ts`; fall back to `compute-bump.mjs` (mid-migration
   consumers may have the `.mjs` but not yet the `.ts` replacement); fall back
   to by-hand if neither is present:
   ```bash
   BUMP_SCRIPT=""
   [ -f scripts/compute-bump.ts  ] && BUMP_SCRIPT="scripts/compute-bump.ts"
   [ -z "$BUMP_SCRIPT" ] && [ -f scripts/compute-bump.mjs ] && BUMP_SCRIPT="scripts/compute-bump.mjs"
   if [ -n "$BUMP_SCRIPT" ]; then
     NEXT=$(git log --pretty=%s%n%b origin/main..HEAD | node "$BUMP_SCRIPT" "$CURRENT")
   else
     # apply the rule by hand across all branch commit messages:
     # BREAKING CHANGE or !: → major, feat: → minor, fix: → patch, else → none
   fi
   ```
   If the result is `none`, continue to Step 4 without bumping.

4. **Apply and commit** the bump — no tag. `npm version` with an explicit
   version sets `package.json` absolutely (correct even if the branch's version
   already drifted):
   ```bash
   npm version "$NEXT" --no-git-tag-version
   git add package.json package-lock.json 2>/dev/null
   git commit -m "chore(release): bump version to $NEXT"
   ```
   Stage only those files explicitly — never `git add -A`.

### Step 4 — push if needed

```bash
git push -u origin $(git branch --show-current)
```

If the push fails, report the error and stop.

### Step 5 — quality gate

Run `/simplify` in review mode (standalone invocation) against the changed files. This produces the Quality Scores table.

**All files must score 10/10 on all four dimensions before continuing.** Any score below 10 blocks PR creation — surface the violations and wait for the user to fix them or add `quality-override` annotations.

Override syntax (model-driven criteria only — mechanical violations must be fixed):
```
quality-override: <file> — <criterion> — <reason>
```

Once all scores are 10/10 (or approved overrides cover every remaining violation), save the Quality Scores table — it will be included in the PR body in Step 6.

### Step 6 — draft title and body

Read all commits ahead of main (`git log main..HEAD`) and the diff stat. Draft:

- **Title** — one line, under 70 characters, imperative mood, describes the change (not the process). Use conventional-commit prefix if the repo uses them.
- **Body** — use this template exactly:

```
## Summary
- <bullet 1>
- <bullet 2>
- <bullet 3 if needed>

## Quality Scores
| File | Quality | Readability | Encapsulation | Clarity |
|------|---------|-------------|---------------|---------|
| <paste score table from Step 5> |

## Test plan
- [ ] <concrete thing to verify>
- [ ] <another thing>

<session URL from conversation context>
```

Keep bullets factual: what changed and why, not how you built it.

If auto-corrections were applied in Step 2, append this section:

```
## Auto-corrections applied
- <scope>: <what was wrong and what was fixed>
```

**Callable-unit gate:** if the diff adds a tool, script, skill, or bin command, append this section to the body. An unchecked box blocks merge.

```
## Callable-unit checklist
- [ ] Lives in the correct home (docs/agent-authoring-requirements.md §1)
- [ ] Self-describing: tool.yaml / header comment / skill frontmatter+triggers present
- [ ] Typed inputs; structured output; correct exit codes
- [ ] Owns/guarded file guard honored in code
- [ ] Isolated test or documented acceptance check run and passing
- [ ] Registered in the index (or tools/README.md)
- [ ] Skill wraps a script/tool/bin — does not reimplement
- [ ] No git add -A; explicit paths staged
```

### Step 7 — create the PR

Use the available GitHub tool (`mcp__github__create_pull_request` or `gh pr create`) to open the PR against the repo's default base branch (usually `main`).

### Step 8 — subscribe immediately

Without pausing or asking, call `mcp__github__subscribe_pr_activity` (or equivalent) for the PR number just returned.

**Never ask the user whether to subscribe. Always do it.**

### Step 9 — report

Return the PR URL and confirm subscription is active. One line each.

### Error handling

- Merge conflicts or branch divergence → rebase first, then retry.
- Auth failures → surface the error message verbatim, stop.
- Already-open PR for this branch → report the existing PR URL and subscribe to it instead of creating a duplicate.
