## Purpose

Run a high-stakes decision through a **council of five advisors**, each arguing
from a fundamentally different lens, then a peer-review round, then a chairman
synthesis. The value is not a single answer — it is seeing **where the advisors
agree, where they clash, and what to actually do**, instead of one flattened
opinion that hides the tradeoffs.

## When to use / when NOT to use

**Use it for** decisions with genuine uncertainty and real tradeoffs: a pivot,
pricing, positioning, build-vs-buy, a hard hire, which of two architectures,
"is this the right move." Triggers: "council this", "run the council", "war-room
this", "pressure-test this", "stress-test this", "debate this", or a real
"should I X or Y" with stakes.

**Do NOT use it for** factual lookups, simple yes/no questions, creative
generation, summarization, or low-stakes advice — a council is wasted ceremony
there. If the question has a correct answer, just answer it.

## Execution model

The advisors are **isolated subagents** run in parallel — independent context so
each leans fully into its lens without anchoring on the others. Advisors inherit
the session's model; diversity comes from persona, not vendor.

**Phase 1 — Frame (main agent).**
Turn the user's question into a neutral, self-contained brief. Scan the workspace
for grounding context (`CLAUDE.md`/`AGENTS.md`, `docs/**`, relevant source) and
fold in what makes the analysis specific rather than generic. State the decision,
the options on the table, the constraints, and what "success" means. Keep it
even-handed — do not tip the advisors toward an answer.

**Map the shape of the trade space.** Before the advisors weigh in, name the
dimensions the decision actually balances (cost vs speed vs risk vs reversibility
vs …), where the real tension lives, and roughly where the frontier sits — which
options are Pareto-dominated and which are genuine tradeoffs. Include this in the
brief so the council reasons about the real multidimensional space, not a flat
pro/con list. Complex balance work goes wrong when it's flattened to one axis.

**Phase 2 — Advisors (5 isolated subagents, parallel).**
Spawn all five **in a single message** so they run concurrently. Each receives
its lens definition (below) + the framed brief, and is told: respond
independently, do not hedge, lean fully into your perspective. **150–300 words
each.** No advisor sees another's response in this phase.

**Phase 3 — Peer review (5 isolated subagents, parallel).**
Collect the five responses and **anonymize them A–E in randomized order** (so
review judges the argument, not the persona). Give every advisor all five and ask:
- Which response is strongest, and why?
- Which has the biggest blind spot?
- What did all five collectively miss?

**~200 words each.** Run concurrently.

**Phase 4 — Chairman synthesis (main agent).**
Consolidate everything into a verdict in the exact structure below. Do not average
the advisors — weigh them. Name real disagreement rather than papering it into
false consensus.

**Phase 5 — Present in chat.**
Render the chairman synthesis as scannable markdown. No HTML files, no artifacts —
this is a decision aid, delivered inline.

## The five advisors

| Lens | Stance |
|------|--------|
| **The Contrarian** | Hunts for what's wrong, missing, or will fail. Assumes the plan breaks — where and why? |
| **The First-Principles Thinker** | Strips assumptions and rebuilds from the ground up. Challenges whether this is even the right question. |
| **The Expansionist** | Hunts hidden upside and adjacent opportunity. "What if this works better than expected?" |
| **The Outsider** | Brings zero domain context. Catches what experts have stopped seeing; names what's confusing. |
| **The Executor** | Cares only about implementation. "What do you actually do Monday morning?" |

The lenses are built to collide — Contrarian vs Expansionist (downside vs
upside), First-Principles vs Executor (rethink vs ship). That tension is the
point; do not sand it down.

## Output format

```
## Council verdict — <one-line decision>

### Where the council agrees
- <convergent, high-confidence signals>

### Where the council clashes
- <genuine disagreement> — <why each side holds>

### Blind spots the council caught
- <insights surfaced in the peer-review round>

### The recommendation
<a direct answer, not hedged — what you would do and why>

### The one thing to do first
<a single concrete next step>
```

## Rules

- Phases 2 and 3 are read-only analysis — the council never modifies files.
- Advisors run concurrently (one message, five Agent calls); never serialize them.
- Anonymize before peer review — reviewers must not know which persona wrote what.
- The chairman commits to a recommendation; "it depends" is not a verdict.
- If the question is factual or low-stakes, skip the council and just answer.
