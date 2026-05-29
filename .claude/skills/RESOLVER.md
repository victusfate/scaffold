# RESOLVER — Skill Routing Table

Central routing layer for the skill engine. Every skill on disk MUST be
registered here (enforced by `scripts/check-resolvable.mjs`). The orchestrator
matches user input against **Invocation Regex** top-to-bottom and dispatches to
the first match.

| Skill | Invocation Regex | Path | Purpose |
|---|---|---|---|
| feature-chain | `/(?:^\/feature-chain\b)\|(?:build\|implement\|add)\s+(?:a\s+)?(?:new\s+)?(?:feature\|capability)/i` | `.claude/skills/feature-chain/SKILL.md` | Orchestrate design → PRD → TDD → review end to end |
| grill-with-docs | `/(?:^\/grill-with-docs\b)\|(?:stress[-\s]?test\|sharpen)\s+(?:the\s+)?(?:plan\|design\|idea)/i` | `.claude/skills/grill-with-docs/SKILL.md` | Design Q&A → design.md + canonical vocabulary |
| to-prd | `/(?:^\/to-prd\b)\|(?:write\|create\|generate)\s+(?:a\s+)?prd/i` | `.claude/skills/to-prd/SKILL.md` | Synthesize context + codebase → prd.md |
| tdd | `/(?:^\/tdd\b)\|red[-\s]?green[-\s]?refactor\|test[-\s]?(?:first\|driven)/i` | `.claude/skills/tdd/SKILL.md` | Vertical-slice TDD → plan.md + tdd-log.md |
| design-review | `/(?:^\/design-review\b)\|review\s+(?:the\s+)?design(?:\.md)?/i` | `.claude/skills/design-review/SKILL.md` | Structural review of design.md |
| code-quality-review | `/(?:^\/code-quality-review\b)\|review\s+(?:the\s+)?(?:code\|implementation)\s+quality/i` | `.claude/skills/code-quality-review/SKILL.md` | Structural review of implementation |
| skillify | `/(?:^\/skillify\b)\|(?:turn\s+(?:this\|the)\s+session\s+into\|extract)\s+(?:a\s+)?(?:new\s+)?skill/i` | `.claude/skills/skillify/SKILL.md` | Capture a completed session as a reusable skill + PR to scaffold |

## Column contract

- **Skill** — slug; MUST equal the directory name under `.claude/skills/`.
- **Invocation Regex** — primary trigger. Pipes are escaped (`\|`) so the table
  renders; the validator unescapes before compiling. Each regex MUST begin with
  a unique `^\/<slug>` slash-command anchor — that anchor is the deterministic
  routing key the validator checks for collisions.
- **Path** — the skill's `SKILL.md`. MUST exist on disk and MUST be listed in
  `.github/scaffold-files.txt` so it propagates to downstream repos.
- **Purpose** — one operational sentence. Two skills with near-identical
  purpose fail the MECE check and must be merged via parameterized args.
