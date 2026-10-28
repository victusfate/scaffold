# Context engineering and review economics

**Tier: durable.** These rules steer every agent that reads `AGENTS.md`, and the scripts gate handoffs.

## Sources

- IBM Technology, *Context Engineering for AI Agents: 4 Failure Modes to Avoid*: context **poisoning**,
  **distraction**, **confusion** and **clash**, fixed by **validate**, **compact**, **curate** and **prune**.
- Laurie Voss, *AI Writes the Code. So What's Left for Engineers?* (AI Engineer): code volume up 741%,
  shipping only about 30% faster. The bottleneck moved from writing to knowing whether to trust what was
  written. Advice: verify cheaply by machine, spend human review where the blast radius is high, encode
  judgment as specs, rubrics and evals, and measure delivery rather than output.

## The shared idea

Both talks describe one failure: **something plausible gets accepted without being checked.** For an
agent it is an unverified note that later turns treat as fact. For a team it is generated code merged on
trust. Both have the same fix: verify by machine where a check is cheap, and spend the scarce attention
(the model's context window, a human reviewer's hour) only where it changes the outcome.

## What the harness had, and the gaps

| Failure | Fix | Already in the harness | Gap closed here |
|---|---|---|---|
| Poisoning | Validate | Veracity (verify *user* premises); evidence that goes stale (`docs/knowledge-architecture.md`) | The agent's *own* conclusions reached handoffs, plans and memory unchecked. Handoff claims are now marked `[verified: <cmd>]` or `[unverified]`, and `/resume` re-checks before acting. |
| Distraction | Compact | `/save`, `/pause`, `/resume`, the `PostCompact` read-once hook | No trigger said *when* to restart from a summary. A handoff is now capped in size and holds state, not a log. |
| Confusion | Curate | Nothing | Load tools on demand; give each subagent only its lane's tools; never enable a server project-wide for one task. |
| Clash | Prune | `supersedes` in the decision-registry design | Handoffs, plans and notes kept wrong facts next to their corrections. Now: rewrite in place, and `check-handoff` rejects correction markers. |
| Trust gap (Voss) | Verify cheaply, focus humans | Scanners, `/validate`, `/code-refiner`, the line-by-line `## Security review` | Agent review now ends with `### Human review focus`: questions on the few hunks where a person's judgment matters. |
| Measure delivery (Voss) | Real signal | Nothing | `scripts/delivery-metrics.ts`: merges per week, open-to-merge time, the green-to-merge gap, change-request follow-through. |

## Decisions

- **D1 — agent review stays line by line; it points humans at what matters.** Owner, 2026-10-28:
  "Voss is talking about human review not agent review, agent review should be line by line but it should
  highlight areas most criticsal to human feedback in the q&a section". So the gate's every-file rule is
  unchanged, and the review gains a Q&A-style `### Human review focus` subsection inside
  `## Security review`. The gate's files are not edited: a gate change needs the owner's sign-off.
- **D2 — one PR for the whole change.** Owner, 2026-10-28: chose "All in one PR".
- **D3 — curation is a rule, not a script.** How many tools are loaded depends on the harness and is not
  visible to a repo script in every client, so there is no portable deterministic check. The rule names
  the behaviour, and the session-start report is left unchanged.
- **D4 — the stale `.pause/handoff.md` on `main` is removed.** It described a voice-chat adoption merged
  months earlier, and any `/resume` would have read it as current state. That was the exact poisoning
  this change targets.

## Vocabulary

- **Verified claim:** a fact in a handoff or plan followed by `[verified: <command or file:line>]` that a
  reader can re-run.
- **Unverified claim:** marked `[unverified]`. It is a hypothesis to test, never a premise to act on.
- **Superseded note:** text that a later fact contradicts. It is deleted or rewritten, never left beside its
  correction.
- **Human review focus:** the short list of hunks, each with a specific question, where a person's product
  or blast-radius judgment changes the merge decision.
