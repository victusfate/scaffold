# scaffold

[![Use this template](https://img.shields.io/badge/Use%20this%20template-2ea44f?style=for-the-badge&logo=github)](https://github.com/victusfate/scaffold/generate)

A minimal, cross-harness project scaffold for AI-assisted development. Drop it into any new project to get a consistent design → PRD → TDD workflow whether you're using Claude Code, Cursor, or Gemini CLI.

## Usage

**Browser / mobile:** hit "Use this template" above → create new repository → open in Claude Code.

**CLI:**
```bash
gh repo create my-new-project --template victusfate/scaffold --private
gh repo clone victusfate/my-new-project
```

## Philosophy

- **Single source of truth** — `AGENTS.md` holds all agent instructions. `CLAUDE.md` imports it; `GEMINI.md` references it; `.cursor/rules/agents.mdc` points to it. No duplication.
- **Careful before fast** — features start with a structured design Q&A (`grill-with-docs`) that locks in vocabulary and decisions before any code is written.
- **Automatic flow** — once Q&A is done, the chain runs to completion (PRD → TDD → review gate) without manual handoffs.
- **Minimal viable diff** — agents are instructed to make the smallest change that achieves the goal, no opportunistic refactors.

## Workflow

Start a feature by describing what you want to build. The `feature-chain` skill fires automatically and runs four phases:

```
grill-with-docs → to-prd → tdd → review
     (Q&A)        (auto)   (auto)  (you)
```

1. **grill-with-docs** — Agent interviews you one question at a time, sharpens terminology, stress-tests against the codebase, and produces `./docs/<slug>/design.md` with a canonical vocabulary and Mermaid/ASCII diagrams as structure becomes clear.
2. **to-prd** — Synthesizes the conversation and codebase into `./docs/<slug>/prd.md` automatically. No re-interviewing.
3. **tdd** — Derives `plan.md` from the PRD, then executes RED → GREEN → REFACTOR one vertical slice at a time. Commits per slice.
4. **Review** — Chain stops and presents a summary of what was built, tests passing, and any plan deviations. Prompts you to review before merging.

<!-- BEGIN_SKILLS_INVOCATION -->
Skills can also be invoked individually: `/feature-chain`, `/grill-with-docs`, `/to-prd`, `/tdd`, `/design-review`, `/code-quality-review`, `/skillify`, `/sync-scaffold`, `/create-pr`, `/code-review`, `/simplify`, `/prune`, `/pause`, `/resume`, `/hoist-skill`, `/protect-branch`.
<!-- END_SKILLS_INVOCATION -->

## Structure

<!-- BEGIN_SKILLS_STRUCTURE -->
```
AGENTS.md                        # agent instructions — single source of truth
CLAUDE.md                        # imports AGENTS.md (@AGENTS.md)
GEMINI.md                        # references AGENTS.md
package.json                     # npm entry (bin/sync) — name, version, engines, test scripts
docs/
  agent-authoring-requirements.md  # normative spec for tools, scripts, skills, bin
bin/
  bootstrap.sh                   # one-time setup for downstream repos
  sync-from-scaffold.sh          # pull scaffold updates into a downstream repo
  sync                           # npx entrypoint → tools/sync/run.mjs
  install-skills.sh              # copy skills into a global dir (e.g. ~/.claude/skills)
  globalize-skill.sh             # promote one skill into a global dir, imports inlined
  repo-bound-skills.txt          # shared guard list for the two installers
tools/
  README.md                      # capability index (spec §2 registration)
  lib/
    safe-write.mjs               # shared clobber-safe write engine (sidecars, .scaffold-keep)
  hoist-skill/                   # tool: emit skills into a consumer repo (tool.yaml, run, hoist.mjs, test)
  sync/                          # tool: npx consumer sync (tool.yaml, run.mjs, policy.mjs, promote.mjs, test)
.claude/
  skills/
    RESOLVER.md                   # central routing table — skill → regex → path
    feature-chain/SKILL.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs/SKILL.md      # Design Q&A → design.md + canonical vocabulary
    to-prd/SKILL.md               # Synthesize context + codebase → prd.md
    tdd/SKILL.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review/SKILL.md        # Structural review of design.md
    code-quality-review/SKILL.md  # Structural review of implementation
    skillify/SKILL.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold/SKILL.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr/SKILL.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review/SKILL.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify/SKILL.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune/SKILL.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause/SKILL.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume/SKILL.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
    hoist-skill/SKILL.md          # Hoist scaffold capabilities into a consumer repo in the target harness format
    protect-branch/SKILL.md       # Open GitHub branch protection settings for the current repo and show a targeted configuration checklist
  session-start/
    hook.sh                      # SessionStart hook: fetches origin/main, warns if branch is behind
  read-once/
    hook.sh                      # PreToolUse hook: skips redundant file reads
    compact.sh                   # PostCompact hook: clears read cache after compaction
  settings.json                  # hook wiring (SessionStart, PreToolUse, PostCompact)
.cursor/
  rules/
    agents.mdc               # thin pointer to AGENTS.md
    feature-chain.mdc        # mirrors feature-chain for Cursor
    grill-with-docs.mdc      # mirrors grill-with-docs for Cursor
    to-prd.mdc               # mirrors to-prd for Cursor
    tdd.mdc                  # mirrors tdd for Cursor
    design-review.mdc        # mirrors design-review for Cursor
    code-quality-review.mdc  # mirrors code-quality-review for Cursor
    skillify.mdc             # mirrors skillify for Cursor
    sync-scaffold.mdc        # mirrors sync-scaffold for Cursor
    create-pr.mdc            # mirrors create-pr for Cursor
    code-review.mdc          # mirrors code-review for Cursor
    simplify.mdc             # mirrors simplify for Cursor
    prune.mdc                # mirrors prune for Cursor
    pause.mdc                # mirrors pause for Cursor
    resume.mdc               # mirrors resume for Cursor
    hoist-skill.mdc          # mirrors hoist-skill for Cursor
    protect-branch.mdc       # mirrors protect-branch for Cursor
.agents/
  skills/
    feature-chain/SKILL.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs/SKILL.md      # Design Q&A → design.md + canonical vocabulary
    to-prd/SKILL.md               # Synthesize context + codebase → prd.md
    tdd/SKILL.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review/SKILL.md        # Structural review of design.md
    code-quality-review/SKILL.md  # Structural review of implementation
    skillify/SKILL.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold/SKILL.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr/SKILL.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review/SKILL.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify/SKILL.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune/SKILL.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause/SKILL.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume/SKILL.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
    hoist-skill/SKILL.md          # Hoist scaffold capabilities into a consumer repo in the target harness format
    protect-branch/SKILL.md       # Open GitHub branch protection settings for the current repo and show a targeted configuration checklist
.agent/
  rules/
    agents.md               # thin pointer to AGENTS.md (always-on)
  workflows/
    feature-chain.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs.md      # Design Q&A → design.md + canonical vocabulary
    to-prd.md               # Synthesize context + codebase → prd.md
    tdd.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review.md        # Structural review of design.md
    code-quality-review.md  # Structural review of implementation
    skillify.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
    hoist-skill.md          # Hoist scaffold capabilities into a consumer repo in the target harness format
    protect-branch.md       # Open GitHub branch protection settings for the current repo and show a targeted configuration checklist
scripts/
  check-resolvable.mjs           # RESOLVER linter (reachability/ambiguity/DRY/MECE/parity/sync)
  update-readme-skills.mjs       # regenerate README.md skill sections from RESOLVER.md
  compute-bump.mjs               # conventional-commit version bump (used by version-bump.yml)
  test-sync.sh                   # isolated tests for bin/sync-from-scaffold.sh
  test-bootstrap.sh              # isolated tests for bin/bootstrap.sh
.githooks/
  pre-commit                     # runs the linter and README freshness check — enable via core.hooksPath
.github/
  scaffold-files.txt             # manifest of files managed by scaffold
  workflows/
    ci.yml                       # verify (npm test) + integration jobs on PRs
    version-bump.yml             # post-merge version bump + tag on main
    sync-scaffold.yml            # manual workflow to sync updates via PR
.claudeignore                    # excludes build artifacts from Claude's context
```
<!-- END_SKILLS_STRUCTURE -->

## Harness support

| Harness | How it reads instructions |
|---|---|
| Claude Code | `CLAUDE.md` → imports `AGENTS.md`; `/skill-name` invokes skills |
| Cursor | `.cursor/rules/*.mdc` — description-driven activation |
| Google Antigravity | `GEMINI.md` + `AGENTS.md`; `.agents/skills/` (lazy-loaded) + `.agent/workflows/` (slash commands) |
| Gemini CLI | `GEMINI.md` → references `AGENTS.md` |
| OpenAI Codex | `AGENTS.md` directly |

## Feature artifacts

Each feature gets its own folder under `./docs/`:

```
./docs/<feature-slug>/
  design.md      # Q&A, decisions, canonical vocabulary, diagrams
  prd.md         # problem, solution, user stories, implementation decisions
  plan.md        # vertical slices
  tdd-log.md     # per-slice TDD status
```

## Syncing updates to downstream repos

**Bootstrap** (one-time per repo — installs the sync script, prints next steps):
```bash
curl -fsSL https://raw.githubusercontent.com/victusfate/scaffold/main/bin/bootstrap.sh | bash
```

Bootstrap does not run the sync automatically and does not change any tracked files.
Run the first sync yourself when ready:
```bash
bash bin/sync-from-scaffold.sh
```

Flags:
- `--run` — also run the sync immediately after install (old behavior).
- `--with-workflow` — also install `.github/workflows/sync-scaffold.yml`.

**Update** (run whenever you want to pull in scaffold changes, like a dependency bump):
```bash
bash bin/sync-from-scaffold.sh
```

Or ask the agent — `/sync-scaffold` detects which path is needed (bootstrap vs sync) and runs it automatically.

The sync script uses git (no curl after bootstrap), compares blob SHAs, and three-way merges files that both you and scaffold have changed. Files with uncommitted local edits are skipped with a warning. The last-synced SHA is stored in `.github/scaffold-sync-sha` so future merges have a proper base.

**Clobber-safe behaviors:**

- **No silent first-sync overwrite.** When no base SHA exists and a target file already exists and differs, the incoming version is written to `<file>.scaffold-new` for deliberate review. The original is left untouched. Diff and merge when ready; re-run the sync to save the SHA once resolved.
- **`.scaffold-keep`.** Add an optional `.scaffold-keep` file at your repo root (one path or glob per line; `#` comments and blank lines ignored). Any matching path is always skipped — even on first sync — and reported as "Kept (consumer-owned)". Use this to protect any file you own locally from being overwritten.
- **`CLAUDE.md` is shipped as a starting point.** On first sync into a repo that has no `CLAUDE.md`, scaffold writes one. If you have already customized yours, add `CLAUDE.md` to `.scaffold-keep` — the sidecar or keep-list will protect it from then on.

**Pinning to a release tag** (recommended for reproducible pulls):
```bash
# Pin SCAFFOLD_REF in your update script or set the remote to a tag
git fetch scaffold refs/tags/v1.0:refs/tags/scaffold-v1.0
```

A GitHub Actions workflow can be installed at `.github/workflows/sync-scaffold.yml` — trigger it manually from the Actions tab for a PR-based update flow. Install it with `--with-workflow` during bootstrap, or copy it manually.

## Using scaffold skills as a dependency

The sync flow above is bulk — it pulls every file in the manifest. If you only want specific skills in a specific harness, use `hoist-skill` instead. scaffold owns the emit so consumers do not need to know the internal canonical+generated layout.

**Emit specific skills into a repo:**
```bash
# From inside a scaffold clone, target another repo
node tools/hoist-skill/run \
  --names feature-chain,grill-with-docs,tdd \
  --harness claude \
  --into ../my-project
```

After a successful emit, the tool automatically writes (or updates) `../my-project/.sync/hoisted` — a tab-separated registration manifest recording each `(name, harness, ref)` triple. Commit this file so the selection survives across sessions and devices.

**Emit everything for all harnesses:**
```bash
node tools/hoist-skill/run --names all --harness all --into ../my-project
```

**List available capabilities:**
```bash
node tools/hoist-skill/run --list
```

**What gets written per harness:**

| Harness | Files written |
|---|---|
| `claude` | `skills/<name>.md` + `.claude/skills/<name>/SKILL.md` |
| `cursor` | `skills/<name>.md` + `.cursor/rules/<name>.mdc` |
| `antigravity` | `skills/<name>.md` + `.agents/skills/<name>/SKILL.md` + `.agent/workflows/<name>.md` |

The same clobber-safe contract applies as with the sync script: `.scaffold-keep` paths are never touched, differing files become `<file>.scaffold-new` sidecars, and `--force` overrides that.

The tool emits a JSON manifest on stdout listing every file written, skipped, or sidecarred — pipe it to `jq` or capture it for CI.

**Refresh registered skills (replay on sync):**

Once `.sync/hoisted` exists, re-emit all registered skills from scaffold's current ref in one call — no need to retype the names list:

```bash
node tools/hoist-skill/run --from-manifest --into ../my-project
```

This is the call a consumer's `/pull-scaffold` makes to keep hoisted skills up to date. Clobber-safe: locally edited files become sidecars; `.scaffold-keep` paths are skipped.

**Pin to a specific ref:**

```bash
node tools/hoist-skill/run \
  --names feature-chain,tdd \
  --harness claude \
  --into ../my-project \
  --ref v1.2.0
```

The ref is stamped in `.sync/hoisted` per entry so replay is reproducible.

**Plan mode (for curl-only consumers):**

Pull-only consumers that have no scaffold clone can fetch just the files they need. `--plan` prints the exact repo-relative source paths to curl — without writing anything:

```bash
node tools/hoist-skill/run \
  --names tdd,feature-chain \
  --harness claude \
  --plan
```

```json
{
  "ref": "main",
  "harness": "claude",
  "sources": [
    { "path": "tools/hoist-skill/run", "required": true },
    { "path": ".claude/skills/RESOLVER.md", "required": true },
    { "path": "skills/tdd.md", "required": true, "ref": "main" },
    { "path": ".claude/skills/tdd/SKILL.md", "required": false, "ref": "main" },
    { "path": "skills/feature-chain.md", "required": true, "ref": "main" },
    { "path": ".claude/skills/feature-chain/SKILL.md", "required": false, "ref": "main" }
  ]
}
```

`required: false` sources are generated by the emitter when absent (a curl 404
on them is non-fatal).

Combine with `--from-manifest` to get the source list for all registered skills at once. Use `--no-record` to suppress manifest writes when testing or doing dry-run checks.

> **Note for pull-only consumers:** per-harness wrapper forms (`.claude/skills/<n>/SKILL.md`, `.cursor/rules/<n>.mdc`, etc.) are generated by the emitter when no upstream file exists. They may not be present in scaffold's repo as committed files, so a `curl` against a planned source path can 404. Treat any 404 on a planned source as non-fatal — the emitter generates the wrapper from the skill body and RESOLVER metadata instead.

## Skill engine

Skills are indexed in a central routing table, `.claude/skills/RESOLVER.md`,
which maps each skill to its invocation regex and path. A linter keeps the
table and the skills on disk in sync:

```bash
node scripts/check-resolvable.mjs          # errors block, DRY duplication warns
node scripts/check-resolvable.mjs --strict # DRY duplication also blocks
```

It enforces seven phases: **Reachability** (no skill orphaned from the table),
**Ambiguity** (no two skills share a slash-command route), **DRY** (duplicated
prose blocks should move to `lib/`), **MECE** (no two skills with overlapping
purpose — merge via args), **Cursor parity** (every skill has a
`.cursor/rules/<slug>.mdc` mirror), **Antigravity parity** (every skill has a
`.agents/skills/<slug>/SKILL.md` + `.agent/workflows/<slug>.md` pair for Google
Antigravity), and **Scaffold-sync** (every skill is registered in
`.github/scaffold-files.txt` so it propagates downstream).

Enable it as a pre-commit gate:

```bash
git config core.hooksPath .githooks
```

New skills are created with **`/skillify`**, which reconstructs the session,
interviews briefly, generates a `SKILL.md`, Cursor mirror, and Antigravity
wrappers, registers it in RESOLVER, validates, and opens a PR back to scaffold
so all repos inherit it.

## Global installation

To make the skills available in every project (not just this one):

```bash
mkdir -p ~/.claude/skills
cp -r .claude/skills/* ~/.claude/skills/
```

Project-level skills override global ones when names match.

## session-start hook

`.claude/session-start/hook.sh` runs at every session start. It fetches `origin/main` silently and warns Claude if the current branch is behind — prompting a rebase or pull before new feature work begins. Always exits 0 so a network failure never blocks a session.

## read-once hooks

`.claude/read-once/` contains a pair of hooks that prevent Claude from re-reading files it already has in context, saving tokens on large sessions. Controlled via env vars:

| Var | Default | Effect |
|---|---|---|
| `READ_ONCE_MODE` | `warn` | `warn` allows re-read with advisory; `deny` blocks it |
| `READ_ONCE_TTL` | `1200` | Seconds before a cached read expires |
| `READ_ONCE_DIFF` | `0` | Set to `1` to show only diffs on changed files |
| `READ_ONCE_DISABLED` | `0` | Set to `1` to disable entirely |

## Branch Protection Setup

One-time manual step required after the CI workflows are in place.

**[→ Open Ruleset Settings for `victusfate/scaffold`](https://github.com/victusfate/scaffold/settings/rules)**

Go to **Settings → Rules → Rulesets**, edit (or create) the ruleset targeting `main`, and enable:

**Restrict pushes:**
- Block force pushes ✓
- Restrict deletions ✓

**Require pull requests:**
- Require a pull request before merging ✓
- Required approvals: `0`
- Dismiss stale reviews when new commits are pushed ✓

**Require status checks:**
1. Enable **Require status checks to pass**
2. Enable **Require branches to be up to date before merging** (under additional settings)
3. Click **+ Add checks** → type `verify` → select **verify — GitHub Actions**

> **`verify` not in the dropdown?** It only registers after at least one PR has run `.github/workflows/ci.yml`. Open a draft PR, let CI run, close it, then add the check here.

**Bypass list:** Add `Repository admin` → Always allow (for emergency hotfixes).

Or just run `/protect-branch` in Claude Code — it opens this page and walks you through it.

> **Why required approvals: 0?** GitHub rulesets hard-block PR authors from approving their own PRs when required approvals > 0. Since agents run as your GitHub account, setting approvals to 1 locks you out of approving agent PRs — and there's no override in rulesets. The real gates are CI (tests must pass) and `CODEOWNERS` protecting `.github/workflows/`.

> **Long-term fix** — create a dedicated bot GitHub account for the agent. Set Required approvals back to 1 and re-enable "Require review from Code Owners". Agents open PRs as the bot; you approve as yourself; neither party is locked out.

> **Known limitation — agents share your GitHub token.** Agents in this workflow run as your GitHub account, so GitHub can't distinguish an agent approval from a human one. "Required approvals: 1" can technically be satisfied by the agent approving its own PR. The practical guards are: CI must pass, workflow changes always need your sign-off via CODEOWNERS, and an agent would need to be explicitly told to self-approve. The clean long-term fix is a dedicated bot GitHub account for the agent — that separates author from reviewer cleanly and lets you keep "prevent authors from approving their own PRs" without locking yourself out.

### How releases work after setup

No manual steps needed day-to-day:

1. Developer opens PR with [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, etc.)
2. `verify` job runs `npm test` (all tool/script suites + linter + README freshness) — must pass before merge is allowed
3. PR merges to `main`
4. `version-bump` workflow computes the bump from the merged commits (`scripts/compute-bump.mjs`), commits the new `package.json` version to `main`, and pushes the `v<version>` tag

### Commit → version mapping

| Prefix | Bump |
|---|---|
| `fix:` | patch (`1.0.0 → 1.0.1`) |
| `feat:` | minor (`1.0.0 → 1.1.0`) |
| `feat!:` or `BREAKING CHANGE` in body | major (`1.0.0 → 2.0.0`) |
| `chore:`, `docs:`, `refactor:`, etc. | no release |

## Credits

The `grill-with-docs`, `to-prd`, and `tdd` skills are adapted from [Matt Pocock's skills repo](https://github.com/mattpocock/skills/tree/main/skills/engineering). The core workflow — careful design Q&A → PRD → vertical-slice TDD — is his.

## License

MIT
