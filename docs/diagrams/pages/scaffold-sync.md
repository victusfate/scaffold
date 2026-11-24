[← Scaffold at a glance](system-map.md)

# Scaffold sync

How shared rules and skills flow from the scaffold repo into project repos, and how a project's generic fix flows back up.

```mermaid
flowchart LR
  n_bootstrap["Bootstrap"] --> n_down["Sync down"]
  n_down["Sync down"] --> n_upstream["Upstream"]
  n_upstream["Upstream"] --> n_pr["Scaffold PR"]
  n_pr["Scaffold PR"] --> n_back["Sync back"]
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  class n_bootstrap,n_down,n_back lane0
  class n_upstream,n_pr lane1
```

- [Bootstrap](#bootstrap): The first time, install the sync script, then run it once the user confirms.
- [Sync down](#sync-down): /sync-scaffold merges scaffold's files into the project on the current branch.
- [Upstream](#upstream): /upstream splits a project change into its universal half and moves that half into scaffold.
- [Scaffold PR](#scaffold-pr): Open a scaffold PR that says why the change is universal, and merge it only if authorized.
- [Sync back](#sync-back): Run /sync-scaffold again on a project branch to pull the merged change back in.

## Bootstrap

The first time, install the sync script, then run it once the user confirms.

Details: [/sync-scaffold skill](../../../skills/sync-scaffold.md)

- If bin/sync-from-scaffold.sh is missing, a curl of bootstrap.sh installs the script only.

## Sync down

/sync-scaffold merges scaffold's files into the project on the current branch.

Details: [/sync-scaffold skill](../../../skills/sync-scaffold.md)

- The manifest, scaffold-files.txt, lists the files scaffold ships.
- A file that differs, has a base and has no uncommitted edits gets a 3-way merge from the last synced commit.
- When a merge can't be automatic
  - No base and the file differs: the incoming copy is saved as a .scaffold-new sidecar to review.
  - Paths in .scaffold-keep are skipped.
  - Conflict markers: resolve, commit, re-run with --mark-resolved.

**Where it breaks**

- A sidecar is not applied: the original file is unchanged until someone diffs and merges it.

## Upstream

/upstream splits a project change into its universal half and moves that half into scaffold.

Details: [/upstream skill](../../../skills/upstream.md)

- Work in a scaffold worktree off origin/main, never its main checkout.
- Make the change the scaffold way; a new skill needs its wrappers, RESOLVER entry, manifest line and test.
- npm test and eslint (0 errors) must pass, plus typecheck when TypeScript changed.

## Scaffold PR

Open a scaffold PR that says why the change is universal, and merge it only if authorized.

Details: [PR workflow](pr-workflow.md)

- The PR names the consumer that needed it.
- Read the real check conclusions; a skipped check is not a pass.
- Remove the worktree after the merge.

## Sync back

Run /sync-scaffold again on a project branch to pull the merged change back in.

Details: [/upstream skill](../../../skills/upstream.md)

- Keep .scaffold-keep paths and merge diverged files.
- Put the project-specific half in the project's own policy file.
- Then the project's own gates, PR and authorized merge.
- Another way out: /hoist-skill
  - Exports chosen skills into another repo in a target harness's format.
  - .sync/hoisted records the name, harness and pinned ref; --from-manifest replays it.

## Detailed flow

![Scaffold sync, detailed](../generated/scaffold-sync.svg)

## Code walkthrough

The downward half is real code: bin/bootstrap.sh installs the sync script and bin/sync-from-scaffold.sh does the manifest read, 3-way merge, sidecars, keep list and SHA bookkeeping, with an optional workflow that runs it and opens a PR. The upward half (/upstream) is agent-followed prose; code only enforces its edges, through the manifest checks in scripts/resolver-phases.ts and the CI jobs. /hoist-skill is implemented in tools/hoist-skill/.

Each excerpt is read from the repo when this page is built. The explanations were written by an agent; `npm test` fails when the lines they explain change.

### Bootstrap: code

#### bootstrap: add the remote and install the sync script

*Carries out the step.* It adds a git remote named scaffold if there is none and fetches its main branch. It creates bin/ and writes the sync script from scaffold/main using `git show`. It marks the script executable.

```bash
# Add scaffold remote and fetch
if ! git remote get-url scaffold &>/dev/null; then
  git remote add scaffold "$SCAFFOLD_URL"
  echo "Added remote 'scaffold' → $SCAFFOLD_URL"
fi
git fetch scaffold main --depth=1 --quiet

# Install the sync script using git — no curl needed from here on
mkdir -p bin
git show scaffold/main:bin/sync-from-scaffold.sh > bin/sync-from-scaffold.sh
chmod +x bin/sync-from-scaffold.sh
echo "Installed bin/sync-from-scaffold.sh"
```

[`bin/bootstrap.sh:37-48`](https://github.com/victusfate/scaffold/blob/main/bin/bootstrap.sh#L37-L48)

**Why it matters.** This is all the first-time curl does to the repo: one new script, no tracked file changed. Later syncs need only git.

#### bootstrap: run the sync only when asked

*Enforces the rule.* If --run was passed it runs the sync script at once. Otherwise it prints that setup is complete and shows the command for the first sync. It also mentions the optional workflow install.

```bash
if [ "$RUN_SYNC" -eq 1 ]; then
  echo "Running first sync..."
  bash bin/sync-from-scaffold.sh
else
  echo "Setup complete. No tracked files were changed."
  echo ""
  echo "Run the first sync when ready:"
  echo "  bash bin/sync-from-scaffold.sh"
  echo ""
  echo "Or re-run bootstrap with --run to sync immediately:"
  echo "  bash bin/bootstrap.sh --run"
  if [ "$WITH_WORKFLOW" -eq 0 ]; then
    echo ""
    echo "To also install the automated sync workflow:"
    echo "  bash bin/bootstrap.sh --with-workflow"
  fi
fi
```

[`bin/bootstrap.sh:59-75`](https://github.com/victusfate/scaffold/blob/main/bin/bootstrap.sh#L59-L75)

**Why it matters.** The first sync waits for the user to confirm. By default the script stops after installing, so nothing is merged into the project unasked.

### Sync down: code

#### Read the manifest from scaffold/main

*Carries out the step.* It reads .github/scaffold-files.txt from the fetched scaffold/main. If that read fails it prints an error and exits before any write. It then loads each non-empty line into the list of files to sync.

```bash
# Read manifest from scaffold — a failed read must abort before any writes
# (a process-substitution failure is invisible to set -e and would otherwise
# no-op the loop and still save the SHA, silently marking us synced)
if ! manifest=$(git show scaffold/main:.github/scaffold-files.txt 2>/dev/null); then
  echo "error: could not read manifest .github/scaffold-files.txt from scaffold/main" >&2
  exit 1
fi
files=()
while IFS= read -r line; do
  [[ -n "$line" ]] && files+=("$line")
done <<< "$manifest"
```

[`bin/sync-from-scaffold.sh:114-124`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L114-L124)

**Why it matters.** The manifest decides which files scaffold ships. Aborting on a failed read stops an empty list from being recorded as a successful sync.

#### in_keep_list: match a path against .scaffold-keep

*Enforces the rule.* It returns 'no match' when the repo has no .scaffold-keep file. Otherwise it reads the file line by line, skipping blank lines and comments. It returns a match as soon as the path fits one pattern as a shell glob.

```bash
# Returns 0 if $1 matches any pattern in .scaffold-keep, 1 otherwise.
in_keep_list() {
  local file="$1" pattern
  [ -f ".scaffold-keep" ] || return 1
  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    # shellcheck disable=SC2053
    [[ "$file" == $pattern ]] && return 0
  done < ".scaffold-keep"
  return 1
}
```

[`bin/sync-from-scaffold.sh:155-165`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L155-L165)

**Why it matters.** Paths the project owns are skipped on every sync, even new ones. Without this a sync would overwrite files the project chose to keep.

#### sync_file: 3-way merge, or a sidecar when there is no base

*Carries out the step.* When a last synced SHA exists and had this file, it writes three temp copies: the local file, the file at the last SHA, and the file on scaffold/main. `git merge-file` merges them; a clean result replaces the file, a conflict writes the marked-up result and records the file as a conflict. With no base, the incoming copy is written to &lt;file&gt;.scaffold-new and the original is left alone.

```bash
  # Three-way merge using last synced SHA as base
  if [ -n "$last_sha" ] && git cat-file -e "${last_sha}:${file}" 2>/dev/null; then
    ours=$(mktemp); base=$(mktemp); theirs=$(mktemp); merged=$(mktemp)
    cp "$file" "$ours"
    git show "${last_sha}:${file}" > "$base"
    git show "scaffold/main:${file}" > "$theirs"

    # Merge into a scratch file so --dry-run can preview without touching $file.
    if git merge-file -p "$ours" "$base" "$theirs" > "$merged" 2>/dev/null; then
      [ "$DRY_RUN" = 1 ] || cp "$merged" "$file"
      updated+=("M $file")
    else
      # non-zero exit means conflicts; $merged holds the marked-up content
      [ "$DRY_RUN" = 1 ] || cp "$merged" "$file"
      conflicts+=("$file")
    fi
    rm -f "$ours" "$base" "$theirs" "$merged"
    ours=''; base=''; theirs=''
  else
    # No base SHA — don't overwrite; save sidecar for deliberate review
    [ "$DRY_RUN" = 1 ] || git show "scaffold/main:${file}" > "${file}.scaffold-new"
    review+=("$file  →  ${file}.scaffold-new")
  fi
```

[`bin/sync-from-scaffold.sh:205-227`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L205-L227)

**Why it matters.** This is the core of sync down. The base makes local edits survive a merge; the sidecar avoids a silent first-sync overwrite.

#### Save the synced SHA only on a clean sync

*Enforces the rule.* After all files are processed it checks three things: this is not a dry run, there are no conflicts, and there are no sidecars pending review. Only then does it write scaffold's commit SHA to .github/scaffold-sync-sha.

```bash
# Save SHA only when there are no unresolved conflicts or pending reviews
# (and never on a dry run).
if [ "$DRY_RUN" != 1 ] && [ ${#conflicts[@]} -eq 0 ] && [ ${#review[@]} -eq 0 ]; then
  mkdir -p "$(dirname "$SHA_FILE")"
  echo "$current_sha" > "$SHA_FILE"
fi
```

[`bin/sync-from-scaffold.sh:322-327`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L322-L327)

**Why it matters.** The saved SHA is the merge base for the next sync. Holding it back while conflicts or sidecars remain means a re-run still sees the unfinished files.

#### Workflow: run the sync and open a PR

*Carries out the step.* On manual dispatch the job runs the sync script and records whether the tree changed. If it did, it commits everything on a branch named chore/sync-scaffold-guidance and pushes it. It opens a PR unless one for that branch is already open.

```yaml
      - name: Sync from scaffold
        id: sync
        run: |
          bash bin/sync-from-scaffold.sh
          if git diff --quiet && git diff --staged --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
          else
            echo "changed=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Open PR
        if: steps.sync.outputs.changed == 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          gh auth setup-git
          git checkout -b chore/sync-scaffold-guidance
          git add -A
          git commit -m "chore: sync agent guidance from scaffold"
          git push -u origin chore/sync-scaffold-guidance
          existing=$(gh pr list --head "chore/sync-scaffold-guidance" --state open --json number --jq '.[0].number' 2>/dev/null || true)
          if [ -n "$existing" ]; then
            echo "PR already open (#$existing)"
          else
            gh pr create \
              --title "chore: sync agent guidance from scaffold" \
              --body "Automated sync from [victusfate/scaffold](https://github.com/victusfate/scaffold). Review the diff before merging — any conflicts have markers and need manual resolution." \
              --label dependencies
          fi
```

[`.github/workflows/sync-scaffold.yml:20-50`](https://github.com/victusfate/scaffold/blob/main/.github/workflows/sync-scaffold.yml#L20-L50)

**Why it matters.** This is the optional hands-off form of sync down, installed by bootstrap --with-workflow. It still lands through a PR, so a person reviews the diff.

### Upstream: code

#### phaseScaffold: every skill path must be in the manifest

*Enforces the rule.* It fails if the manifest file is missing. For each row in the skill resolver table it fails when the skill's path is not listed in the manifest. It warns if the resolver table or the check script itself is not listed.

```ts
export function phaseScaffold(rows: ResolverRow[], { fail, warn, MANIFEST, listedInManifest, rel }: PhaseCtx): void {
  if (!existsSync(MANIFEST)) { fail('Scaffold', `manifest not found at ${rel(MANIFEST)}`); return; }
  for (const r of rows) {
    if (!listedInManifest(r.path))
      fail('Scaffold', `'${r.name}' path ${r.path} not in scaffold manifest — won't sync downstream`);
  }
  for (const p of ['.claude/skills/RESOLVER.md', 'scripts/check-resolvable.ts']) {
    if (!listedInManifest(p)) warn('Scaffold', `${p} not in scaffold manifest — consider adding it`);
  }
}
```

[`scripts/resolver-phases.ts:202-211`](https://github.com/victusfate/scaffold/blob/main/scripts/resolver-phases.ts#L202-L211)

**Why it matters.** The 'scaffold way' includes adding new files to the manifest. Without this check a new skill could merge into scaffold and never reach a consumer.

**Methods and helpers used here**

<details>
<summary><code>PhaseCtx</code> · interface · scripts/resolver-phases.ts:12</summary>

The shared context handed to every resolver check phase: the fail and warn reporter functions, a function that makes a path repo-relative, the repo root and the skill, Cursor, Antigravity, manifest and internal-list paths, the STRICT flag, the skill directories on disk, the set of bundled skills, the tracked files, the manifest entries, and a function that tests whether a path is listed in the manifest.

Comment in the source: Shared context passed to every phase. Each phase destructures the subset it needs; collecting them in one type keeps the call sites in check-resolvable.ts honest about what each phase consumes.

```ts
export interface PhaseCtx {
  fail: Reporter;
  warn: Reporter;
  rel: (p: string) => string;
  ROOT: string;
  SKILLS_DIR: string;
  CURSOR_RULES: string;
  ANTIGRAVITY_SKILLS: string;
  ANTIGRAVITY_WORKFLOWS: string;
  MANIFEST: string;
  INTERNAL: string;
  STRICT: boolean;
  skillDirs: string[];
  bundledSkills: Set<string>;
  trackedFiles: string[];
  manifestSet: Set<string>;
  listedInManifest: (p: string) => boolean;
}
```

[`scripts/resolver-phases.ts:12-29`](https://github.com/victusfate/scaffold/blob/main/scripts/resolver-phases.ts#L12-L29)

</details>

<details>
<summary><code>ResolverRow</code> · interface · tools/lib/resolver-parse.ts:4</summary>

One parsed row of the RESOLVER.md skills table: the skill name, the raw regex cell (backticks kept), the path to the skill's canonical file, and the purpose text. parseResolverRows returns these.

```ts
export interface ResolverRow {
  name: string;
  regexCell: string;
  path: string;
  purpose: string;
}
```

[`tools/lib/resolver-parse.ts:4-9`](https://github.com/victusfate/scaffold/blob/main/tools/lib/resolver-parse.ts#L4-L9)

</details>

#### phaseManifestCompleteness: every tracked file is shipped or held back

*Enforces the rule.* It runs only in scaffold, where the internal list exists. Every tracked file that is in neither the manifest nor the internal list is an error. Every manifest entry that is not tracked, or is also internal, is an error.

```ts
export function phaseManifestCompleteness(_rows: ResolverRow[], { fail, MANIFEST, INTERNAL, manifestSet, trackedFiles, rel }: PhaseCtx): void {
  if (!existsSync(INTERNAL)) return; // not the scaffold repo — nothing to guard
  if (!existsSync(MANIFEST)) { fail('Manifest', `manifest not found at ${rel(MANIFEST)}`); return; }

  const patterns = readFileSync(INTERNAL, 'utf8')
    .split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
  const isInternal = compileIgnore(patterns);
  const tracked = new Set(trackedFiles);

  for (const [top, files] of groupByTopDir(trackedFiles.filter(f => !manifestSet.has(f) && !isInternal(f)))) {
    if (files.length > 1) // only a directory key can hold more than one file
      fail('Manifest', `${files.length} tracked files under ${top} are neither shipped nor held back — add \`${top}\` to ${rel(INTERNAL)} to hold back the directory, or list each file in ${rel(MANIFEST)}`);
    else for (const f of files)
      fail('Manifest', `${f} is tracked but neither shipped (${rel(MANIFEST)}) nor held back (${rel(INTERNAL)}) — add it to one`);
  }
  for (const p of manifestSet) {
    if (!tracked.has(p))
      fail('Manifest', `${rel(MANIFEST)} lists ${p}, which is not a tracked file — remove or fix it`);
    else if (isInternal(p))
      fail('Manifest', `${p} is in both ${rel(MANIFEST)} and ${rel(INTERNAL)} — a file can't be shipped and held back`);
  }
}
```

[`scripts/resolver-phases.ts:235-256`](https://github.com/victusfate/scaffold/blob/main/scripts/resolver-phases.ts#L235-L256)

**Why it matters.** A script or tool added upstream must be classified before the gates pass. This closes the 'added a file but forgot the manifest' gap.

**Methods and helpers used here**

<details>
<summary><code>PhaseCtx</code> · interface · scripts/resolver-phases.ts:12</summary>

The shared context handed to every resolver check phase: the fail and warn reporter functions, a function that makes a path repo-relative, the repo root and the skill, Cursor, Antigravity, manifest and internal-list paths, the STRICT flag, the skill directories on disk, the set of bundled skills, the tracked files, the manifest entries, and a function that tests whether a path is listed in the manifest.

Comment in the source: Shared context passed to every phase. Each phase destructures the subset it needs; collecting them in one type keeps the call sites in check-resolvable.ts honest about what each phase consumes.

```ts
export interface PhaseCtx {
  fail: Reporter;
  warn: Reporter;
  rel: (p: string) => string;
  ROOT: string;
  SKILLS_DIR: string;
  CURSOR_RULES: string;
  ANTIGRAVITY_SKILLS: string;
  ANTIGRAVITY_WORKFLOWS: string;
  MANIFEST: string;
  INTERNAL: string;
  STRICT: boolean;
  skillDirs: string[];
  bundledSkills: Set<string>;
  trackedFiles: string[];
  manifestSet: Set<string>;
  listedInManifest: (p: string) => boolean;
}
```

[`scripts/resolver-phases.ts:12-29`](https://github.com/victusfate/scaffold/blob/main/scripts/resolver-phases.ts#L12-L29)

</details>

<details>
<summary><code>compileIgnore</code> · const · scripts/resolver-phases.ts:213</summary>

Takes a list of path patterns and returns a function that tests whether a repo-relative path matches any of them. A pattern containing `*` is matched as a whole-path glob; any other pattern matches that exact path or anything under it as a directory. It is the same function as compileKeepMatcher from tools/lib/safe-write.ts.

```ts
const compileIgnore = compileKeepMatcher;
```

[`scripts/resolver-phases.ts:213`](https://github.com/victusfate/scaffold/blob/main/scripts/resolver-phases.ts#L213)

</details>

<details>
<summary><code>groupByTopDir</code> · function · scripts/resolver-phases.ts:218</summary>

Takes a list of repo-relative file paths and returns a Map that groups them by their first directory segment with a trailing slash (for example `packages/`). A file at the repo root is keyed by its own name.

Comment in the source: Unclassified files keyed by top-level directory (`packages/`), or by the file itself at the root: a new directory of many files gets one error naming the line that classifies it, not one error per file.

```ts
function groupByTopDir(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const top = f.includes('/') ? f.slice(0, f.indexOf('/') + 1) : f;
    const list = groups.get(top);
    if (list) list.push(f); else groups.set(top, [f]);
  }
  return groups;
}
```

[`scripts/resolver-phases.ts:218-226`](https://github.com/victusfate/scaffold/blob/main/scripts/resolver-phases.ts#L218-L226)

</details>

<details>
<summary><code>ResolverRow</code> · interface · tools/lib/resolver-parse.ts:4</summary>

One parsed row of the RESOLVER.md skills table: the skill name, the raw regex cell (backticks kept), the path to the skill's canonical file, and the purpose text. parseResolverRows returns these.

```ts
export interface ResolverRow {
  name: string;
  regexCell: string;
  path: string;
  purpose: string;
}
```

[`tools/lib/resolver-parse.ts:4-9`](https://github.com/victusfate/scaffold/blob/main/tools/lib/resolver-parse.ts#L4-L9)

</details>

#### The gates /upstream runs locally

*Carries out the step.* `test` chains the node tests, tool tests, shell tests and the check scripts. `test:checks` starts with `check-resolvable.ts --strict` and the skills-doc freshness check. `lint` is eslint with zero warnings allowed and `typecheck` is `tsc --noEmit`.

```json
  "scripts": {
    "test": "npm run test:node && npm run test:tools && npm run test:shell && npm run test:checks",
    "test:node": "node --test --test-concurrency=1 'scripts/**/*.test.ts' 'tools/**/*.test.ts' 'lib/**/*.test.ts'",
    "test:tools": "tools/hoist-skill/test && tools/sync/test && node tools/linter-setup/test && node tools/dependency-watch/test",
    "test:shell": "for f in scripts/test-*.sh; do [ \"$f\" = scripts/test-read-once.sh ] || bash \"$f\" || exit 1; done",
    "test:checks": "node scripts/check-resolvable.ts --strict && node scripts/update-skills-doc.ts --check && node scripts/check-agents-detail.ts && node scripts/check-handoff.ts && node scripts/check-guidelines.ts && node scripts/render-explorer-pages.ts --check && node scripts/render-diagrams.ts --check && node scripts/render-c4.ts --check",
    "test:integration": "RUN_INTEGRATION=1 tools/hoist-skill/test-integration && RUN_INTEGRATION=1 tools/sync/test-integration && RUN_INTEGRATION=1 tools/linter-setup/test-integration",
    "test:loop:integration": "RUN_INTEGRATION=1 node scripts/agent-loop.integration.test.ts",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "tsc --noEmit",
```

[`package.json:8-17`](https://github.com/victusfate/scaffold/blob/main/package.json#L8-L17)

**Why it matters.** These are the three commands the upstream step requires before pushing. The resolver and manifest checks above run inside `npm test`.

### Scaffold PR: code

#### CI lint job on the scaffold PR

*Enforces the rule.* On a pull request to main the job installs dependencies, then runs lint, typecheck and the import-boundary check. The verify job in the same file runs `npm test`.

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

**Why it matters.** These are the real checks whose conclusions must be read before merging the scaffold PR. Writing the PR body and deciding whether the merge is authorized are left to the agent.

### Sync back: code

#### --mark-resolved: accept a committed conflict resolution

*Enforces the rule.* For each file passed with --mark-resolved it checks that the file is in the manifest, exists, is tracked, has no unstaged or staged changes, and contains no conflict markers. Any failure prints an error and exits before the sync writes anything.

```bash
# Explicit resolutions must be managed, tracked, committed, and marker-free.
# Validate every requested path before sync writes anything; never infer resolution
# merely because an unrelated consumer commit happens to be clean.
for file in "${resolved_files[@]}"; do
  managed=0
  for entry in "${files[@]}"; do [ "$entry" != "$file" ] || managed=1; done
  if [ "$managed" != 1 ] || [ ! -f "$file" ] \
     || ! git ls-files --error-unmatch -- ":(literal)$file" >/dev/null 2>&1 \
     || ! git diff --quiet -- ":(literal)$file" \
     || ! git diff --cached --quiet -- ":(literal)$file" \
     || grep -Eq '^(<<<<<<< |=======($| )|>>>>>>> )' "$file"; then
    echo "error: --mark-resolved needs a committed, marker-free managed file: $file" >&2
    exit 1
  fi
done
```

[`bin/sync-from-scaffold.sh:126-140`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L126-L140)

**Why it matters.** After resolving a diverged file the re-run must accept the project's version instead of merging again. The checks stop a file being marked resolved while markers or uncommitted edits remain.

#### Compose AGENTS.md from scaffold's copy plus AGENTS.local.md

*Carries out the step.* When AGENTS.local.md exists, AGENTS.md is skipped if it is on the keep list or has uncommitted edits. Otherwise the script takes scaffold's AGENTS.md and appends a marked block holding AGENTS.local.md. It writes the result only if it differs.

```bash
# ── Compose AGENTS.md = scaffold's AGENTS.md + the AGENTS.local.md block ─────
if [ -f "$LOCAL_AGENTS" ] && git cat-file -e "scaffold/main:AGENTS.md" 2>/dev/null; then
  if in_keep_list AGENTS.md; then
    kept+=("AGENTS.md")   # .scaffold-keep wins: never compose over a kept AGENTS.md
  elif [ -f AGENTS.md ] && { ! git diff --quiet -- AGENTS.md || ! git diff --cached --quiet -- AGENTS.md; }; then
    skipped+=("AGENTS.md")
  else
    composed=$(mktemp)
    git show "scaffold/main:AGENTS.md" > "$composed"
    local_block >> "$composed"
    if [ ! -f AGENTS.md ] || ! cmp -s "$composed" AGENTS.md; then
      [ "$DRY_RUN" = 1 ] || cp "$composed" AGENTS.md
      updated+=("M AGENTS.md (scaffold + $LOCAL_AGENTS)")
    fi
    rm -f "$composed"
  fi
fi
```

[`bin/sync-from-scaffold.sh:256-272`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L256-L272)

**Why it matters.** This is one coded place for the project-specific half of a rule: it lives in AGENTS.local.md and is re-attached on every sync. The upstream text stays identical to scaffold's.

**Methods and helpers used here**

<details>
<summary><code>local_block</code> · shell function · bin/sync-from-scaffold.sh:72</summary>

Prints to stdout the block that is appended to AGENTS.md: a blank line, the BEGIN marker line, the contents of AGENTS.local.md (with a newline added if the file does not end in one), then the END marker line. It takes no arguments and writes no files; it fails if AGENTS.local.md cannot be read.

Comment in the source: The block appended to AGENTS.md: markers around AGENTS.local.md, separated from the upstream text by a blank line.

```bash
local_block() {
  printf '\n%s\n' "$LOCAL_BEGIN"
  cat "$LOCAL_AGENTS"
  [ -z "$(tail -c 1 "$LOCAL_AGENTS")" ] || printf '\n'
  printf '%s\n' "$LOCAL_END"
}
```

[`bin/sync-from-scaffold.sh:72-77`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L72-L77)

</details>

<details>
<summary><code>in_keep_list</code> · shell function · bin/sync-from-scaffold.sh:156</summary>

Takes a file path and returns 0 if it matches any glob pattern listed in .scaffold-keep in the current directory, skipping blank lines and lines starting with #. Returns 1 when nothing matches or when .scaffold-keep does not exist.

Comment in the source: Returns 0 if $1 matches any pattern in .scaffold-keep, 1 otherwise.

```bash
in_keep_list() {
  local file="$1" pattern
  [ -f ".scaffold-keep" ] || return 1
  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    # shellcheck disable=SC2053
    [[ "$file" == $pattern ]] && return 0
  done < ".scaffold-keep"
  return 1
}
```

[`bin/sync-from-scaffold.sh:156-165`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L156-L165)

</details>

#### upsertManifest: record hoisted skills in .sync/hoisted

*Carries out the step.* It reads the existing entries and keeps the file's comment header. For each new entry it replaces the one with the same name and harness, or appends it. It writes one tab-separated line per entry: name, harness, ref.

```ts
export function upsertManifest(path: string, newEntries: ManifestEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const existing = readManifest(path);
  let header = '# .sync/hoisted — skills hoisted from scaffold; replayed by /pull-scaffold.\n# <name>\t<harness>\t<ref>\n';
  if (existsSync(path)) {
    const commentLines = readFileSync(path, 'utf8').split('\n').filter(l => l.startsWith('#'));
    if (commentLines.length) header = commentLines.join('\n') + '\n';
  }
  // Explicitly hoisting the replacement retires the matching legacy registration.
  const merged = existing.filter(e => e.name !== PREVIOUS_PLAN ||
    !newEntries.some(n => n.name === CURRENT_PLAN && n.harness === e.harness));
  for (const entry of newEntries) {
    const idx = merged.findIndex(e => e.name === entry.name && e.harness === entry.harness);
    if (idx >= 0) merged[idx] = entry;
    else merged.push(entry);
  }
  writeFileSync(path, header + merged.map(e => `${e.name}\t${e.harness}\t${e.ref}`).join('\n') + '\n', 'utf8');
}
```

[`tools/hoist-skill/manifest.ts:42-59`](https://github.com/victusfate/scaffold/blob/main/tools/hoist-skill/manifest.ts#L42-L59)

**Why it matters.** This is the /hoist-skill record of what was exported and at which pinned ref. Without it a later replay would not know which skills to re-emit.

**Methods and helpers used here**

<details>
<summary><code>ManifestEntry</code> · interface · tools/hoist-skill/manifest.ts:5</summary>

One line of the .sync/hoisted manifest: the skill name, the harness it was hoisted for, and the scaffold git ref it is pinned to. readManifest returns these and upsertManifest writes them.

```ts
export interface ManifestEntry {
  name: string;
  harness: string;
  ref: string;
}
```

[`tools/hoist-skill/manifest.ts:5-9`](https://github.com/victusfate/scaffold/blob/main/tools/hoist-skill/manifest.ts#L5-L9)

</details>

<details>
<summary><code>readManifest</code> · function · tools/hoist-skill/manifest.ts:11</summary>

Takes a manifest file path and returns its entries as { name, harness, ref }, reading one tab-separated entry per line, skipping blank lines, lines starting with '#', and lines missing a name or harness; ref defaults to 'main'. Returns an empty array when the file does not exist.

```ts
export function readManifest(path: string): ManifestEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const parts = l.split('\t');
      return { name: (parts[0] || '').trim(), harness: (parts[1] || '').trim(), ref: (parts[2] || 'main').trim() };
    })
    .filter(e => e.name && e.harness);
}
```

[`tools/hoist-skill/manifest.ts:11-21`](https://github.com/victusfate/scaffold/blob/main/tools/hoist-skill/manifest.ts#L11-L21)

</details>

<details>
<summary><code>PREVIOUS_PLAN</code> · const · tools/hoist-skill/manifest.ts:23</summary>

The string 'grill-with-docs', the former name of the skill now called 'co-plan'. The manifest functions use it to find legacy entries to rename or drop.

```ts
const PREVIOUS_PLAN = 'grill-with-docs';
```

[`tools/hoist-skill/manifest.ts:23`](https://github.com/victusfate/scaffold/blob/main/tools/hoist-skill/manifest.ts#L23)

</details>

<details>
<summary><code>CURRENT_PLAN</code> · const · tools/hoist-skill/manifest.ts:24</summary>

The string 'co-plan', the current name of the skill formerly called 'grill-with-docs'. The manifest functions use it to rename or drop legacy entries recorded under the old name.

```ts
const CURRENT_PLAN = 'co-plan';
```

[`tools/hoist-skill/manifest.ts:24`](https://github.com/victusfate/scaffold/blob/main/tools/hoist-skill/manifest.ts#L24)

</details>

## Checked against the source

The flow matches the three skill docs and the sync script on nearly every claim. The material differences are in sync-down: the script skips files with uncommitted edits before any 3-way merge, and after a conflict it asks for a re-run with --mark-resolved, neither of which the page shows. The page also omits deletion of files scaffold no longer ships and the rule that the synced SHA is saved only when no conflicts or sidecars remain.

| Confirmed | Partly | Not found | Contradicted | In the source, not shown in the flow | Code excerpts |
|---:|---:|---:|---:|---:|---:|
| 38 | 3 | 0 | 0 | 9 | 14 |

An agent judged each claim against the source; each quote is found in its file when this page is built.

### Bootstrap: checks

<details>
<summary>4 confirmed, with the supporting line</summary>

- **Confirmed**: The first time, install the sync script, then run it once the user confirms.
  > Or offer to run it now. Do not run it without confirmation.
  >
  > [`skills/sync-scaffold.md:39`](https://github.com/victusfate/scaffold/blob/main/skills/sync-scaffold.md#L39)

- **Confirmed**: If bin/sync-from-scaffold.sh is missing, a curl of bootstrap.sh installs the script only.
  > This installs \`bin/sync-from-scaffold.sh\` but does \*\*not\*\* run the sync automatically. After bootstrap completes, tell the user to run the sync manually:
  >
  > [`skills/sync-scaffold.md:33`](https://github.com/victusfate/scaffold/blob/main/skills/sync-scaffold.md#L33)

- **Confirmed**: Sync script installed (bin/sync-from-scaffold.sh)
  > After bootstrap completes, tell the user to run the sync manually:
  >
  > [`skills/sync-scaffold.md:33`](https://github.com/victusfate/scaffold/blob/main/skills/sync-scaffold.md#L33)

- **Confirmed** (from the diagram): bin/sync-from-scaffold.sh exists?
  > Check whether \`bin/sync-from-scaffold.sh\` exists in the current working directory.
  >
  > [`skills/sync-scaffold.md:9`](https://github.com/victusfate/scaffold/blob/main/skills/sync-scaffold.md#L9)

</details>

### Sync down: checks

- **Partly**: Project finds a generic fix (project change)
  > Move a change that belongs to every scaffold consumer (a rule, skill, script or tool)
  >
  > [`skills/upstream.md:3`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L3)

  The source describes /upstream on its own terms; that it follows a sync down is the page's own narrative, not a stated order.

<details>
<summary>11 confirmed, with the supporting line</summary>

- **Confirmed**: /sync-scaffold merges scaffold's files into the project on the current branch.
  > \*\*Always run on the current working branch.\*\* Do not switch to main or any other branch before or after syncing.
  >
  > [`skills/sync-scaffold.md:5`](https://github.com/victusfate/scaffold/blob/main/skills/sync-scaffold.md#L5)

- **Confirmed**: The manifest, scaffold-files.txt, lists the files scaffold ships.
  > if ! manifest=$(git show scaffold/main:.github/scaffold-files.txt 2&gt;/dev/null); then
  >
  > [`bin/sync-from-scaffold.sh:117`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L117)

- **Confirmed**: A file that differs, has a base and has no uncommitted edits gets a 3-way merge from the last synced commit.
  > if \[ -n "$last\_sha" \] &amp;&amp; git cat-file -e "${last\_sha}:${file}" 2&gt;/dev/null; then
  >
  > [`bin/sync-from-scaffold.sh:206`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L206)

- **Confirmed**: No base and the file differs: the incoming copy is saved as a .scaffold-new sidecar to review.
  > \# No base SHA — don't overwrite; save sidecar for deliberate review
  >
  > [`bin/sync-from-scaffold.sh:224`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L224)

- **Confirmed**: Paths in .scaffold-keep are skipped.
  > \#     line; \# and blank lines ignored) — any matching path is always skipped.
  >
  > [`bin/sync-from-scaffold.sh:11`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L11)

- **Confirmed**: Conflict markers: resolve, commit, re-run with --mark-resolved.
  > Conflicts (resolve, commit, then re-run with --mark-resolved &lt;file&gt; for each resolution):
  >
  > [`bin/sync-from-scaffold.sh:334`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L334)

- **Confirmed**: A sidecar is not applied: the original file is unchanged until someone diffs and merges it.
  > the original was not changed; a \`.scaffold-new\` sidecar holds the incoming version. The user should diff and merge deliberately, then re-run the sync.
  >
  > [`skills/sync-scaffold.md:25`](https://github.com/victusfate/scaffold/blob/main/skills/sync-scaffold.md#L25)

- **Confirmed**: Manifest: The list of files scaffold ships to consumers.
  > \- all five paths added to \`.github/scaffold-files.txt\`, the sync manifest;
  >
  > [`skills/upstream.md:57`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L57)

- **Confirmed**: Sidecar: A .scaffold-new copy of scaffold's version saved beside your file for review; writing it leaves your file unchanged.
  > &lt;file&gt;.scaffold-new for deliberate review; the target is left unchanged.
  >
  > [`bin/sync-from-scaffold.sh:9`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L9)

- **Confirmed**: .scaffold-keep: The consumer's list of paths the sync never touches.
  > \#   - .scaffold-keep: an optional file at the repo root (one path or glob per
  >
  > [`bin/sync-from-scaffold.sh:10`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L10)

- **Confirmed** (from the diagram): Legend: SHA = id of one git commit; here the last one synced
  > SHA\_FILE=".github/scaffold-sync-sha"
  >
  > [`bin/sync-from-scaffold.sh:35`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L35)

</details>

### Upstream: checks

- **Partly**: Make the change the scaffold way; a new skill needs its wrappers, RESOLVER entry, manifest line and test.
  > \- all five paths added to \`.github/scaffold-files.txt\`, the sync manifest;
  >
  > [`skills/upstream.md:57`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L57)

  Wrappers, RESOLVER row and acceptance test are listed, but the manifest needs five paths rather than one line, and the claim omits the canonical skills/&lt;name&gt;.md and the regenerated docs/skills.md that the same list requires.

<details>
<summary>8 confirmed, with the supporting line</summary>

- **Confirmed**: /upstream splits a project change into its universal half and moves that half into scaffold.
  > Decide what is universal and what belongs only to this project.
  >
  > [`skills/upstream.md:21`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L21)

- **Confirmed**: Work in a scaffold worktree off origin/main, never its main checkout.
  > \*\*Do not switch branches or edit files in its main checkout.\*\* Another session may
  >
  > [`skills/upstream.md:36`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L36)

- **Confirmed**: npm test and eslint (0 errors) must pass, plus typecheck when TypeScript changed.
  > npx eslint .        \# 0 errors (existing warnings are not yours to fix here)
  >
  > [`skills/upstream.md:69`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L69)

- **Confirmed**: Gates pass (scaffold branch)
  > Fix every failure before pushing. Hosted CI confirms; it isn't the place to find failures.
  >
  > [`skills/upstream.md:73`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L73)

- **Confirmed** (from the diagram): Split universal from project-specific
  > \#\# Step 1 — split generic from project-specific
  >
  > [`skills/upstream.md:19`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L19)

- **Confirmed** (from the diagram): Legend: worktree = isolated git checkout, so sessions never collide
  > \- Never edit, stash or check out branches in a scaffold or consumer checkout another session is using. Use a worktree.
  >
  > [`skills/upstream.md:114`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L114)

- **Confirmed** (from the diagram): Legend: RESOLVER = table mapping triggers to skills
  > \- a row in \`.claude/skills/RESOLVER.md\` with the trigger regex, path and
  >
  > [`skills/upstream.md:55`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L55)

- **Confirmed** (from the diagram): Legend: harness = agent tool: Claude Code, Codex, Cursor, agy, pi
  > \- \*\*Universal\*\* goes to scaffold, written harness-neutrally (Claude Code, Codex,
  >
  > [`skills/upstream.md:23`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L23)

</details>

### Scaffold PR: checks

<details>
<summary>5 confirmed, with the supporting line</summary>

- **Confirmed**: Open a scaffold PR that says why the change is universal, and merge it only if authorized.
  > \3. Merge when every required check passed and the merge is authorized (see
  >
  > [`skills/upstream.md:83`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L83)

- **Confirmed**: The PR names the consumer that needed it.
  > universal and which consumer it came from.
  >
  > [`skills/upstream.md:79`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L79)

- **Confirmed**: Read the real check conclusions; a skipped check is not a pass.
  > \`gh pr checks &lt;n&gt; --watch; echo "EXIT=$?"\`. A \*\*skipped\*\* required check is
  >
  > [`skills/upstream.md:81`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L81)

- **Confirmed**: Remove the worktree after the merge.
  > Purpose). Delete the branch and remove the scaffold worktree.
  >
  > [`skills/upstream.md:84`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L84)

- **Confirmed**: Scaffold PR merged (scaffold main)
  > \#\# Step 6 — sync it back into this consumer
  >
  > [`skills/upstream.md:86`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L86)

</details>

### Sync back: checks

- **Partly** (from the diagram): /hoist-skill drawn as an "Or" branch beside "Sync back into consumer" (spec: "Another way out")
  > This is the reverse direction of \`/hoist-skill\` (scaffold → consumer) and finishes
  >
  > [`skills/upstream.md:10`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L10)

  The source frames /hoist-skill as the reverse direction of /upstream (scaffold to consumer), not as an alternative to the sync-back step.

<details>
<summary>10 confirmed, with the supporting line</summary>

- **Confirmed**: Run /sync-scaffold again on a project branch to pull the merged change back in.
  > \2. Run \`/sync-scaffold\` (\`bash bin/sync-from-scaffold.sh\`).
  >
  > [`skills/upstream.md:92`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L92)

- **Confirmed**: Keep .scaffold-keep paths and merge diverged files.
  > \- Keep the consumer's local content in \`.scaffold-keep\` paths.
  >
  > [`skills/upstream.md:94`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L94)

- **Confirmed**: Put the project-specific half in the project's own policy file.
  > \4. Add the project-specific half from Step 1 to the consumer's policy file.
  >
  > [`skills/upstream.md:97`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L97)

- **Confirmed**: Then the project's own gates, PR and authorized merge.
  > \5. Run the consumer's gates, open its PR, verify real checks, then merge (same
  >
  > [`skills/upstream.md:98`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L98)

- **Confirmed**: Another way out: /hoist-skill — Exports chosen skills into another repo in a target harness's format.
  > Export one or more scaffold skills into a target repo in the requested harness format. Wraps \`tools/hoist-skill/run\` — do not reimplement its logic here.
  >
  > [`skills/hoist-skill.md:8`](https://github.com/victusfate/scaffold/blob/main/skills/hoist-skill.md#L8)

- **Confirmed**: .sync/hoisted records the name, harness and pinned ref; --from-manifest replays it.
  > This reads \`&lt;destination&gt;/.sync/hoisted\` and re-emits every recorded \`(name, harness)\` pair. Clobber-safe: unchanged files are skipped, locally edited files become sidecars, \`.scaffold-keep\` paths are honored.
  >
  > [`skills/hoist-skill.md:74`](https://github.com/victusfate/scaffold/blob/main/skills/hoist-skill.md#L74)

- **Confirmed** (from the diagram): Pick skills, harness, --into target repo
  > \- \*\*Destination\*\* — the \`--into\` path (the target repo root). Must be provided; do not guess.
  >
  > [`skills/hoist-skill.md:16`](https://github.com/victusfate/scaffold/blob/main/skills/hoist-skill.md#L16)

- **Confirmed** (from the diagram): tools/hoist-skill/run emits harness wrappers
  > &gt; controls which format is emitted: \`claude\` writes Claude Code wrappers,
  >
  > [`skills/hoist-skill.md:5`](https://github.com/victusfate/scaffold/blob/main/skills/hoist-skill.md#L5)

- **Confirmed** (from the diagram): Hoist: differs → sidecar
  > \- \*\*Force\*\* — whether to overwrite differing files. Default: no (sidecars are written instead). Only set \`--force\` if the user explicitly asks.
  >
  > [`skills/hoist-skill.md:17`](https://github.com/victusfate/scaffold/blob/main/skills/hoist-skill.md#L17)

- **Confirmed** (from the diagram): Legend: ref = scaffold tag or commit a hoist is pinned to
  > \- \*\*Ref\*\* — optional scaffold ref to stamp in the manifest (\`--ref &lt;tag\|commit&gt;\`, default \`main\`). Use when the consumer pins to a specific release.
  >
  > [`skills/hoist-skill.md:18`](https://github.com/victusfate/scaffold/blob/main/skills/hoist-skill.md#L18)

</details>

## In the source, not shown in the flow

- A differing file with uncommitted local edits is skipped, not merged; the report tells the user to stash or commit first.
  > \# Uncommitted local edits (working tree or index) — don't touch
  >
  > [`bin/sync-from-scaffold.sh:199`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L199)

- The sync also deletes files scaffold stopped shipping, but only when still byte-identical to what scaffold shipped; modified and kept ones are reported.
  > \#   - An orphan is deleted only when it is still byte-identical to what scaffold
  >
  > [`bin/sync-from-scaffold.sh:16`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L16)

- The synced SHA is saved only when no conflicts or sidecar reviews are pending, so those must be cleared before the sync counts as done.
  > \# Save SHA only when there are no unresolved conflicts or pending reviews
  >
  > [`bin/sync-from-scaffold.sh:322`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L322)

- With AGENTS.local.md present, AGENTS.md is regenerated as scaffold's AGENTS.md plus a marked local block instead of being merged.
  > \#     never shipped by scaffold). When it exists, sync writes AGENTS.md as scaffold's AGENTS.md followed by a
  >
  > [`bin/sync-from-scaffold.sh:27`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L27)

- The sync script updates itself first and re-runs when scaffold has a newer copy and the tree is clean.
  > \# Self-update first: if scaffold has a newer version of this script and the
  >
  > [`bin/sync-from-scaffold.sh:230`](https://github.com/victusfate/scaffold/blob/main/bin/sync-from-scaffold.sh#L230)

- Nothing personal or project-specific goes up: no email addresses, credentials or project names in scaffold.
  > \- Never put a person's email address, credentials or project names into scaffold.
  >
  > [`skills/upstream.md:28`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L28)

- Invoking /upstream is itself the merge authorization for both PRs; it stops at a ready PR when policy needs separate approval or the user says "PR only".
  > The user invoking \`/upstream\` authorizes merging the scaffold PR and the consumer sync
  >
  > [`skills/upstream.md:15`](https://github.com/victusfate/scaffold/blob/main/skills/upstream.md#L15)

- After a hoist the user is reminded to commit .sync/hoisted, and --force is set only when the user explicitly asks.
  > Remind the user to commit \`&lt;destination&gt;/.sync/hoisted\` so the registration survives across sessions and devices.
  >
  > [`skills/hoist-skill.md:58`](https://github.com/victusfate/scaffold/blob/main/skills/hoist-skill.md#L58)

- After either path /sync-scaffold reports which path ran and the files updated, kept, skipped, reviewed or conflicted.
  > \- Files updated, kept, skipped, reviewed (sidecar), or conflicted
  >
  > [`skills/sync-scaffold.md:51`](https://github.com/victusfate/scaffold/blob/main/skills/sync-scaffold.md#L51)

## Glossary

- **Consumer**: A project repo that syncs from scaffold.
- **Manifest**: The list of files scaffold ships to consumers.
- **Sidecar**: A .scaffold-new copy of scaffold's version saved beside your file for review; writing it leaves your file unchanged.
- **.scaffold-keep**: The consumer's list of paths the sync never touches.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's shared agent rules and skills sync
into project repos and how fixes flow back.
Read this page:
https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/scaffold-sync.md
Scaffold: https://github.com/victusfate/scaffold

Questions worth asking:
- What decides whether a change belongs in scaffold or stays in the project?
```
