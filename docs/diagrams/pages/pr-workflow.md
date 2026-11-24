[← Scaffold at a glance](system-map.md)

# PR workflow

How one task becomes one merged PR: local gates first, real checks on GitHub, and a merge only the owner authorizes.

```mermaid
flowchart LR
  n_branch["Branch"] --> n_local["Local gates"]
  n_local["Local gates"] --> n_open["Open the PR"]
  n_open["Open the PR"] --> n_checks["Verify checks"]
  n_checks["Verify checks"] --> n_merge["Authorized merge"]
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  classDef lane2 fill:#ddd6fe,stroke:#6d28d9,color:#1f2937
  class n_branch,n_local,n_open lane0
  class n_checks lane1
  class n_merge lane2
```

- [Branch](#branch): Pull the latest main and cut a fresh branch for one independent task.
- [Local gates](#local-gates): Run the integration tests and make ci before opening anything.
- [Open the PR](#open-the-pr): /create-pr opens the PR with a structured body and starts watching its checks.
- [Verify checks](#verify-checks): Read the actual check conclusions on the final head, not the merge button.
- [Authorized merge](#authorized-merge): With the owner's explicit authorization, the orchestrator squash-merges it onto main as one commit.

## Branch

Pull the latest main and cut a fresh branch for one independent task.

- One task per PR and merge cycle.

## Local gates

Run the integration tests and make ci before opening anything.

Details: [/create-pr skill](../../../skills/create-pr.md)

- Start from a clean tree with commits ahead of main.
- When a gate fails
  - Auto-correct up to 2 rounds.
  - Still red: failing integration tests stop with no PR; a red make ci opens the PR as a DRAFT listing the red gates.
- Then bump the version and push.

## Open the PR

/create-pr opens the PR with a structured body and starts watching its checks.

Details: [Review gates](review-gates.md)

- /simplify must score every changed file 10/10, or approved overrides cover the rest, before the PR opens.
- The body has a Summary, Critical changes, gate status, Quality Scores, a Test plan and the session URL.
- Subscribe to the PR, or run gh pr checks --watch.

## Verify checks

Read the actual check conclusions on the final head, not the merge button.

Details: [Session continuity](session-continuity.md)

- First remove the handoff file, push, and run check-handoff --pre-merge, so the final CI run judges the cleared head.
- Capture the watch command's own exit code.
- The Security scan check must pass.

**Where it breaks**

- GitHub counts a skipped required check as passing; treat a skip as suspect.

## Authorized merge

With the owner's explicit authorization, the orchestrator squash-merges it onto main as one commit.

- A PR is not approval.
- The squash merge uses --match-head-commit, so only the commit whose checks were read can land.
- Confirm the PR is MERGED, pull main, and cut a fresh branch before the next task.

## Detailed flow

![PR workflow, detailed](../generated/pr-workflow.svg)

## Code walkthrough

Most of this flow is the agent following skills/create-pr.md with git and gh; no script opens, watches or merges the PR. Code covers the edges: a session-start hook that warns when the branch is behind main, compute-bump.ts for the version, the hosted checks in .github/workflows (ci.yml, quality.yml, security.yml), check-handoff.ts before the merge, and release.yml after it. The repo has no Makefile, so the skill's `make ci` step falls through to its 'no local gate' branch here.

Each excerpt is read from the repo when this page is built. The explanations were written by an agent; `npm test` fails when the lines they explain change.

### Branch: code

#### Session-start hook: warn when the branch is behind origin/main

*Enforces the rule.* It fetches origin/main quietly and exits if the fetch fails. It reads the current branch and counts commits that origin/main has and HEAD lacks. If the count is not zero it prints a warning: pull when on main, merge origin/main otherwise.

```bash
# Fetch origin/main quietly; ignore network errors.
git fetch origin main --quiet 2>/dev/null || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
[ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ] && exit 0

BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "0")
[ "$BEHIND" = "0" ] && exit 0

if [ "$BRANCH" = "main" ]; then
  echo "⚠  main is $BEHIND commit(s) behind origin/main — run: git pull origin main"
else
  echo "⚠  '$BRANCH' is $BEHIND commit(s) behind origin/main — merge before new feature work: git merge origin/main"
fi
```

[`.claude/session-start/hook.sh:19-32`](https://github.com/victusfate/scaffold/blob/main/.claude/session-start/hook.sh#L19-L32)

**Why it matters.** This covers 'pull the latest main' as a warning only; it always exits 0 and changes nothing. Cutting the fresh branch is done by the agent.

### Local gates: code

#### npm test: the local test and check commands

*Carries out the step.* test runs four parts in order and stops at the first failure: the node tests one file at a time, the tool tests, every scripts/test-*.sh, and the repo checks (resolver, skills doc, agents detail, handoff, guidelines, explorer pages, diagrams, C4 files). test:integration is separate and needs RUN_INTEGRATION=1.

```json
  "scripts": {
    "test": "npm run test:node && npm run test:tools && npm run test:shell && npm run test:checks",
    "test:node": "node --test --test-concurrency=1 'scripts/**/*.test.ts' 'tools/**/*.test.ts' 'lib/**/*.test.ts'",
    "test:tools": "tools/hoist-skill/test && tools/sync/test && node tools/linter-setup/test && node tools/dependency-watch/test",
    "test:shell": "for f in scripts/test-*.sh; do [ \"$f\" = scripts/test-read-once.sh ] || bash \"$f\" || exit 1; done",
    "test:checks": "node scripts/check-resolvable.ts --strict && node scripts/update-skills-doc.ts --check && node scripts/check-agents-detail.ts && node scripts/check-handoff.ts && node scripts/check-guidelines.ts && node scripts/render-explorer-pages.ts --check && node scripts/render-diagrams.ts --check && node scripts/render-c4.ts --check",
```

[`package.json:8-13`](https://github.com/victusfate/scaffold/blob/main/package.json#L8-L13)

**Why it matters.** These are the commands the local gates run in this repo, and the same ones CI runs. The skill looks for `make ci` or scripts/ci-local.sh first; neither exists here, so the agent runs these directly.

#### Pre-commit hook: lint, quality check and typecheck on each commit

*Enforces the rule.* With set -eu any failing step blocks the commit. It runs ESLint on staged JS/TS files, the mechanical quality check on staged files, the whole-project tsc --noEmit, then check-resolvable and the skills-doc freshness check. Each step is skipped when its tool or file is missing.

```bash
set -eu

# Linters read the working-tree copy, so a partially staged file is checked as edited.
staged() { git diff --cached --name-only --diff-filter=ACMR -z -- "$@"; }

if ls eslint.config.* > /dev/null 2>&1; then
  if [ -x node_modules/.bin/eslint ]; then
    staged '*.js' '*.mjs' '*.cjs' '*.ts' '*.tsx' |
      xargs -0 -r node_modules/.bin/eslint --no-warn-ignored --
  else
    echo "pre-commit: ESLint configured but not installed — skipping (install deps, e.g. npm ci)" >&2
  fi
fi

if [ -f scripts/check-quality-mechanical.sh ]; then
  bash scripts/check-quality-mechanical.sh --staged
fi

if [ -f tsconfig.json ]; then
  if [ -x node_modules/.bin/tsc ]; then
    node_modules/.bin/tsc --noEmit
  else
    echo "pre-commit: tsconfig.json present but tsc not installed — skipping (install deps, e.g. npm ci)" >&2
  fi
fi

if [ -f scripts/check-resolvable.ts ]; then node scripts/check-resolvable.ts; fi
if [ -f scripts/update-skills-doc.ts ]; then node scripts/update-skills-doc.ts --check; fi
```

[`.githooks/pre-commit:14-41`](https://github.com/victusfate/scaffold/blob/main/.githooks/pre-commit#L14-L41)

**Why it matters.** It catches lint and type errors before they reach the PR. It only runs when core.hooksPath is set to .githooks, which the session-start hook does for cloud sessions; locally it is opt-in.

#### computeBump: next version from commit messages

*Carries out the step.* It scans commit subject and body lines. A BREAKING CHANGE or a feat!/fix! line means major and stops the scan; a feat: line means minor; a fix: line means patch if nothing higher was seen. With no such line it returns none; otherwise it returns the bumped version string.

```ts
export function computeBump(messages: string[], current: string): BumpResult {
  let bump: BumpKind = 'none';
  for (const line of messages) {
    if (/(BREAKING CHANGE|^feat(\(.*\))?!:|^fix(\(.*\))?!:)/.test(line)) { bump = 'major'; break; }
    // A 'major' match above always breaks, so bump is never 'major' here.
    if (/^feat(\(.*\))?:/.test(line)) { bump = 'minor'; }
    else if (/^fix(\(.*\))?:/.test(line)) { if (bump === 'none') bump = 'patch'; }
  }
  if (bump === 'none') return { bump, next: null };

  const [major, minor, patch] = current.split('.').map(Number);
  const next = bump === 'major' ? `${major + 1}.0.0`
             : bump === 'minor' ? `${major}.${minor + 1}.0`
             : `${major}.${minor}.${patch + 1}`;
  return { bump, next };
}
```

[`scripts/compute-bump.ts:20-35`](https://github.com/victusfate/scaffold/blob/main/scripts/compute-bump.ts#L20-L35)

**Why it matters.** The skill pipes git log origin/main..HEAD into this to pick the version it commits on the branch before pushing. The release job later tags exactly that version.

**Methods and helpers used here**

<details>
<summary><code>BumpKind</code> · type · scripts/compute-bump.ts:13</summary>

A string union of 'major', 'minor', 'patch' and 'none'. It names the size of the version bump computeBump derived from the commit messages.

Comment in the source: messages: array of commit subject/body lines. current: semver string the bump applies to. Returns { bump: 'major'|'minor'|'patch'|'none', next: string|null }.

```ts
export type BumpKind = 'major' | 'minor' | 'patch' | 'none';
```

[`scripts/compute-bump.ts:13`](https://github.com/victusfate/scaffold/blob/main/scripts/compute-bump.ts#L13)

</details>

<details>
<summary><code>BumpResult</code> · interface · scripts/compute-bump.ts:15</summary>

The return shape of computeBump: bump is the BumpKind chosen, and next is the resulting version string, or null when bump is 'none'.

```ts
export interface BumpResult {
  bump: BumpKind;
  next: string | null;
}
```

[`scripts/compute-bump.ts:15-18`](https://github.com/victusfate/scaffold/blob/main/scripts/compute-bump.ts#L15-L18)

</details>

### Open the PR: code

#### Test: the quality gate comes before the PR body in the skill text

*Test that pins it.* It finds the line numbers of the 'Step 5' and 'Step 6' headings in skills/create-pr.md, matching headings only. It passes when Step 5 (the quality gate) appears before Step 6 (drafting the PR body), and fails otherwise.

```bash
# Gate (Step 5) must appear before Step 6 (PR body drafting). Match the section
# HEADINGS, not prose cross-references, so an earlier "(Step 6)" mention in the
# body of another step can't invert the check.
gate_line=$(grep -nE '^#+[[:space:]].*Step 5' "$FILE" | head -1 | cut -d: -f1)
step6_line=$(grep -nE '^#+[[:space:]].*Step 6' "$FILE" | head -1 | cut -d: -f1)
if [ -n "$gate_line" ] && [ -n "$step6_line" ] && [ "$gate_line" -lt "$step6_line" ]; then
  ok "quality gate (Step 5) appears before PR body drafting (Step 6)"
else
  fail "quality gate must appear before PR body drafting"
fi
```

[`scripts/test-create-pr-gate.sh:23-32`](https://github.com/victusfate/scaffold/blob/main/scripts/test-create-pr-gate.sh#L23-L32)

**Why it matters.** This pins the order 'score 10/10 first, then open the PR' in the skill document. It checks the text of the instructions, not what an agent did; nothing in code checks the scores or the PR body.

**Methods and helpers used here**

<details>
<summary><code>fail</code> · shell function · scripts/test-create-pr-gate.sh:5</summary>

Takes a description, prints it to stdout prefixed with a cross mark, and increments the script's global FAIL counter. It does not exit the script.

```bash
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }
```

[`scripts/test-create-pr-gate.sh:5`](https://github.com/victusfate/scaffold/blob/main/scripts/test-create-pr-gate.sh#L5)

</details>

### Verify checks: code

#### CI verify job: npm test on every PR to main

*Enforces the rule.* On a pull request to main, the job checks out the code without stored credentials, installs the Node version from .node-version, runs npm ci and then npm test. npm test chains the node tests, the tool tests, the shell tests and the repo checks.

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    env:
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          persist-credentials: false
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version-file: .node-version
      - run: npm ci
      - run: npm test
```

[`.github/workflows/ci.yml:11-24`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/ci.yml#L11-L24)

**Why it matters.** This is one of the real checks whose conclusion the agent reads on the final head. The workflow has no roll-up job, so each job's own result must be read.

#### CI lint job: lint, typecheck and import boundaries

*Enforces the rule.* After checkout and npm ci it runs npm run lint (ESLint with zero warnings allowed), npm run typecheck (tsc --noEmit), then the import-boundary check. Any failing step fails the job.

```yaml
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          persist-credentials: false
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version-file: .node-version
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: node scripts/check-import-boundaries.ts
```

[`.github/workflows/ci.yml:37-50`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/ci.yml#L37-L50)

**Why it matters.** A second hosted check on the PR head, separate from the tests. A PR that passes tests but breaks types or boundaries stops here.

#### Quality Gate: mechanical checks on all source files

*Enforces the rule.* On PR open, update or reopen it lists every tracked js, mjs, ts, tsx, sh, py, rb and go file. If there are any, it runs scripts/check-quality-mechanical.sh on all of them.

```yaml
  mechanical:
    name: Mechanical checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          persist-credentials: false
      - name: Run mechanical quality checks (all files)
        run: |
          mapfile -t FILES < <(git ls-files | grep -E '\.(js|mjs|ts|tsx|sh|py|rb|go)$' || true)
          [ ${#FILES[@]} -gt 0 ] && bash scripts/check-quality-mechanical.sh "${FILES[@]}"
```

[`.github/workflows/quality.yml:11-21`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/quality.yml#L11-L21)

**Why it matters.** This is the machine half of the quality bar; the 10/10 score from /simplify is model judgment made before the PR opens.

#### Security scan: list what the PR changes and scan it for secrets

*Enforces the rule.* The fetch helper downloads a release asset and rejects it unless its sha256 matches the pinned value. The step lists files added or changed between the base tip and the PR merge commit. If any changed, it downloads gitleaks, copies the changed files to a temp tree and scans them, adding 'gitleaks' to the failed list on a finding.

```yaml
      - name: Scan the changes
        run: |
          set -euo pipefail
          bin="$RUNNER_TEMP/bin"; mkdir -p "$bin"
          # fetch <repo> <tag> <asset> <sha256>: download a release asset and refuse it unless it is the pinned one.
          fetch() {
            curl -sSfL --retry 3 -o "$RUNNER_TEMP/$3" "https://github.com/$1/releases/download/$2/$3"
            echo "$4  $RUNNER_TEMP/$3" | sha256sum -c --quiet -
          }
          mapfile -d '' changed < <(git diff -z --name-only --diff-filter=ACMR HEAD^1 HEAD)
          echo "${#changed[@]} changed file(s)"
          failed=()

          if [ ${#changed[@]} -gt 0 ]; then
            fetch gitleaks/gitleaks "v$GITLEAKS_VERSION" "gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" "$GITLEAKS_SHA256"
            tar -xzf "$RUNNER_TEMP/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -C "$bin" gitleaks
            tree="$RUNNER_TEMP/changed"; mkdir -p "$tree"
            # The checkout is HEAD, so copy the changed files from it (paths on stdin: no argument-length limit).
            printf '%s\0' "${changed[@]}" | tar --null -T - -cf - | tar -x -C "$tree"
            echo "::group::gitleaks (secrets in changed files)"
            (cd "$tree" && "$bin/gitleaks" dir . --no-banner --redact -v -i "$GITHUB_WORKSPACE") || failed+=(gitleaks)
            echo "::endgroup::"
          fi
```

[`.github/workflows/security.yml:37-59`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/security.yml#L37-L59)

**Why it matters.** This starts the 'Security scan' check that must pass before merge. Scanning only what the PR adds keeps it fast; osv-scanner and zizmor follow in the same step when lockfiles or workflows changed.

#### Security scan: zizmor on workflow changes, then fail if any scanner failed

*Enforces the rule.* If a changed path is a workflow, an action file or dependabot.yml, it downloads the pinned zizmor and runs it, recording a failure. At the end, a non-empty failed list prints an error naming the scanners and exits 1; otherwise it prints 'security scan: clean'.

```yaml
          if printf '%s\n' "${changed[@]}" | grep -qE '^(\.github/(workflows|actions)/|action\.ya?ml$|\.github/dependabot\.ya?ml$)'; then
            fetch zizmorcore/zizmor "v$ZIZMOR_VERSION" zizmor-x86_64-unknown-linux-gnu.tar.gz "$ZIZMOR_SHA256"
            tar -xzf "$RUNNER_TEMP/zizmor-x86_64-unknown-linux-gnu.tar.gz" -C "$bin" zizmor
            echo "::group::zizmor (GitHub Actions workflows)"
            "$bin/zizmor" . || failed+=(zizmor)
            echo "::endgroup::"
          fi

          if [ ${#failed[@]} -gt 0 ]; then
            echo "::error::security scan found problems: ${failed[*]} (see the groups above)"
            exit 1
          fi
          echo "security scan: clean"
```

[`.github/workflows/security.yml:77-89`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/security.yml#L77-L89)

**Why it matters.** All three scanners report through this one exit, so the check's conclusion is a real pass or fail. The job runs on every pull request, so it is not skipped by a path filter.

#### check-handoff --pre-merge: fail while a handoff file exists

*Enforces the rule.* preMerge returns an error when .pause/handoff.md exists, with the git rm command to clear it. The CLI block picks preMerge when --pre-merge is passed, else the content check. Any error is printed and the process exits 1; otherwise it prints OK.

```ts
/** Errors when a handoff would ride a merge into main. */
export function preMerge(path: string): string[] {
  return existsSync(path) ? [`handoffs live only on branches; clear it before merging to main: git rm ${path} && git commit -m "chore: clear handoff before merge"`] : [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const mergeMode = args.includes('--pre-merge');
  const path = args.find(a => a !== '--pre-merge') ?? '.pause/handoff.md';
  const errors = mergeMode ? preMerge(path) : existsSync(path) ? check(readFileSync(path, 'utf8')) : [];
  for (const e of errors) console.error(`check-handoff: ${path}: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`check-handoff: OK (${existsSync(path) ? path : `no ${path}`})`);
}
```

[`scripts/check-handoff.ts:48-61`](https://github.com/victusfate/scaffold/blob/main/scripts/check-handoff.ts#L48-L61)

**Why it matters.** A handoff must not ride a merge into main, where a later /resume would act on it. The agent runs this on the head it is about to merge; nothing in CI runs the --pre-merge form.

**Methods and helpers used here**

<details>
<summary><code>check</code> · function · scripts/check-handoff.ts:27</summary>

Takes the text of a handoff and an optional line limit (default 80) and returns a list of error strings, empty when the handoff passes. It reports a missing '## State' heading, any bullet under that heading with no [verified: ...] or [unverified] tag, any line whose verified tag contains shell syntax or a fetch command, any line with a correction marker, and a line count over the limit. It reads nothing but its argument and has no side effects.

```ts
export function check(text: string, maxLines = MAX_LINES): string[] {
  const lines = text.replace(/\n$/, '').split('\n');
  const errors: string[] = [];
  let inState = false;
  let sawState = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^#{1,6} /.test(line)) {
      inState = /^## State\s*$/.test(line);
      sawState ||= inState;
    } else if (inState && /^\s*[-*] /.test(line) && !TAG.test(line)) {
      errors.push(`State bullet at line ${n} needs [verified: <cmd>] or [unverified]: ${line.trim()}`);
    }
    if (UNSAFE_TAG.test(line)) errors.push(`line ${n}: a [verified: …] tag is evidence, not a command to replay; cite a repo check or file:line: ${line.trim()}`);
    if (CLASH.test(line)) errors.push(`line ${n} keeps a correction beside the old fact; rewrite the fact in place: ${line.trim()}`);
  });
  if (!sawState) errors.unshift("no '## State' section: list the facts the next session relies on, each tagged [verified: <cmd>] or [unverified]");
  if (lines.length > maxLines) errors.push(`handoff is ${lines.length} lines, over the ${maxLines}-line limit; keep current state, drop history (git keeps it)`);
  return errors;
}
```

[`scripts/check-handoff.ts:27-46`](https://github.com/victusfate/scaffold/blob/main/scripts/check-handoff.ts#L27-L46)

</details>

### Authorized merge: code

#### queue advance: record the merged PR and the fresh branch

*Carries out the step.* It refuses unless the id is the selected delivery task, that task was accepted as done, no task is active, --pr looks like a pull request URL and --branch is not empty. On success it clears deliveryTask and deliveryAccepted, saves, and writes the PR and branch to the log.

```ts
/**
 * `queue advance <id> --pr <url> --branch <fresh>` — an audited attestation, not a
 * remote check: the queue verifies its own state (selected task completed and
 * accepted, no active claims) and records the PR and fresh branch the root vouches for.
 */
export function cmdAdvance(q: Queue, id: string, pr: string, branch: string): number {
  const task = q.tasks.find(t => t.id === id);
  if (!id || q.config.deliveryTask !== id || !q.config.deliveryAccepted || (task && task.status !== 'done')
      || q.tasks.some(t => t.status === 'active')
      || !MERGED_PR_URL.test(pr) || !branch.trim()) {
    console.error('advance: requires selected completed task, no active claims, --pr <merged-pr-url> and --branch <fresh-working-branch>');
    return 1;
  }
  const advanced = setConfig(q, { deliveryTask: '', deliveryAccepted: false });
  save(advanced);
  log(`advance ${id}: root attests authorized validated merge ${pr}; fresh branch ${branch}`);
  console.log(`delivery acknowledged for ${id}; external merge/validation evidence is root-owned${drainKick(advanced)}`);
  return 0;
}
```

[`scripts/queue-delivery.ts:9-27`](https://github.com/victusfate/scaffold/blob/main/scripts/queue-delivery.ts#L9-L27)

**Why it matters.** This closes the delivery cycle so the queue will hand out the next task. The code checks only the queue's own state and the URL's shape; it does not ask GitHub whether the PR merged, so the orchestrator vouches for that.

**Methods and helpers used here**

<details>
<summary><code>MERGED_PR_URL</code> · const · scripts/queue-delivery.ts:7</summary>

A regular expression matching an https URL with no whitespace that ends in /pull/&lt;number&gt;. cmdAdvance rejects a --pr value that does not match it; it checks only the shape, not that the PR is merged.

```ts
const MERGED_PR_URL = /^https:\/\/[^\s]+\/pull\/\d+$/;
```

[`scripts/queue-delivery.ts:7`](https://github.com/victusfate/scaffold/blob/main/scripts/queue-delivery.ts#L7)

</details>

<details>
<summary><code>save</code> · function · scripts/queue-io.ts:296</summary>

Takes a queue and, under the queue lock, writes it to the SQLite store and rewrites the queue.md view in one transaction; lane files of tasks that ended or were removed are deleted after the commit. Throws a QueueIntegrityError and saves nothing if queue.md was edited since the store last rendered it, and throws if the lock stays held for 60 seconds.

Comment in the source: Persist `q` to the store, then re-render the view — one transaction.

```ts
export function save(q: Queue): void {
  withLock(() => openStore((db, defer) => renderView(db, defer, persistQueue(db, defer, q))));
}
```

[`scripts/queue-io.ts:296-298`](https://github.com/victusfate/scaffold/blob/main/scripts/queue-io.ts#L296-L298)

</details>

<details>
<summary><code>log</code> · function · scripts/queue-io.ts:377</summary>

Appends one line, '- &lt;ISO timestamp&gt; &lt;message&gt;', to log.md beside the queue file. Returns nothing.

```ts
export function log(msg: string): void {
  appendFileSync(sidecar('log.md'), `- ${now()} ${msg}\n`);
}
```

[`scripts/queue-io.ts:377-379`](https://github.com/victusfate/scaffold/blob/main/scripts/queue-io.ts#L377-L379)

</details>

<details>
<summary><code>Queue</code> · interface · scripts/queue-model.ts:121</summary>

The whole work queue in memory: a config object (run status, intervals, failure and lease limits, parallelism, delivery state, the next id counter) plus the ordered list of tasks, where list order is priority. It is what load returns, what save persists, and what every queue operation takes and returns.

```ts
export interface Queue {
  config: QueueConfig;
  tasks: Task[];
}
```

[`scripts/queue-model.ts:121-124`](https://github.com/victusfate/scaffold/blob/main/scripts/queue-model.ts#L121-L124)

</details>

<details>
<summary><code>setConfig</code> · function · scripts/queue-model.ts:498</summary>

Takes a queue and a partial config and returns a new queue with those config values overriding the existing ones and the same tasks. Nothing is validated or saved.

```ts
export function setConfig(q: Queue, patch: Partial<QueueConfig>): Queue {
  return { config: { ...q.config, ...patch }, tasks: q.tasks };
}
```

[`scripts/queue-model.ts:498-500`](https://github.com/victusfate/scaffold/blob/main/scripts/queue-model.ts#L498-L500)

</details>

<details>
<summary><code>drainKick</code> · function · scripts/queue-gates.ts:60</summary>

Takes a queue and returns a string to append to command output: a newline, the DRAIN-WANTED marker with the count of eligible tasks, and a hint to run tick, when the queue is running, has no active task and has at least one eligible task. Returns an empty string otherwise.

Comment in the source: Emit the stable DRAIN-WANTED marker (plus a human hint) when a mutation leaves a running queue drainable with no driver attached. This is a machine signal — a Monitor on the queue file, a cron, or an agent keys on `queue: DRAIN-WANTED` to (re)start the drain — not just prose a human has to be watching to notice. Empty string when a driver is already active, nothing is eligible, or the queue is stopped/paused (an operator halt is not a stalled drain).

```ts
export function drainKick(q: Queue): string {
  const sig = drainSignal(q);
  return sig ? `\n${sig}  → start now: \`node scripts/queue.ts tick\` (or the loop)` : '';
}
```

[`scripts/queue-gates.ts:60-63`](https://github.com/victusfate/scaffold/blob/main/scripts/queue-gates.ts#L60-L63)

</details>

#### Release job: tag main after the merge

*Carries out the step.* On a push to main it checks out full history and reads the version from package.json. If the tag v&lt;version&gt; already exists it stops. Otherwise it creates the annotated tag and pushes only the tag.

```yaml
  tag:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Tag release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          VERSION=$(node -p "require('./package.json').version")
          if git rev-parse "v$VERSION" >/dev/null 2>&1; then
            echo "Tag v$VERSION already exists — skipping"
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          gh auth setup-git
          git tag -a "v$VERSION" -m "Release v$VERSION"
          git push origin "v$VERSION"
          echo "Tagged v$VERSION"
```

[`.github/workflows/release.yml:18-43`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/release.yml#L18-L43)

**Why it matters.** This is the only code that runs because of the merge. It relies on the version bump already being on the PR branch, and it pushes a tag, never a commit, so main's history stays one squash commit per PR.

## Checked against the source

The PR workflow page matches skills/create-pr.md and AGENTS.md closely: every gate, the draft-PR rule, the handoff clearing, the real-green checks and the head-pinned squash merge are stated in the sources. The only shortfalls are the "pull main" steps, which are written only in docs/agents-detail.md (not a listed source), and the merge gate, which shows no path for a missing authorization. Several source gates are not shown at all, chiefly the Callable-unit checklist that blocks merge and the 30-line scope limit on auto-correction.

| Confirmed | Partly | Not found | Contradicted | In the source, not shown in the flow | Code excerpts |
|---:|---:|---:|---:|---:|---:|
| 33 | 2 | 0 | 0 | 8 | 13 |

An agent judged each claim against the source; each quote is found in its file when this page is built.

### Branch: checks

<details>
<summary>3 confirmed, with the supporting line</summary>

- **Confirmed**: Pull the latest main and cut a fresh branch for one independent task.
  > \1. Pull latest main: \`git checkout main &amp;&amp; git pull origin main\`
  >
  > [`docs/agents-detail.md:605`](https://github.com/victusfate/scaffold/blob/main/docs/agents-detail.md#L605)

  AGENTS.md says "cut a fresh branch before the next task" but the explicit pull-main step is only in docs/agents-detail.md, which is not a listed source.

- **Confirmed**: One task per PR and merge cycle.
  > \*\*One independent task per PR/merge cycle.\*\* Validate locally, open the PR, verify real required checks on the
  >
  > [`AGENTS.md:190`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L190)

- **Confirmed**: branch → local: Task built on the branch (payload: commits)
  > \- No commits ahead of main → stop; there is nothing to PR.
  >
  > [`skills/create-pr.md:18`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L18)

</details>

### Local gates: checks

<details>
<summary>10 confirmed, with the supporting line</summary>

- **Confirmed**: Run the integration tests and make ci before opening anything.
  > Run the repo's \*\*local pre-merge gate\*\*, the CI-equivalent that validates everything BEFORE any GitHub run.
  >
  > [`skills/create-pr.md:61`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L61)

- **Confirmed**: Start from a clean tree with commits ahead of main.
  > \- Uncommitted changes → stop and tell the user to commit or stash first.
  >
  > [`skills/create-pr.md:17`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L17)

- **Confirmed**: Auto-correct up to 2 rounds.
  > \*\*If any fail, auto-correct (up to 2 rounds).\*\* Each round:
  >
  > [`skills/create-pr.md:37`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L37)

- **Confirmed**: Still red: failing integration tests stop with no PR; a red make ci opens the PR as a DRAFT listing the red gates.
  >   regressions, commit each fix, re-run \`make ci\`). If still red after 2 rounds, \*\*open the PR as a
  >
  > [`skills/create-pr.md:77`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L77)

- **Confirmed**: Then bump the version and push.
  > Bump the release version on the branch, so the bump commit is pushed under your credentials and \`verify\` runs
  >
  > [`skills/create-pr.md:95`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L95)

- **Confirmed**: local → open: Local gates run, pushed (payload: pushed branch)
  > git push -u origin $(git branch --show-current)
  >
  > [`skills/create-pr.md:142`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L142)

- **Confirmed**: make ci: The local pre-merge gate: unit and heavy integration checks.
  > \# full local gate: Tier-1 unit + Tier-2 heavy integration. Prefer \`make ci\`.
  >
  > [`skills/create-pr.md:67`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L67)

- **Confirmed** (from the diagram): Run integration tests; red after 2 fix rounds → stop, no PR
  > \6. \*\*Still failing after 2 rounds\*\* — stop and report:
  >
  > [`skills/create-pr.md:49`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L49)

- **Confirmed** (from the diagram): Legend DRAFT PR: a PR marked not ready, used while a local gate is red
  >   section and tell the user exactly which gates are red. \*\*Never open a ready (non-draft) PR while
  >
  > [`skills/create-pr.md:79`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L79)

- **Confirmed** (from the diagram): Legend CI: hosted runs fast unit checks, heavy gates run locally
  > Under the two-tier CI model, GitHub Actions runs instant unit checks only; heavy integration gates (too slow or
  >
  > [`skills/create-pr.md:62`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L62)

</details>

### Open the PR: checks

<details>
<summary>7 confirmed, with the supporting line</summary>

- **Confirmed**: /create-pr opens the PR with a structured body and starts watching its checks.
  > Create a pull request for the current branch and immediately set up monitoring: subscribe when a subscription
  >
  > [`skills/create-pr.md:6`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L6)

- **Confirmed**: /simplify must score every changed file 10/10, or approved overrides cover the rest, before the PR opens.
  > Once all scores are 10/10 (or approved overrides cover every remaining violation), save the Quality Scores table for the PR body (Step 6).
  >
  > [`skills/create-pr.md:158`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L158)

- **Confirmed**: The body has a Summary, Critical changes, gate status, Quality Scores, a Test plan and the session URL.
  > Quality Scores tables, and the session URL exactly as drafted. Use the edited
  >
  > [`skills/create-pr.md:206`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L206)

- **Confirmed**: Subscribe to the PR, or run gh pr checks --watch.
  > \- Otherwise run \`gh pr checks &lt;pr&gt; --watch\` to wait for CI. Capture its exit status directly; poll the running
  >
  > [`skills/create-pr.md:247`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L247)

- **Confirmed**: open → checks: PR opened (payload: PR)
  > Open the PR with \`gh pr create\` against the repo's default base branch (usually \`main\`); Claude Code may use \`mcp\_\_github\_\_create\_pull\_request\`.
  >
  > [`skills/create-pr.md:233`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L233)

- **Confirmed**: Critical changes: Up to five path:line notes of what changed and what depends on it.
  > at most five \`path:line\` notes of what changed where and what depends on it. Measure delivery, not output
  >
  > [`AGENTS.md:127`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L127)

- **Confirmed** (from the diagram): gh pr create
  > Open the PR with \`gh pr create\` against the repo's default base branch (usually \`main\`); Claude Code may use \`mcp\_\_github\_\_create\_pull\_request\`.
  >
  > [`skills/create-pr.md:233`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L233)

</details>

### Verify checks: checks

<details>
<summary>8 confirmed, with the supporting line</summary>

- **Confirmed**: Read the actual check conclusions on the final head, not the merge button.
  > \- \*\*Read the actual check conclusions, not the merge button\*\* (\`gh pr checks &lt;pr&gt;\`;
  >
  > [`skills/create-pr.md:293`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L293)

- **Confirmed**: First remove the handoff file, push, and run check-handoff --pre-merge, so the final CI run judges the cleared head.
  > Do this before the final CI run, so CI judges, and the merge uses, the cleared head.
  >
  > [`skills/create-pr.md:276`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L276)

- **Confirmed**: Capture the watch command's own exit code.
  > \- \*\*Capture the watch's own exit\*\*, not a wrapper's:
  >
  > [`skills/create-pr.md:296`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L296)

- **Confirmed**: The Security scan check must pass.
  > must pass before merge. Fix a finding, or suppress a reviewed false positive in the tool's own in-repo format
  >
  > [`AGENTS.md:206`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L206)

- **Confirmed**: GitHub counts a skipped required check as passing; treat a skip as suspect.
  > path filter / \`if:\` that never runs, \*\*skips\*\* on failure, and GitHub counts the skip as passing.
  >
  > [`skills/create-pr.md:291`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L291)

- **Confirmed**: checks → merge: Real checks green (payload: verified head commit)
  > sha=$(git rev-parse HEAD)   \# the commit whose checks you verified
  >
  > [`skills/create-pr.md:283`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L283)

- **Confirmed** (from the diagram): Legend handoff: .pause/handoff.md, notes for in-flight work, kept off main
  > If the branch carries \`.pause/handoff.md\`, delete it in the last commit before merging to main, so main never
  >
  > [`skills/create-pr.md:267`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L267)

- **Confirmed** (from the diagram): Legend Security scan: CI check: gitleaks, osv-scanner, zizmor on the changes
  > The \`Security scan\` CI check (\`.github/workflows/security.yml\`: gitleaks, osv-scanner, zizmor on what the PR changes)
  >
  > [`AGENTS.md:205`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L205)

</details>

### Authorized merge: checks

- **Partly**: Confirm the PR is MERGED, pull main, and cut a fresh branch before the next task.
  > the task. Confirm the merge and cut a fresh branch before the next task. Never commit feature work to main.
  >
  > [`AGENTS.md:192`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L192)

  The listed sources say confirm the merge and cut a fresh branch; the "pull main" step is only in docs/agents-detail.md (PR Workflow step 7), not a listed source.

- **Partly** (from the diagram): Owner authorizes? a PR is not approval (only a "yes" exit is drawn)
  > If merge authority is absent, preserve the ready PR and report that blocker; do not start another independent
  >
  > [`skills/create-pr.md:261`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L261)

  The gate is real, but the source defines what happens without authorization and the diagram draws no "no" path.

<details>
<summary>5 confirmed, with the supporting line</summary>

- **Confirmed**: With the owner's explicit authorization, the orchestrator squash-merges it onto main as one commit.
  > final head, and merge \*\*only with explicit authorization\*\* (a PR is not approval). A failed gate stays part of
  >
  > [`AGENTS.md:191`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L191)

- **Confirmed**: A PR is not approval.
  > PR creation is not merge authorization. In the default queue flow, the orchestrator keeps this task current until local and required hosted
  >
  > [`skills/create-pr.md:259`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L259)

- **Confirmed**: The squash merge uses --match-head-commit, so only the commit whose checks were read can land.
  > Merge exactly the commit whose checks you read, so a later push cannot slip in:
  >
  > [`skills/create-pr.md:280`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L280)

- **Confirmed**: Squash merge: One PR lands as one commit on main.
  > \*\*Merge by squash:\*\* one commit per PR on main, titled with the PR title; publication follows
  >
  > [`AGENTS.md:193`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L193)

- **Confirmed** (from the diagram): Fresh branch from updated main
  > the current task; never grow the branch with another feature to defer it. Confirm the actual merge and
  >
  > [`docs/agents-detail.md:599`](https://github.com/victusfate/scaffold/blob/main/docs/agents-detail.md#L599)

  "From updated main" is spelled out only in docs/agents-detail.md (next line: "cut a fresh branch from updated main"), not a listed source; AGENTS.md says only "cut a fresh branch".

</details>

## In the source, not shown in the flow

- Without merge authority the orchestrator preserves the ready PR, reports the blocker and starts no other task; the flow has no "not authorized" path.
  > If merge authority is absent, preserve the ready PR and report that blocker; do not start another independent
  >
  > [`skills/create-pr.md:261`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L261)

- When the diff adds a tool, script, skill or bin command, the PR body gets a Callable-unit checklist, and an unchecked box blocks merge.
  > \*\*Callable-unit gate:\*\* if the diff adds a tool, script, skill, or bin command, append this section to the body. An unchecked box blocks merge.
  >
  > [`skills/create-pr.md:217`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L217)

- Each auto-correct round has a scope limit: a fix over about 30 lines or architecturally significant stops and goes to the user.
  > \2. \*\*Scope check\*\* — if the fix needs more than \~30 lines across all files, or touches something architecturally significant, stop and report the diagnosis to the user. Do not guess at large changes.
  >
  > [`skills/create-pr.md:40`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L40)

- Before merging, the PR head is compared with the verified commit; if the head moved, pull and re-check instead of merging.
  > \[ "$(gh pr view &lt;pr&gt; --json headRefOid -q .headRefOid)" = "$sha" \] \|\| { echo "PR head moved; pull and re-check"; exit 1; }
  >
  > [`skills/create-pr.md:284`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L284)

- A repo with no local gate gets readiness UNVERIFIED, recorded in the PR body, and the PR still opens.
  > \- \`NO\_LOCAL\_GATE\` → record it in the status section (readiness = UNVERIFIED), proceed, and say so.
  >
  > [`skills/create-pr.md:81`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L81)

- The drafted title and body prose go through /deslop before the PR is created.
  > \*\*Prose check:\*\* run \`/deslop\` in edit mode on the drafted title and the body's
  >
  > [`skills/create-pr.md:204`](https://github.com/victusfate/scaffold/blob/main/skills/create-pr.md#L204)

- Roll-up jobs must be made to fail closed, and a local receipt lets hosted CI skip a check only where the local scope covers the hosted scope.
  > command's own exit, and make roll-up jobs fail closed (\`if: always()\` plus a guard). \*\*Handoffs live only on
  >
  > [`AGENTS.md:196`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L196)

- A failed gate stays part of the current task; it is not deferred by starting another feature.
  > final head, and merge \*\*only with explicit authorization\*\* (a PR is not approval). A failed gate stays part of
  >
  > [`AGENTS.md:191`](https://github.com/victusfate/scaffold/blob/main/AGENTS.md#L191)

## Glossary

- **make ci**: The local pre-merge gate: unit and heavy integration checks.
- **Critical changes**: Up to five path:line notes of what changed and what depends on it.
- **Squash merge**: One PR lands as one commit on main.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's agents take a task from branch to
a merged PR safely.
Read this page:
https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/pr-workflow.md
Scaffold: https://github.com/victusfate/scaffold

Questions worth asking:
- Why isn't a green merge button enough?
```
