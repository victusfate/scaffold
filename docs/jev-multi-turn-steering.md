# Jev + LLM: decide with Jev, reason with the LLM

> The routing rule: **when the agent needs to make a decision, send it to Jev.
> When it needs to create something, reason with the LLM.** Deliberating over a
> choice in chain-of-thought is the slow path — a non-generative judgment model
> returns calibrated probabilities in hundreds of milliseconds for a fraction of a
> cent. Install prerequisite: [`jev-openrouter-setup.md`](jev-openrouter-setup.md)
> (registers the `jev_evaluate` tool). Question-writing rules and request shape live
> there and in the pi-typesafe README — this doc covers the decision architecture.

## The rule

An agent's work splits into two kinds of cognition:

| | Example | Right tool |
|---|---|---|
| **Deciding** | which branch to take, whether to retry, which file to edit next, is this failure environmental, does this diff need tests, score this rubric | **Jev** — `jev_evaluate`, typed questions over supplied state |
| **Generating** | writing code, designing an architecture, drafting a plan, multi-step debugging | **The session LLM** — chain-of-thought, tools, synthesis |

The failure mode is doing the first kind in prose. Every time the model "thinks
about whether to X or Y", it pays full output-token price for seconds of reasoning
to produce a verdict a judgment model would return in ~300 ms with calibrated
probabilities — and appends that reasoning to the context, making every later turn
slower and noisier.

**Operationalize it as a reflex:** the moment a turn's next action is a *choice*
rather than a *creation*, write the state down and ask Jev. Reasoning is what you
do when no existing state can answer the question — Jev is what you do whenever
one can.

## Why it is much faster

- **One call replaces a reasoning chain.** ~300 ms flat, versus seconds of
  generation per decision.
- **Batching is free.** 1–32 questions run in parallel inside one request; judging
  five dimensions of a state costs the same latency as judging one. A whole turn's
  decisions can be a single `jev_evaluate` call.
- **Context stays lean.** Judgment state is passed as arguments, not written into
  the transcript. Turn 30 sees the same compact context as turn 3 — long sessions
  don't decay.
- **Consistency compounds.** Calibrated probabilities mean the same state gets the
  same verdict at turn 4 and turn 34, so policy on top of it (thresholds, caps,
  escalation rules) is stable.

## The decision patterns

Four question types cover nearly every decision an agent faces. The state is
whatever the turn already produced — no extra work to build it.

**Continue / stop / retry gates** — after each work unit, instead of deliberating:

```json
{
  "state": { "stderr": "...", "exit_code": 1, "attempt": 3, "goal": "make preflight green" },
  "questions": {
    "failure_class": { "type": "choice", "instructions": "What does stderr indicate?",
      "criteria": { "environmental": "Missing tool, path, or permission", "syntax": "Code error in the diff",
                    "regression": "Previously passing test now fails", "other": "None of these" } },
    "retry": { "type": "noul", "instructions": "Is a retry of the same command likely to succeed?" },
    "escalate": { "type": "noul", "instructions": "Does the state indicate a blocker needing a human decision?" }
  }
}
```

Policy reads the answers mechanically: `escalate ≥ 0.8` → stop and surface; `retry ≥
0.7` → re-run; otherwise branch on `failure_class`. No reasoning chain was spent.

**Branch routing** — one `choice` question over candidate next steps (with a no-match
option) instead of the LLM re-reading and re-weighing each candidate in prose.

**Triage & gates** — batch `noul` questions over a diff or log: side effects, missing
tests, weakened assertions. Batch `score` questions with checkable-situation levels
("Workaround exists", not "medium") for rubric gates.

**Item-wise scoring** — several items (files, reports, lanes) get one named state
field per item (`reports.r1`) and one question per item per dimension; one question
over many items returns an unusable blend.

**Triage of incoming work** — a new ticket, bug report, or user message: one
`choice` for routing, one `noul` for urgency, one `score` for sentiment — all in
the same call, before the LLM has spent a token on it.

## The escalation contract

The split only stays fast if the boundary is explicit:

- **Route back to the LLM when** Jev's confidence < 0.70, the decision needs
  multi-step reasoning, or several judgments are entangled (split them into separate
  questions first — entanglement is a question-writing bug, not a routing one).
- **Report answers as the model's judgments with their probabilities** — never as the
  agent's own conclusions, and never as authorization to act. Confidence is
  distribution concentration, not permission. Actions still go through code or
  explicit rules.
- **Do not include secrets in `state`** — it leaves the machine.

## What this is not for

Jev judges supplied state; it does not calculate, look things up, or generate. Any
step that requires synthesizing new text, running the code, or recalling facts not
in the state stays with the LLM. The rule is not "Jev for everything" — it is
"**Jev for every decision the state can answer**; reasoning for what remains."

## Limits

32 questions and 64 KiB JSON per request, 15 s timeout, 20 attempts per client, no
automatic retries; daily caps via `PI_TYPESAFE_MAX_*`. Bills to your OpenRouter
account. Tool details and troubleshooting: [`jev-openrouter-setup.md`](jev-openrouter-setup.md).
