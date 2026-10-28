## Instructions

> **GitHub operations:** `gh` works in every harness and is the canonical form below; Claude Code may use the
> equivalent `mcp__github__*` tools.

Create a pull request for the current branch and immediately set up monitoring: subscribe when a subscription
tool is exposed; otherwise check CI with `gh` and report that webhook monitoring is unavailable.

### Step 1 — verify state

```bash
git status --short
git log --oneline main..HEAD
git diff main...HEAD --stat
```

- Uncommitted changes → stop and tell the user to commit or stash first.
- No commits ahead of main → stop; there is nothing to PR.

### Step 2 — run integration tests (with auto-correction)

Find all `test-integration` files, both touched by this branch and repo-wide:

```bash
git diff main...HEAD --name-only | grep -E '(^|/)test-integration$'
find tools scripts -name test-integration 2>/dev/null
```

If none exist, skip this step silently. Otherwise run each one:

```bash
RUN_INTEGRATION=1 node <path/to/test-integration>
```

**If all pass:** continue to Step 3.

**If any fail, auto-correct (up to 2 rounds).** Each round:

1. **Diagnose** — follow `/investigate` Phases 1–3: read the failing assertions and the source file(s) they exercise, and identify the root cause (wrong value written, missing branch, incorrect path, etc.) before changing anything.
2. **Scope check** — if the fix needs more than ~30 lines across all files, or touches something architecturally significant, stop and report the diagnosis to the user. Do not guess at large changes.
3. **Fix** — apply the targeted change to source. Modify the integration test only if the test itself has a genuine bug (wrong expectation, not a real behavior).
4. **Verify no regression** — run the unit acceptance test (`node <tool>/test`) for the same tool. If it fails, revert the fix and stop.
5. **Re-run integration tests** — if they all pass, commit the fix:
   ```
   fix(<scope>): auto-correct before PR — <one-line description of what was wrong>
   ```
   Then continue to Step 3.

6. **Still failing after 2 rounds** — stop and report:
   - Which assertions failed and their actual vs expected values
   - What was tried in each round
   - The current state of the source
   Do not create the PR.

**Never silently skip a failing integration test.** Either fix it or surface it.

Track auto-fixes applied (scope + one-liner) to include in the PR body.

### Step 2b — LOCAL pre-merge gate (`make ci`) + readiness tracking

Run the repo's **local pre-merge gate**, the CI-equivalent that validates everything BEFORE any GitHub run.
Under the two-tier CI model, GitHub Actions runs instant unit checks only; heavy integration gates (too slow or
environment-bound for GitHub, e.g. build/import, boot/reachability/render, end-to-end and full test suites) run
**locally**. This local gate is the authoritative merge gate and must be GREEN before a non-draft PR.

```bash
# full local gate: Tier-1 unit + Tier-2 heavy integration. Prefer `make ci`.
if   [ -f Makefile ] && grep -qE '^ci:' Makefile;   then make ci        2>&1 | tee /tmp/premerge-gate.log
elif [ -f scripts/ci-local.sh ];                    then bash scripts/ci-local.sh 2>&1 | tee /tmp/premerge-gate.log
else echo "NO_LOCAL_GATE — no \`make ci\` / scripts/ci-local.sh; note it in the PR body"; fi
```

Capture each phase's PASS/FAIL from the output. **Track readiness** for the PR body (Step 6):

- **All phases pass → the branch is MERGE-READY.** Open the PR normally (Step 7).
- **Any phase fails → auto-correct** with the same loop as Step 2 (≤2 rounds, ≤30-line scope, no
  regressions, commit each fix, re-run `make ci`). If still red after 2 rounds, **open the PR as a
  DRAFT** (`gh pr create --draft`) with the failing gates listed in the *Pre-merge gate status*
  section and tell the user exactly which gates are red. **Never open a ready (non-draft) PR while
  the local gate is red**: GitHub CI is only the instant unit tier.
- `NO_LOCAL_GATE` → record it in the status section (readiness = UNVERIFIED), proceed, and say so.

Record the per-phase PASS/FAIL table + the readiness verdict (READY / DRAFT-<red gates> / UNVERIFIED)
for Step 6.

### Step 2c — security gate (before push, and again before merge)

If the repo has `scripts/security-gate.ts` (the scaffold security gate,
[`docs/security-review.md`](../docs/security-review.md)), every merge must pass it.

1. Write the PR body (Step 6 template) to a file first, including the `## Security review` section that names
   every changed file as `` `path` `` with its line-by-line review (the reviewer is not the author). Use your
   file-write tool or a **quoted** heredoc (`<<'EOF'`) so backticked paths and `$` are never executed or
   expanded by the shell; never `printf`/`echo` the body inside double quotes.
2. Run **origin/main's copy** of the gate, never the branch's (the branch itself could have edited it):

```bash
git fetch -q origin main
body=$(mktemp)
cat > "$body" <<'PR_BODY_EOF'
<drafted PR body, verbatim>
PR_BODY_EOF
gate=$(mktemp -d) && git show origin/main:scripts/security-gate.ts > "$gate/security-gate.ts" \
  && node "$gate/security-gate.ts" "$body"; echo "SECURITY_GATE_EXIT=$?"; rm -rf "$gate"
```

- **Exit 0** → continue. Record "security gate: pass" in the *Pre-merge gate status* table.
- **Findings** → fix each one, or acknowledge a reviewed false positive on its own line in the body:
  `security-ack: <finding id> — <why it is safe>` (exact id). Re-run until it passes.
- **Held** (`newdep:*`, `gate-change:*`, `gate-input:*`, `lockfile:*`) → only the owner can release it: a dependency needs an
  `<eco>:<name> — <owner words>` line in `security/approved-deps.txt` merged on `origin/main` first; a gate
  change, a scan input or an unparseable lockfile needs `owner sign-off: "<owner words>"` on its ack line. Ask the owner;
  never write their approval (the gate cannot tell who wrote it — see "What the gate cannot prove").
- **Exit 2 / scanners missing** → install them with origin/main's copy of the setup script (a gate file):
  `git show origin/main:scripts/setup-security-tools.sh > "$gate/setup.sh" && bash "$gate/setup.sh"`. The gate
  fails closed without them, and when a binary no longer matches its pinned hash.
- `origin/main` has no gate yet (this PR adds it) → run the branch's copy once with
  `SECURITY_GATE_BOOTSTRAP=1 node scripts/security-gate.ts "$body"`.

If the gate does not pass, open the PR as a DRAFT and list the security gate as red (same rule as Step 2b).
If the repo has no `scripts/security-gate.ts`, skip this step and note "no security gate" in the status table.

### Step 3 — bump version on the branch

If the repo has no `package.json`, skip this step silently.

Bump the release version on the branch, so the bump commit is pushed under your credentials and `verify` runs
on it, letting the PR merge cleanly. No CI job or extra token is involved. Tagging stays on merge to main (e.g.
in `release.yml`); this step only edits `package.json`.

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
   consumers may lack the `.ts`), then to by hand:
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

Run `/simplify` in review mode (standalone invocation) against the changed files to produce the Quality Scores table.

**All files must score 10/10 on all four dimensions before continuing.** Any score below 10 blocks PR creation: surface the violations and wait for the user to fix them or add `quality-override` annotations.

Override syntax (model-driven criteria only — mechanical violations must be fixed):
```
quality-override: <file> — <criterion> — <reason>
```

Once all scores are 10/10 (or approved overrides cover every remaining violation), save the Quality Scores table for the PR body (Step 6).

### Step 6 — draft title and body

Read all commits ahead of main (`git log main..HEAD`) and the diff stat. Draft:

- **Title** — one line, under 70 characters, imperative mood, describes the change (not the process). Use conventional-commit prefix if the repo uses them.
- **Body** — use this template exactly:

```
## Summary
- <bullet 1>
- <bullet 2>
- <bullet 3 if needed>

## Critical changes
<Key notes of what changed where, for the parts with blast radius — agent rules, durable contracts, data,
security, CI/release, anything `[unverified]`. At most five, ranked by blast radius:>
- `<path:line>` — <what changed>; <what depends on it>
<or: "None — leaf change." — only when true, and never when the diff touches `AGENTS.md`, `skills/`,
`.github/` or the gate's files>

## Pre-merge gate status
<from Step 2b `make ci` — the LOCAL pre-merge gate; GitHub CI is instant-unit only>
**Readiness: READY** &nbsp;(or `DRAFT — <red gate(s)>`, or `UNVERIFIED — no local gate`)
| Gate (local) | Result |
|------|--------|
| <unit + lint phase, e.g. `<lang> test + linter`> | ✅ pass |
| <static / mechanical phase, e.g. shellcheck / quality checks> | ✅ pass |
| <heavy integration phase, run locally> | ✅ pass |
| <other phases the local gate reported> | ✅ / ❌ |
| security gate (`scripts/security-gate.ts`, Step 2c) | ✅ / ❌ / n/a |

## Security review
- `<path/of/every/changed/file>` — <what it does from a security point of view, or "no security impact" + why>
<one `security-ack: <id> — <reason>` line per acknowledged finding, if any>

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

**Prose check:** run `/deslop` in edit mode on the drafted title and the body's
prose (Summary bullets, Test plan items). Keep the template headings, the gate and
Quality Scores tables, and the session URL exactly as drafted. Use the edited
title and body in Step 7. The sections appended below (Auto-corrections,
Callable-unit checklist) are checklists and stay as written.

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

Open the PR with `gh pr create` against the repo's default base branch (usually `main`); Claude Code may use `mcp__github__create_pull_request`.

**Honor the Step-2b readiness verdict:**
- **READY** (local gate all-green) → open a normal PR. The *Pre-merge gate status* section is the
  evidence it is merge-ready before GitHub's instant-unit CI reports.
- **DRAFT — `<red gate>`** (local gate red after auto-correct) → open with `gh pr create --draft` and
  say which gates are red; do not present it as ready.
- **UNVERIFIED** (no local gate found) → open normally but state readiness is unverified.

### Step 8 — subscribe immediately

**Do not ask whether to monitor.** Without pausing, subscribe to PR activity for the PR number just returned:

- Use `subscribe_pr_activity` (or a namespaced equivalent) when the client exposes it.
- Otherwise run `gh pr checks <pr> --watch` to wait for CI. Capture its exit status directly; poll the running
  command in short intervals so steering stays responsive. This watches checks only; for reviews or merge
  events use `gh pr view <pr> --json state,reviews,comments` when needed. Report that no webhook subscription
  is active.

### Step 9 — report

Return the PR URL, check results, and whether a subscription is active or only
a CLI check was performed. Never claim a CLI check is a persistent subscription.

### Per-task handoff

PR creation is not merge authorization. In the default queue flow, the orchestrator keeps this task current until local and required hosted
validation pass on the final head, an authorized merge actually completes, and a fresh working branch exists.
If merge authority is absent, preserve the ready PR and report that blocker; do not start another independent
task. Follow `queue advance` in [queue.md](queue.md) only after verifying those facts. Subagents never push or
merge the orchestrator's branch.

### Clear the handoff (before any merge)

If the branch carries `.pause/handoff.md`, delete it in the last commit before merging to main, so main never
holds a handoff a later `/resume` would act on. Move anything still worth keeping into the PR body or
`design.md` first:

```bash
[ -f .pause/handoff.md ] && git rm -q .pause/handoff.md && git commit -m "chore: clear handoff before merge" && git push
node scripts/check-handoff.ts --pre-merge   # must exit 0 on the head you merge
```

Do this before the security gate below, so the gate judges, and the merge uses, the cleared head.

### Security gate (before any merge)

Re-run the Step 2c security gate against the PR body **as it stands on GitHub**, on the final head, right
before merging, and merge exactly the commit the gate judged — a push after the gate ran must not slip in:

```bash
gh pr view <pr> --json body -q .body > "$body"
sha=$(git rev-parse HEAD)
[ "$(gh pr view <pr> --json headRefOid -q .headRefOid)" = "$sha" ] || { echo "PR head moved; pull and re-gate"; exit 1; }
# ...origin/main's gate as in Step 2c, on this checkout at $sha; then, only on exit 0:
gh pr merge <pr> --match-head-commit "$sha"   # plus the repo's merge-method flag (--squash / --merge)
```

A non-zero gate exit refuses the merge — no exceptions, no `--admin` around it.

### Verifying a real green (before any merge)

A required roll-up job (`needs:` a matrix/shard set with no `if: always()`), or any required job gated by a
path filter / `if:` that never runs, **skips** on failure, and GitHub counts the skip as passing.

- **Read the actual check conclusions, not the merge button** (`gh pr checks <pr>`;
  Claude Code: `mcp__github__…get_check_runs`). Treat a lingering `skipping` on a
  *required* check as suspect, not a pass.
- **Capture the watch's own exit**, not a wrapper's:
  `gh pr checks <pr> --watch; echo "EXIT=$?"` — a surrounding shell/echo can mask a
  failure with exit 0.
- **Fix at the source** (if you own the CI): make roll-ups fail *closed* with
  `if: ${{ always() }}` + a guard step that exits non-zero unless every dependency
  succeeded (`needs.*.result != 'success'`). No ruleset change is needed; the check
  is already required.

### Error handling

- Merge conflicts or branch divergence → rebase first, then retry.
- Auth failures → surface the error message verbatim, stop.
- Already-open PR for this branch → report the existing PR URL and subscribe to it instead of creating a duplicate.
