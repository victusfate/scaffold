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

## Column contract

- **Skill** — slug; MUST equal the directory name under `.claude/skills/` and
  the file name under `skills/`.
- **Invocation Regex** — primary trigger. Pipes are escaped (`\|`) so the table
  renders; the validator unescapes before compiling. Each regex MUST begin with
  a unique `^\/<slug>` slash-command anchor — that anchor is the deterministic
  routing key the validator checks for collisions.
- **Path** — the canonical `skills/<slug>.md`. MUST exist on disk and MUST be
  listed in `.github/scaffold-files.txt`. Harness-specific wrappers
  (`.claude/skills/<slug>/SKILL.md`, `.cursor/rules/<slug>.mdc`) `@`-include
  this file — edit here, not in the wrappers.
- **Purpose** — one operational sentence. Two skills with near-identical
  purpose fail the MECE check and must be merged via parameterized args.
