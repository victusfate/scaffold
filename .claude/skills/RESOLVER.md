# RESOLVER — Skill Routing Table

Central routing layer for the skill engine. Every skill on disk MUST be
registered here (enforced by `scripts/check-resolvable.mjs`). The orchestrator
matches user input against **Invocation Regex** top-to-bottom and dispatches to
the first match.

| Skill | Invocation Regex | Path | Purpose |
|---|---|---|---|
| feature-chain | `/(?:^\/feature-chain\b)\|(?:build\|implement\|add)\s+(?:a\s+)?(?:new\s+)?(?:feature\|capability)/i` | `skills/feature-chain.md` | Orchestrate design → PRD → TDD → review end to end |
| grill-with-docs | `/(?:^\/grill-with-docs\b)\|(?:stress[-\s]?test\|sharpen)\s+(?:the\s+)?(?:plan\|design\|idea)/i` | `skills/grill-with-docs.md` | Design Q&A → design.md + canonical vocabulary |
| to-prd | `/(?:^\/to-prd\b)\|(?:write\|create\|generate)\s+(?:a\s+)?prd/i` | `skills/to-prd.md` | Synthesize context + codebase → prd.md |
| tdd | `/(?:^\/tdd\b)\|red[-\s]?green[-\s]?refactor\|test[-\s]?(?:first\|driven)/i` | `skills/tdd.md` | Vertical-slice TDD → plan.md + tdd-log.md |
| design-review | `/(?:^\/design-review\b)\|review\s+(?:the\s+)?design(?:\.md)?/i` | `skills/design-review.md` | Structural review of design.md |
| code-quality-review | `/(?:^\/code-quality-review\b)\|review\s+(?:the\s+)?(?:code\|implementation)\s+quality/i` | `skills/code-quality-review.md` | Structural review of implementation |
| skillify | `/(?:^\/skillify\b)\|(?:turn\s+(?:this\|the)\s+session\s+into\|extract)\s+(?:a\s+)?(?:new\s+)?skill/i` | `skills/skillify.md` | Capture a completed session as a reusable skill + PR to scaffold |
| sync-scaffold | `/(?:^\/sync-scaffold\b)\|(?:sync\|bootstrap)\s+(?:from\s+)?(?:the\s+)?scaffold/i` | `skills/sync-scaffold.md` | Bootstrap scaffold into a repo or sync an existing one from upstream |
| create-pr | `/(?:^\/create-pr\b)\|(?:open\|create\|submit\|make)\s+(?:a\s+)?(?:pull\s+request\|PR)/i` | `skills/create-pr.md` | Create a PR for the current branch and immediately subscribe to its activity |
| code-review | `/(?:^\/code-review\b)\|(?:review\|check)\s+(?:the\s+)?(?:diff\|pr)\s*(?:for\s+bugs)?/i` | `skills/code-review.md` | Review current diff for correctness bugs and quality issues at a configurable effort level |
| simplify | `/(?:^\/simplify\b)\|simplify\s+(?:the\s+)?(?:code\|changed\s+files)/i` | `skills/simplify.md` | Apply reuse, simplification, efficiency, and altitude cleanups to changed code |
| prune | `/(?:^\/prune\b)|(?:deep\s+clean|full\s+quality\s+rework)\s+(?:the\s+)?codebase/i` | `skills/prune.md` | Run all quality review skills and funnel findings into design→PRD→TDD→PR |
| pause | `/(?:^\/pause\b)|(?:pause|checkpoint)\s+(?:the\s+)?(?:session|work)|cache\s+(?:this\s+)?session|save\s+my\s+place|stepping\s+away/i` | `skills/pause.md` | Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume |
| resume | `/(?:^\/resume\b)|resume\s+(?:the\s+)?(?:session|work)|pick\s+up\s+where|continue\s+from\s+(?:the\s+)?handoff|load\s+(?:the\s+)?handoff/i` | `skills/resume.md` | Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device |
| hoist-skill | `/(?:^\/hoist-skill\b)\|(?:hoist\|export\|copy\|add)\s+(?:scaffold\s+)?skills?\s+(?:to\|into)\b/i` | `skills/hoist-skill.md` | Hoist scaffold capabilities into a consumer repo in the target harness format |
| protect-branch | `/(?:^\/protect-branch\b)\|(?:set\s+up\|configure\|check)\s+(?:branch\s+protection\|protected\s+branch)/i` | `skills/protect-branch.md` | Open GitHub branch protection settings for the current repo and show a targeted configuration checklist |

## Column contract

- **Skill** — slug; MUST equal the directory name under `.claude/skills/` and
  the file name under `skills/`.
- **Invocation Regex** — primary trigger wrapped in backticks. Pipe characters
  inside the backtick span are treated as regex alternation, not column
  separators — write `|` freely. The legacy `\|` escape still compiles
  correctly for backwards compatibility. Each regex MUST begin with a unique
  `^\/<slug>` slash-command anchor — that anchor is the deterministic routing
  key the validator checks for collisions.
- **Path** — the canonical `skills/<slug>.md`. MUST exist on disk and MUST be
  listed in `.github/scaffold-files.txt`. Harness-specific wrappers
  (`.claude/skills/<slug>/SKILL.md`, `.cursor/rules/<slug>.mdc`,
  `.agents/skills/<slug>/SKILL.md`, `.agent/workflows/<slug>.md`) `@`-include
  this file — edit here, not in the wrappers.
- **Purpose** — one operational sentence. Two skills with near-identical
  purpose fail the MECE check and must be merged via parameterized args.
