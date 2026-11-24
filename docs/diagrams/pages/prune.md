[← Scaffold at a glance](system-map.md)

# Prune

How /prune runs every quality lens on a branch, then fixes the findings through the full feature chain instead of a one-shot patch.

```mermaid
flowchart LR
  n_audit["Audit"] --> n_design["Design doc"]
  n_design["Design doc"] --> n_prd["PRD"]
  n_prd["PRD"] --> n_tdd["TDD"]
  n_tdd["TDD"] --> n_pr["Pull request"]
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  classDef lane2 fill:#ddd6fe,stroke:#6d28d9,color:#1f2937
  class n_audit lane0
  class n_design,n_prd lane1
  class n_tdd,n_pr lane2
```

- [Audit](#audit): Run the correctness and structure reviews, read-only, and collect one findings table.
- [Design doc](#design-doc): Write the findings and how each kind will be fixed into design.md.
- [PRD](#prd): Turn the findings into user stories without re-interviewing.
- [TDD](#tdd): Build the fixes in slices, one group of fixes per slice, then refine.
- [Pull request](#pull-request): Open a PR whose body lists the findings and which IDs were addressed.

## Audit

Run the correctness and structure reviews, read-only, and collect one findings table.

- Correctness: /validate --effort max.
- Structure: the /simplify checklist, applied without auto-fix.
- Each finding is tagged [validate] or [quality].

## Design doc

Write the findings and how each kind will be fixed into design.md.

- Findings get IDs (F-01 and on) and are grouped by class, not handled one by one.
- Written to `docs/quality-<branch-short>/design.md` (the last segment of the branch name), committed, then /design-review auto-fixes it.

## PRD

Turn the findings into user stories without re-interviewing.

- Stories cite finding IDs.
- It names which fixes are risky enough to need tests.

## TDD

Build the fixes in slices, one group of fixes per slice, then refine.

Details: [TDD](tdd.md)

- /tdd runs /code-refiner when all slices pass.
- The review at the end of this step is the only pause.

## Pull request

Open a PR whose body lists the findings and which IDs were addressed.

Details: [PR workflow](pr-workflow.md)

**Where it breaks**

- At any step, stop, pause or just answer from the owner halts the run at once.

## Detailed flow

![Prune, detailed](../generated/prune.svg)

## Code walkthrough

/prune is a prose pipeline: skills/prune.md tells the agent to run the two reviews, write design.md and prd.md, then run /tdd and /create-pr. No script collects the findings table, assigns F-01 style IDs or checks that the PR body lists them. The code that exists is shared with other flows: scripts/check-quality-mechanical.sh covers the mechanical part of the structure review, the commit hook and package.json back the TDD phase, and scripts/compute-bump.ts, scripts/check-handoff.ts and the three PR workflows back the pull request.

Each excerpt is read from the repo when this page is built. The explanations were written by an agent; `npm test` fails when the lines they explain change.

### Audit: code

#### check-quality-mechanical.sh: pick the files, run the checks, exit

*Enforces the rule.* Chooses which files to check: the staged files with --staged, the paths given as arguments, or by default the source files that differ from main (git diff main...HEAD). It runs check_file on each. If any violation was counted it prints the total and exits 1.

```bash
# Resolve files: explicit args, staged files, or files changed vs main.
# A read loop rather than mapfile, so this runs on macOS's bash 3.2 (the hook
# ships to consumers' machines), and the loop guard keeps an empty set safe there.
SOURCE_RE='\.(js|mjs|ts|tsx|sh|py|rb|go)$'
FILES=()
collect() { while IFS= read -r f; do FILES+=("$f"); done < <(grep -E "$SOURCE_RE" || true); }
if [ "${1:-}" = "--staged" ]; then
  collect < <(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null)
elif [ $# -gt 0 ]; then
  FILES=("$@")
else
  collect < <(git diff main...HEAD --name-only 2>/dev/null)
fi

if [ ${#FILES[@]} -gt 0 ]; then
  for f in "${FILES[@]}"; do
    check_file "$f"
  done
fi

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "${VIOLATIONS} mechanical violation(s) found. Fix before creating a PR."
  exit 1
fi
```

[`scripts/check-quality-mechanical.sh:194-218`](https://github.com/victusfate/scaffold/blob/main/scripts/check-quality-mechanical.sh#L194-L218)

**Why it matters.** The audit looks at the current branch. With no arguments this script checks exactly the source files the branch changed against main. skills/prune.md does not call the script by name; it is the scripted form of the mechanical rules in the /simplify checklist, and the rest of that review is done by the agent.

**Methods and helpers used here**

<details>
<summary><code>check_file</code> · shell function · scripts/check-quality-mechanical.sh:46</summary>

Takes one file path and scans it, calling emit for each violation: more than 500 lines without a 'quality-ok: file-length' pragma, a bare integer of two or more digits outside a named constant, string literal, return/exit statement or pragma-covered line (this check is skipped for files whose name contains test or spec), and two or more consecutive comment lines that look like code. It returns 0 without checking anything when the path is not a regular file, is matched by .quality-ignore, or has '@generated' in its first five lines.

```bash
check_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  is_ignored "$file" && return 0
  local ext="${file##*.}"

  # Generated / machine-authored files are skipped whole — the same convention
  # ESLint and Prettier honor. A mechanical CODE-quality check has nothing to say
  # about machine-produced OUTPUT: e.g. a procedural geometry catalog is tens of
  # thousands of lines of raw vertex-coordinate arrays where every number is a
  # coordinate and "extract to a named constant" is meaningless. Mark such a file
  # with `@generated` in its first 5 lines. Use ONLY for genuinely generated/data
  # files — never to silence a lint on hand-maintained logic.
  if head -5 "$file" 2>/dev/null | grep -q '@generated'; then
    return 0
  fi

  # File length. A `quality-ok: file-length — <reason>` pragma anywhere in the file
  # (by convention on the first non-shebang line) blesses a genuinely cohesive file
  # that reads as one unit and would only be fragmented by a split. Like the
  # magic-number pragma, the keyword is the gate; the required reason is enforced at
  # review time, not parsed here. Commented-out-code has no such escape hatch.
  local count
  count=$(wc -l < "$file")
```

[`scripts/check-quality-mechanical.sh:46-69`](https://github.com/victusfate/scaffold/blob/main/scripts/check-quality-mechanical.sh#L46-L69) (first 24 lines shown)

</details>

#### check_file: the 500-line file length check

*Enforces the rule.* Counts the lines in the file with wc -l. If the count is over MAX_LINES (500) and the file has no "quality-ok: file-length" pragma, it emits a Readability/major violation with the file name. Each emit adds one to VIOLATIONS, which makes the script exit non-zero at the end.

```bash
  # File length. A `quality-ok: file-length — <reason>` pragma anywhere in the file
  # (by convention on the first non-shebang line) blesses a genuinely cohesive file
  # that reads as one unit and would only be fragmented by a split. Like the
  # magic-number pragma, the keyword is the gate; the required reason is enforced at
  # review time, not parsed here. Commented-out-code has no such escape hatch.
  local count
  count=$(wc -l < "$file")
  if [ "$count" -gt "$MAX_LINES" ] \
     && ! grep -Eq '(#|//)[[:space:]]*quality-ok:[[:space:]]*file-length' "$file"; then
    emit "${file}:${MAX_LINES} [Readability/major] file is ${count} lines — exceeds ${MAX_LINES}-line limit; split into cohesive modules (or add a 'quality-ok: file-length — <reason>' pragma if it is one cohesive unit)"
  fi
```

[`scripts/check-quality-mechanical.sh:63-73`](https://github.com/victusfate/scaffold/blob/main/scripts/check-quality-mechanical.sh#L63-L73)

**Why it matters.** File length is one of the rubric rules the structure review applies. This check gives the same answer every time, so a finding of this kind does not depend on the reviewer.

**Methods and helpers used here**

<details>
<summary><code>emit</code> · shell function · scripts/check-quality-mechanical.sh:16</summary>

Prints its first argument, a violation message, to stdout and adds one to the global VIOLATIONS counter. The script exits 1 at the end when that counter is above zero.

```bash
emit() { echo "$1"; VIOLATIONS=$((VIOLATIONS + 1)); }
```

[`scripts/check-quality-mechanical.sh:16`](https://github.com/victusfate/scaffold/blob/main/scripts/check-quality-mechanical.sh#L16)

</details>

### Design doc: code

No code here: The agent writes docs/quality-&lt;branch-short&gt;/design.md with the findings table and grouped decisions, commits it and runs /design-review, all by hand from the template in the skill.

### PRD: code

No code here: The agent runs /to-prd to turn the finding classes into user stories that cite finding IDs and to name which fixes need tests; nothing checks the IDs.

### TDD: code

#### test-tdd-rubric.sh: skills/tdd.md must keep its rubric steps

*Test that pins it.* Greps skills/tdd.md for six patterns: the @-include of lib/code-quality-rubric.md, the rubric being loaded before GREEN, REFACTOR as a confirmation pass, the per-slice score table, the 30-line fix threshold, and the surface-to-user rule. It counts passes and failures and exits non-zero if any pattern is missing. npm test runs it through test:shell.

```bash
echo "TDD rubric integration check: $TDD"
check "@-include of rubric present"           "@\.\./lib/code-quality-rubric"
check "rubric loaded before GREEN"            "rubric|quality.*before|generative"
check "REFACTOR as confirmation framing"      "confirm|confirmation|already"
check "per-slice score display"               "score.*slice|slice.*score|dimension.*score|Quality Scores"
check "auto-fix threshold stated"             "30 line|30-line|auto.fix"
check "surface threshold stated"              "surface|block.*arch|architectural"
echo ""; echo "$PASS passed, $FAIL failed."; [ "$FAIL" -eq 0 ]
```

[`scripts/test-tdd-rubric.sh:15-22`](https://github.com/victusfate/scaffold/blob/main/scripts/test-tdd-rubric.sh#L15-L22)

**Why it matters.** Phase 4 hands the fixes to /tdd. This test keeps the rubric scoring and the 30-line fix rule in the skill text the agent follows there.

**Methods and helpers used here**

<details>
<summary><code>check</code> · shell function · scripts/test-tdd-rubric.sh:6</summary>

Takes a description and an extended-regex pattern and greps the file named by TDD (skills/tdd.md) for the pattern, with grep errors suppressed. On a match it prints the description with a check mark and increments the global PASS counter; otherwise it prints it with a cross mark and increments FAIL.

```bash
check() {
  local desc="$1"; local pattern="$2"
  if grep -qE "$pattern" "$TDD" 2>/dev/null; then
    echo "  ✓ $desc"; PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"; FAIL=$((FAIL + 1))
  fi
}
```

[`scripts/test-tdd-rubric.sh:6-13`](https://github.com/victusfate/scaffold/blob/main/scripts/test-tdd-rubric.sh#L6-L13)

</details>

#### pre-commit hook: mechanical check, typecheck, skill routing gate

*Enforces the rule.* Runs on every git commit once core.hooksPath points at .githooks. It runs the mechanical quality check on the staged files, then tsc --noEmit if a tsconfig.json exists, then check-resolvable.ts and the skills-doc freshness check. The script runs under set -eu, so the first failing step aborts the commit.

```bash
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

[`.githooks/pre-commit:28-41`](https://github.com/victusfate/scaffold/blob/main/.githooks/pre-commit#L28-L41)

**Why it matters.** Each fix group is a slice with its own commits. With the hook enabled every commit must pass the mechanical check and the typecheck, so a fix cannot add a new mechanical violation.

**Methods and helpers used here**

<details>
<summary><code>staged</code> · shell function · .githooks/pre-commit:17</summary>

Prints the NUL-separated paths of files staged in the git index as added, copied, modified or renamed, limited to the pathspecs passed as arguments. It changes nothing; the output is meant to be piped to xargs -0.

Comment in the source: Linters read the working-tree copy, so a partially staged file is checked as edited.

```bash
staged() { git diff --cached --name-only --diff-filter=ACMR -z -- "$@"; }
```

[`.githooks/pre-commit:17`](https://github.com/victusfate/scaffold/blob/main/.githooks/pre-commit#L17)

</details>

#### package.json: what "the full suite" runs

*Carries out the step.* npm test chains four scripts. test:node runs every *.test.ts under scripts/, tools/ and lib/ with node --test. test:tools runs each tool's own test file, test:shell runs every scripts/test-*.sh, and test:checks runs the repo checks. test:integration is separate and is not part of npm test.

```json
    "test": "npm run test:node && npm run test:tools && npm run test:shell && npm run test:checks",
    "test:node": "node --test --test-concurrency=1 'scripts/**/*.test.ts' 'tools/**/*.test.ts' 'lib/**/*.test.ts'",
    "test:tools": "tools/hoist-skill/test && tools/sync/test && node tools/linter-setup/test && node tools/dependency-watch/test",
    "test:shell": "for f in scripts/test-*.sh; do [ \"$f\" = scripts/test-read-once.sh ] || bash \"$f\" || exit 1; done",
    "test:checks": "node scripts/check-resolvable.ts --strict && node scripts/update-skills-doc.ts --check && node scripts/check-agents-detail.ts && node scripts/check-handoff.ts && node scripts/check-guidelines.ts && node scripts/render-explorer-pages.ts --check && node scripts/render-diagrams.ts --check",
    "test:integration": "RUN_INTEGRATION=1 tools/hoist-skill/test-integration && RUN_INTEGRATION=1 tools/sync/test-integration && RUN_INTEGRATION=1 tools/linter-setup/test-integration",
```

[`package.json:9-14`](https://github.com/victusfate/scaffold/blob/main/package.json#L9-L14)

**Why it matters.** /tdd runs /code-refiner only when the full suite is green. These scripts define that suite.

### Pull request: code

#### computeBump: next version from the branch commit messages

*Carries out the step.* Walks the commit lines. BREAKING CHANGE or a feat!/fix! prefix sets a major bump and stops. A feat: line sets minor, and a fix: line sets patch if nothing higher was seen. With no such line it returns "none"; otherwise it splits the current version and returns the next one.

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

**Why it matters.** /create-pr Step 3 pipes the branch commits into this script to bump package.json before opening the PR. A prune branch with only refactor, test and docs commits gets "none" and no bump.

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

#### test-create-pr-gate.sh: quality gate comes before the PR body

*Test that pins it.* Finds the line number of the "Step 5" heading and of the "Step 6" heading in skills/create-pr.md. It passes only if both exist and Step 5 comes first. Earlier lines in the same file assert that the skill mentions the score table, the 10/10 threshold and the override syntax.

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

**Why it matters.** The PR step relies on /create-pr scoring every file 10/10 before it drafts the body. That gate is run by the agent; this test only keeps it in the skill and in the right order.

**Methods and helpers used here**

<details>
<summary><code>fail</code> · shell function · scripts/test-create-pr-gate.sh:5</summary>

Takes a description, prints it to stdout prefixed with a cross mark, and increments the script's global FAIL counter. It does not exit the script.

```bash
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }
```

[`scripts/test-create-pr-gate.sh:5`](https://github.com/victusfate/scaffold/blob/main/scripts/test-create-pr-gate.sh#L5)

</details>

#### CI job "verify": npm test on every PR to main

*Enforces the rule.* On a pull request to main the job checks out the code, installs the Node version named in .node-version, runs npm ci, and then runs npm test. A failing test fails the job.

```yaml
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

[`.github/workflows/ci.yml:12-24`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/ci.yml#L12-L24)

**Why it matters.** Runs the full suite on the prune PR. The fixes are refactors, so this is the hosted check that behavior did not change.

#### Quality Gate workflow: mechanical checks on all tracked source

*Enforces the rule.* On every pull request the job lists all tracked js, mjs, ts, tsx, sh, py, rb and go files with git ls-files. It passes the whole list to check-quality-mechanical.sh. Any violation makes the script exit 1, which fails the job.

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

**Why it matters.** Re-checks the mechanical rules over every tracked source file on the PR. A prune run that left a 500-line file or commented-out code fails here.

#### Security scan: list changed files and run gitleaks on them

*Enforces the rule.* Lists the files the PR adds or changes by diffing the merge commit against its first parent. If there are any, it downloads the pinned gitleaks release, copies the changed files into a temp folder and scans that folder for secrets. A finding adds gitleaks to the failed list, and a later step exits 1 when that list is not empty.

```yaml
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

[`.github/workflows/security.yml:46-59`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/security.yml#L46-L59)

**Why it matters.** /create-pr Step 2c runs nothing locally and relies on this check. It must pass before the PR can merge.

#### check-handoff.ts --pre-merge: no handoff file on the head to merge

*Enforces the rule.* preMerge returns an error when .pause/handoff.md still exists, with the git rm command that clears it. The CLI block below it picks preMerge when --pre-merge is passed, prints each error, and exits 1 if there is one.

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

**Why it matters.** /create-pr tells the orchestrator to remove .pause/handoff.md and run this before merging. It stops a handoff file from reaching main with the prune PR.

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

## Checked against the source

The prune flow matches skills/prune.md on every claim checked: the five phases, their order, the tags, the slug rule and the single pause all have matching text. Nothing is contradicted or unsupported. What it leaves out is small: the slug is announced first, design.md has scope and edge-case sections, the PRD maps finding IDs to changes, and each phase can be resumed on its own.

| Confirmed | Partly | Not found | Contradicted | In the source, not shown in the flow | Code excerpts |
|---:|---:|---:|---:|---:|---:|
| 26 | 0 | 0 | 0 | 4 | 11 |

An agent judged each claim against the source; each quote is found in its file when this page is built.

### Audit: checks

<details>
<summary>8 confirmed, with the supporting line</summary>

- **Confirmed**: Run the correctness and structure reviews, read-only, and collect one findings table.
  > Collect findings only — nothing is fixed until the chain's TDD phase.
  >
  > [`skills/prune.md:21`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L21)

- **Confirmed**: Correctness: /validate --effort max.
  > \1. \*\*\`/validate --effort max\`\*\* (no \`--fix\` flag — its default prints
  >
  > [`skills/prune.md:23`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L23)

- **Confirmed**: Structure: the /simplify checklist, applied without auto-fix.
  > diff-economy lens) as a read-only audit. Do not invoke the skill itself:
  >
  > [`skills/prune.md:27`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L27)

- **Confirmed**: Each finding is tagged [validate] or [quality].
  > Produce a consolidated findings table with source tags: \`\[validate\]\`, \`\[quality\]\`.
  >
  > [`skills/prune.md:30`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L30)

- **Confirmed**: Findings collected (payload: findings table)
  > Produce a consolidated findings table with source tags: \`\[validate\]\`, \`\[quality\]\`.
  >
  > [`skills/prune.md:30`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L30)

- **Confirmed**: Lens: One review angle: correctness or structure.
  > Run every quality lens on the current branch — correctness validation and structural quality
  >
  > [`skills/prune.md:3`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L3)

- **Confirmed** (from the diagram): Legend, validate: review for correctness bugs and weakened tests
  > correctness bugs + the test-integrity check (a test weakened to pass is a
  >
  > [`skills/code-refiner.md:31`](https://github.com/victusfate/scaffold/blob/main/skills/code-refiner.md#L31)

- **Confirmed** (from the diagram): Legend, simplify: review for structure: reuse, clarity, altitude
  > dimensions plus reuse, simplification, efficiency, altitude, and the
  >
  > [`skills/prune.md:26`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L26)

</details>

### Design doc: checks

<details>
<summary>4 confirmed, with the supporting line</summary>

- **Confirmed**: Write the findings and how each kind will be fixed into design.md.
  > (how each finding class will be addressed — group related findings, not one-by-one)
  >
  > [`skills/prune.md:53`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L53)

- **Confirmed**: Findings get IDs (F-01 and on) and are grouped by class, not handled one by one.
  > \| F-01 \| \[validate\] \| … \| … \| high \|
  >
  > [`skills/prune.md:50`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L50)

- **Confirmed**: Written to `docs/quality-<branch-short>/design.md` (the last segment of the branch name), committed, then /design-review auto-fixes it.
  > Default: \`quality-&lt;branch-short&gt;\` where \`&lt;branch-short&gt;\` is the last path segment of the current branch name.
  >
  > [`skills/prune.md:36`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L36)

- **Confirmed**: Decisions written (payload: design.md)
  > Run \`/design-review\` in auto-fix mode. Then proceed immediately to Phase 3.
  >
  > [`skills/prune.md:65`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L65)

</details>

### PRD: checks

<details>
<summary>6 confirmed, with the supporting line</summary>

- **Confirmed**: Turn the findings into user stories without re-interviewing.
  > Run \`/to-prd\`. Do not re-interview — synthesize from the design and findings.
  >
  > [`skills/prune.md:71`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L71)

- **Confirmed**: Stories cite finding IDs.
  > \- User Stories: each class of fix as a story, referencing finding IDs.
  >
  > [`skills/prune.md:73`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L73)

- **Confirmed**: It names which fixes are risky enough to need tests.
  > \- Testing Decisions: identify which fixes are risky enough to require tests.
  >
  > [`skills/prune.md:75`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L75)

- **Confirmed**: Stories cite findings (payload: prd.md)
  > Run \`/tdd\` from \`prd.md\`.
  >
  > [`skills/prune.md:85`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L85)

- **Confirmed**: PRD: Product requirements document: the problem, the solution and the user stories.
  > The solution from the user's perspective.
  >
  > [`skills/to-prd.md:27`](https://github.com/victusfate/scaffold/blob/main/skills/to-prd.md#L27)

- **Confirmed** (from the diagram): Commit prd.md
  > Commit: \`docs(&lt;slug&gt;): PRD\`
  >
  > [`skills/prune.md:77`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L77)

</details>

### TDD: checks

<details>
<summary>5 confirmed, with the supporting line</summary>

- **Confirmed**: Build the fixes in slices, one group of fixes per slice, then refine.
  > Each vertical slice should correspond to one cohesive group of fixes
  >
  > [`skills/prune.md:85`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L85)

- **Confirmed**: /tdd runs /code-refiner when all slices pass.
  > \`/tdd\` runs \`/code-refiner\` (validate + simplify) when all slices pass. Then proceed to Phase 5.
  >
  > [`skills/prune.md:87`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L87)

- **Confirmed**: The review at the end of this step is the only pause.
  > Do not pause between phases. The only pause is at the end of Phase 4 (feature-chain review step).
  >
  > [`skills/prune.md:15`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L15)

- **Confirmed**: All slices green, refined (payload: commits)
  > \`/tdd\` runs \`/code-refiner\` (validate + simplify) when all slices pass. Then proceed to Phase 5.
  >
  > [`skills/prune.md:87`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L87)

- **Confirmed** (from the diagram): Legend, code-refiner: validate + simplify review, then one fix pass
  > \*\*in parallel\*\*, merge their findings, then apply every fix in a \*\*single serial
  >
  > [`skills/code-refiner.md:5`](https://github.com/victusfate/scaffold/blob/main/skills/code-refiner.md#L5)

</details>

### Pull request: checks

<details>
<summary>3 confirmed, with the supporting line</summary>

- **Confirmed**: Open a PR whose body lists the findings and which IDs were addressed.
  > The PR body includes the findings summary and lists which finding IDs were addressed.
  >
  > [`skills/prune.md:93`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L93)

- **Confirmed**: At any step, stop, pause or just answer from the owner halts the run at once.
  > If the user says "stop", "pause", or "just answer" — stop immediately.
  >
  > [`skills/prune.md:99`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L99)

- **Confirmed** (from the diagram): /create-pr
  > Run \`/create-pr\`. The PR body includes the findings summary
  >
  > [`skills/prune.md:93`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L93)

</details>

## In the source, not shown in the flow

- The slug is stated before design.md is written, and quality-&lt;branch-short&gt; is only the default.
  > State the slug before writing. Default: \`quality-&lt;branch-short&gt;\` where \`&lt;branch-short&gt;\` is the last path segment of the current branch name.
  >
  > [`skills/prune.md:36`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L36)

- design.md also carries a Scope (in/out) section and Edge Cases the fixes must not break; the flow mentions only findings and decisions.
  > (anything fragile the fixes must not break)
  >
  > [`skills/prune.md:60`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L60)

- The PRD's Implementation Decisions map each finding ID to a concrete change.
  > \- Implementation Decisions: map finding IDs to concrete changes.
  >
  > [`skills/prune.md:74`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L74)

- Each phase can be resumed on its own (re-run the audit, edit design.md then /design-review, /to-prd, /tdd, /create-pr); the flow shows stopping but not resuming.
  > \- Design: edit \`design.md\` directly, then re-run \`/design-review\`
  >
  > [`skills/prune.md:104`](https://github.com/victusfate/scaffold/blob/main/skills/prune.md#L104)

## Glossary

- **Lens**: One review angle: correctness or structure.
- **PRD**: Product requirements document: the problem, the solution and the user stories.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's /prune skill turns a quality audit
into a planned, tested cleanup PR.
Read this page:
https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/prune.md
Scaffold: https://github.com/victusfate/scaffold

Questions worth asking:
- When is /prune worth it instead of running /simplify alone?
```
