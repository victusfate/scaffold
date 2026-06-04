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

Skills can also be invoked individually: `/grill-with-docs`, `/to-prd`, `/tdd`, `/create-pr`, `/sync-scaffold`, `/code-review`, `/simplify`, `/prune`, `/pause`, `/resume`.

## Structure

```
AGENTS.md                        # agent instructions — single source of truth
CLAUDE.md                        # imports AGENTS.md (@AGENTS.md)
GEMINI.md                        # references AGENTS.md
bin/
  bootstrap.sh                   # one-time setup for downstream repos
  sync-from-scaffold.sh          # pull scaffold updates into a downstream repo
.claude/
  skills/
    RESOLVER.md                  # central routing table — skill → regex → path
    feature-chain/SKILL.md       # full auto-chain: design → PRD → TDD → review
    grill-with-docs/SKILL.md     # design Q&A + visualizations → design.md
    to-prd/SKILL.md              # PRD synthesis → prd.md
    tdd/SKILL.md                 # vertical-slice TDD → plan.md + tdd-log.md
    design-review/SKILL.md       # structural review of design.md (auto-fix in chain)
    code-quality-review/SKILL.md # structural review of implementation (auto-fix in chain)
    code-review/SKILL.md         # correctness + quality review of current diff
    simplify/SKILL.md            # reuse/simplification/efficiency cleanups
    prune/SKILL.md               # aggregate review findings → full feature chain fix
    pause/SKILL.md               # checkpoint session to git for resume on any device
    resume/SKILL.md              # resume from a checkpointed session handoff
    skillify/SKILL.md            # capture a session as a new registered skill + PR
    create-pr/SKILL.md           # create PR + subscribe to activity atomically
    sync-scaffold/SKILL.md       # bootstrap or sync this repo from upstream scaffold
  session-start/
    hook.sh                      # SessionStart hook: fetches origin/main, warns if branch is behind
  read-once/
    hook.sh                      # PreToolUse hook: skips redundant file reads
    compact.sh                   # PostCompact hook: clears read cache after compaction
  settings.json                  # hook wiring (SessionStart, PreToolUse, PostCompact)
.cursor/
  rules/
    agents.mdc                   # thin pointer to AGENTS.md
    grill-with-docs.mdc          # mirrors grill-with-docs skill for Cursor
    to-prd.mdc                   # mirrors to-prd skill for Cursor
    tdd.mdc                      # mirrors tdd skill for Cursor
    design-review.mdc            # mirrors design-review skill for Cursor
    code-quality-review.mdc      # mirrors code-quality-review skill for Cursor
    code-review.mdc              # mirrors code-review skill for Cursor
    simplify.mdc                 # mirrors simplify skill for Cursor
    prune.mdc                    # mirrors prune skill for Cursor
    pause.mdc                    # mirrors pause skill for Cursor
    resume.mdc                   # mirrors resume skill for Cursor
    create-pr.mdc                # mirrors create-pr skill for Cursor
    sync-scaffold.mdc            # mirrors sync-scaffold skill for Cursor
.agents/
  skills/
    feature-chain/SKILL.md       # Antigravity lazy-loaded skill wrapper
    grill-with-docs/SKILL.md
    to-prd/SKILL.md
    tdd/SKILL.md
    design-review/SKILL.md
    code-quality-review/SKILL.md
    code-review/SKILL.md
    simplify/SKILL.md
    prune/SKILL.md
    pause/SKILL.md
    resume/SKILL.md
    skillify/SKILL.md
    create-pr/SKILL.md
    sync-scaffold/SKILL.md
.agent/
  rules/
    agents.md                    # thin pointer to AGENTS.md (always-on)
  workflows/
    feature-chain.md             # Antigravity /slash-command trigger
    grill-with-docs.md
    to-prd.md
    tdd.md
    design-review.md
    code-quality-review.md
    code-review.md
    simplify.md
    prune.md
    pause.md
    resume.md
    skillify.md
    create-pr.md
    sync-scaffold.md
scripts/
  check-resolvable.mjs           # RESOLVER linter (reachability/ambiguity/DRY/MECE/cursor/antigravity/sync)
.githooks/
  pre-commit                     # runs the linter — enable via core.hooksPath
.github/
  scaffold-files.txt             # manifest of files managed by scaffold
  workflows/
    sync-scaffold.yml            # manual workflow to sync updates via PR
.claudeignore                    # excludes build artifacts from Claude's context
```

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

## Credits

The `grill-with-docs`, `to-prd`, and `tdd` skills are adapted from [Matt Pocock's skills repo](https://github.com/mattpocock/skills/tree/main/skills/engineering). The core workflow — careful design Q&A → PRD → vertical-slice TDD — is his.

## License

MIT
