# Design: upstream-skills

Adds three scaffold skills adapted from popular MIT-licensed community skill packs,
and wires them into the existing flows. Scope was set by the user: only the three
"worth adding" picks from the review of the LinkedIn top-12 list.

## Q&A (resolved from the user's direction)

**Q: Which upstream skills, and which parts of them?**
A: Three picks, each filling a gap scaffold has today:

| Scaffold skill | Upstream source (license) | Part taken |
|---|---|---|
| `/qa` | [garrytan/gstack](https://github.com/garrytan/gstack) `qa/` (MIT) | Test → triage → fix-with-regression → re-verify loop, severity tiers, self-regulation stop rule. Not taken: gstack's browse daemon, learnings store, telemetry, health-score rubric. |
| `/investigate` | [obra/superpowers](https://github.com/obra/superpowers) `systematic-debugging` + `verification-before-completion` (MIT) | Four-phase root-cause method, the 3-failed-fixes architecture stop, evidence-before-claims gate. |
| `/deslop` | [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop) (MIT) | Edit/detect modes, word and pattern lists, voice-preservation rule, self-eval checklist. Not taken: satire mode. |

**Q: Vendor upstream text verbatim, or adapt?**
A: Adapt. Each upstream skill depends on its own runtime (gstack's `~/.claude/skills/gstack/bin/*`,
superpowers' cross-skill names). Scaffold versions are self-contained, use scaffold's
own skills for the handoffs (`/tdd`, `/validate`, `/create-pr`), and credit the source
with an "Adapted from … (MIT)" line, the same way `ponytail` credits its upstream.

**Q: Why `/investigate` and not `/debug`?**
A: Claude Code ships a built-in `/debug`; `docs/agent-authoring-requirements.md` §4
forbids colliding with built-ins. `/investigate` is also gstack's name for the same job.

**Q: Does `/qa` ship a browser driver script?**
A: No. It uses whatever the target repo already has (Playwright, Cypress, its own e2e
runner, `curl` for APIs, the CLI itself). Adding a Playwright dependency to scaffold
for every consumer is not justified by one skill. Revisit if consumers keep
re-writing the same probe.

**Q: Where does each skill hook into existing flows?**
A:
- `/qa` → `/feature-chain` Phase 3, after `/code-refiner`, when the feature has a
  user-facing entry point (UI route, API endpoint, CLI command). It is the
  executable form of AGENTS.md *Veracity — "done" means reachable*. Skipped for
  internal-only changes, with the reason stated in the Phase 4 summary.
- `/investigate` → `/create-pr` Step 2's auto-correction "Diagnose" step, and
  `/tdd` when a test fails for a reason the current slice did not predict.
- `/deslop` → `/create-pr` Step 6, run in edit mode on the drafted PR
  title and body before the PR is created. It enforces the AGENTS.md rule against
  self-labels like "honest" / "to be clear".

**Q: Home (agent-authoring-requirements §1)?**
A: Prompt skills: canonical `skills/<name>.md` plus the four harness wrappers,
registered in RESOLVER.md and the sync manifest. No new tool, script, or bin.

**Q: How hard should `/deslop` edit engineering docs?** (added after first review)
A: Barely. The user's direction: it must not lose essential engineering
documentation; its job is to make user-facing content sound like normal people
wrote it. So `/deslop` picks a pass per section. User-facing text (README intro,
release notes, PR Summary, UI copy) gets a full plain-language rewrite.
Engineering reference (design/PRD/plan, AGENTS.md, skill bodies, API docs,
runbooks) gets a filler-only pass, or detect mode when unsure. In both passes,
steps, commands, constraints, caveats, numbers, rationale, and MUST/NEVER rules
are never removed, and terms of art are not treated as slop.

## Canonical vocabulary

- **Upstream skill** — the third-party skill a scaffold skill is adapted from.
- **Surface** — what `/qa` exercises: browser page, HTTP API, CLI command, or job.
- **Probe** — one scripted interaction with a surface that yields evidence
  (screenshot, response body, exit code + output).
- **Fix tier** — which severities `/qa` repairs: quick (critical+high), standard
  (+medium, default), exhaustive (+low).
- **Root cause** — the earliest point in the data/control flow where behavior
  diverges from intent; `/investigate` fixes there, not at the symptom.
- **Evidence** — command output, screenshot, or exit code produced in the current
  turn. A claim of "works / fixed / passes" without fresh evidence is not allowed.
- **User-facing pass / engineering pass** — `/deslop`'s full plain-language
  rewrite vs. its filler-only edit that preserves every technical statement.
- **Slop pattern** — a named writing pattern from the `/deslop` list; findings
  cite the pattern name and quote the line.
