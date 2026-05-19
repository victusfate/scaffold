# scaffold

A minimal, cross-harness project scaffold for AI-assisted development. Drop it into any new project to get a consistent design → PRD → TDD workflow whether you're using Claude Code, Cursor, or Gemini CLI.

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

Skills can also be invoked individually: `/grill-with-docs`, `/to-prd`, `/tdd`.

## Structure

```
AGENTS.md                        # agent instructions — single source of truth
CLAUDE.md                        # imports AGENTS.md (@AGENTS.md)
GEMINI.md                        # references AGENTS.md
.claude/
  skills/
    feature-chain/SKILL.md       # full auto-chain: design → PRD → TDD → review
    grill-with-docs/SKILL.md     # design Q&A + visualizations → design.md
    to-prd/SKILL.md              # PRD synthesis → prd.md
    tdd/SKILL.md                 # vertical-slice TDD → plan.md + tdd-log.md
  read-once/
    hook.sh                      # PreToolUse hook: skips redundant file reads
    compact.sh                   # PostCompact hook: clears read cache after compaction
  settings.json                  # hook wiring
.cursor/
  rules/
    agents.mdc                   # thin pointer to AGENTS.md
    grill-with-docs.mdc          # mirrors grill-with-docs skill for Cursor
    to-prd.mdc                   # mirrors to-prd skill for Cursor
    tdd.mdc                      # mirrors tdd skill for Cursor
.claudeignore                    # excludes build artifacts from Claude's context
```

## Harness support

| Harness | How it reads instructions |
|---|---|
| Claude Code | `CLAUDE.md` → imports `AGENTS.md`; `/skill-name` invokes skills |
| Cursor | `.cursor/rules/*.mdc` — description-driven activation |
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

## Global installation

To make the skills available in every project (not just this one):

```bash
mkdir -p ~/.claude/skills
cp -r .claude/skills/* ~/.claude/skills/
```

Project-level skills override global ones when names match.

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
