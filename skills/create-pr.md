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

### Step 2 — run integration tests

Find every `test-integration` file touched by this branch:

```bash
git diff main...HEAD --name-only | grep -E '(^|/)test-integration$'
```

Also discover any `test-integration` files in tools or scripts directories that exist in the repo:

```bash
find tools scripts -name test-integration 2>/dev/null
```

For each `test-integration` found, run it:

```bash
RUN_INTEGRATION=1 node <path/to/test-integration>
```

If any integration test fails, **stop**. Report which test failed and its output. Do not create the PR until all integration tests pass. Fix the failures, commit, and restart from Step 1.

If no `test-integration` files exist in the repo, skip this step silently.

### Step 3 — push if needed

```bash
git push -u origin $(git branch --show-current)
```

If the push fails, report the error and stop.

### Step 3 — draft title and body

Read all commits ahead of main (`git log main..HEAD`) and the diff stat. Draft:

- **Title** — one line, under 70 characters, imperative mood, describes the change (not the process). Use conventional-commit prefix if the repo uses them.
- **Body** — use this template exactly:

```
## Summary
- <bullet 1>
- <bullet 2>
- <bullet 3 if needed>

## Test plan
- [ ] <concrete thing to verify>
- [ ] <another thing>

<session URL from conversation context>
```

Keep bullets factual: what changed and why, not how you built it.

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

### Step 5 — create the PR

Use the available GitHub tool (`mcp__github__create_pull_request` or `gh pr create`) to open the PR against the repo's default base branch (usually `main`).

### Step 6 — subscribe immediately

Without pausing or asking, call `mcp__github__subscribe_pr_activity` (or equivalent) for the PR number just returned.

**Never ask the user whether to subscribe. Always do it.**

### Step 7 — report

Return the PR URL and confirm subscription is active. One line each.

### Error handling

- Merge conflicts or branch divergence → rebase first, then retry.
- Auth failures → surface the error message verbatim, stop.
- Already-open PR for this branch → report the existing PR URL and subscribe to it instead of creating a duplicate.
