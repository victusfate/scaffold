> **Multi-harness:** This skill works identically in Claude Code, Codex, pi, and agy. All paths
> and commands are harness-agnostic. The pi extension file below is pi-specific; the
> System 1 / System 2 routing policy applies in every harness.

## Purpose

Add **Jev** (System 1) judgments to a pi agent, routed through **OpenRouter**, so
micro-decisions stop consuming chain-of-thought tokens. Jev (`typesafe/jev-1.13`)
is a non-generative judgment model: send state + typed questions, get calibrated
probabilities back in one parallel pass — no prose, no hallucinated text, a few
hundred ms, a fraction of a cent per call.

The result is a two-tier split:

| Tier | Model | Role |
|---|---|---|
| System 1 | `typesafe/jev-1.13` via `jev_evaluate` | branching, test/log triage, file targeting, binary checks, rubric scores |
| System 2 | the session LLM | architecture, code synthesis, multi-step debugging; also anything Jev returns confidence < 0.70 on |

pi-typesafe's shipped `typesafe_evaluate` tool hardcodes the TypeSafe backend
(`api.typesafe.ai`). This flow registers a sibling tool, **`jev_evaluate`**, with
the same request schema, routed through `openrouter.ai/api/alpha/decisions` and
billed to your OpenRouter account (input tokens only; output is free).

## Install (new system, ~2 minutes)

```bash
# 1. Install pi-typesafe (the library the extension builds on)
pi install npm:pi-typesafe

# 2. Key: OPENROUTER_API_KEY env var, else pi's own /login store
#    (~/.pi/agent/auth.json -> {"openrouter": {"type": "api_key", "key": "sk-or-..."}}).
#    An OpenRouter-provider pi agent already has it; otherwise:
echo 'export OPENROUTER_API_KEY="sk-or-v1-xxxxxxxx"' >> ~/.bashrc

# 3. Drop the extension into the personal extensions dir (full file below)
mkdir -p ~/.pi/agent/extensions
$EDITOR ~/.pi/agent/extensions/jev-openrouter.ts   # paste the file from this skill

# 4. One-time loadability fixes (root causes in the setup doc's Troubleshooting):
ln -s npm/node_modules ~/.pi/agent/node_modules          # expose pi install's node_modules to the extensions dir
printf '{\n  "type": "module"\n}\n' > ~/.pi/agent/extensions/package.json   # pi-typesafe is ESM-only
( cd ~/.pi/agent/npm && npm install @earendil-works/pi-tui )                # imported by the extension

cd ~/.pi/agent/extensions && npx -y tsx -e \
  "import('./jev-openrouter.ts').then(m => console.log('LOADED OK', Object.keys(m)))"   # expect LOADED OK
```

Start a **new pi session** (tools register at startup). There is no enable gate:
the tool is active whenever a key resolves, and without a key the first call
throws a loud `configuration` error naming both key paths — it cannot fail
silently. `/typesafe login` and `/typesafe enable` apply only to the TypeSafe
backend; this tool needs neither.

Verify with a smoke test outside pi (mirrors what the tool does):

```bash
node -e '
import("/home/messel/.pi/agent/npm/node_modules/pi-typesafe/dist/index.js").then(async ({ createTypeSafe }) => {
  const { readFileSync } = await import("node:fs");
  const stored = JSON.parse(readFileSync(process.env.HOME + "/.pi/agent/auth.json", "utf8"));
  const key = process.env.OPENROUTER_API_KEY || stored?.openrouter?.key;
  const client = createTypeSafe({ backend: "openrouter", apiKey: key, maxRequests: 1 });
  const r = await client.evaluate({
    state: { message: "I was charged twice for my subscription. Please help today." },
    questions: {
      category: { type: "choice", instructions: "Which team should handle this?",
        criteria: { billing: "Charges and payments", technical: "Software failures", other: "None of these" } },
      urgent: { type: "noul", instructions: "Does the sender request help today?" },
    },
  }, {});
  console.log(JSON.stringify({ model: r.model, answers: r.answers, usage: r.usage, ms: r.elapsedMs }));
});'
```

Expected: answers with probabilities (e.g. `urgent: P(yes) = 0.99`), ~300–400 ms,
~$0.00002. Verified 2026-09-25 against pi-typesafe 0.7.4, pi 0.87.

## The extension file

`~/.pi/agent/extensions/jev-openrouter.ts` — keep byte-identical with
[`docs/jev-openrouter-setup.md`](../docs/jev-openrouter-setup.md) (the doc
is the copy-paste source; this skill references it):

Read and follow the complete setup runbook in
[`docs/jev-openrouter-setup.md`](../docs/jev-openrouter-setup.md), which
contains the full extension source, request shape, question-writing guidance,
and troubleshooting table.

## Using it in a session

Jev-first routing by decision class, with the exceptions named explicitly (no
routing-percentage belongs in agent-facing text — it invites Goodharting; the
ratio is an output of the workload, not a control knob):

- **Jev by default:** test/build triage (`state: { stderr, exit_code }`; one
  `choice` (environmental / syntax / regression) + one `noul` (safe to retry)),
  diff & acceptance gates (`noul` over side effects, missing tests, weakened
  assertions), file/module targeting (batch-score candidate paths instead of
  reading each file), rubric scores, continue/stop/retry gates, routing of
  incoming messages.
- **System 2, named as the exception:** multi-step debugging, architecture and
  code synthesis, anything requiring running code or synthesizing text not in
  the state, and entangled judgments (split them into separate questions first —
  entanglement is a question-writing bug, not a routing one).

**Hydrate state before asking.** Low confidence almost always means thin state,
not a hard question — and a call on thin state costs the round trip *and* the
reasoning anyway. Before calling, check the state contains the artifacts the
questions reference (the actual stderr, the actual diff, the actual candidates).
On confidence < 0.70: enrich the state and re-ask **once**; if it stays low,
escalate to reasoning **with the judgment and its probabilities attached** —
the signal is not wasted.

**Batch the turn, not the thought.** 1–32 questions run in parallel in one
request, so a whole turn's pending micro-decisions fit a single end-of-turn
`jev_evaluate` call instead of one call per thought.

Full decision architecture and anti-patterns:
[`docs/jev-multi-turn-steering.md`](../docs/jev-multi-turn-steering.md).

Request shape (all three question kinds in one call; every question judges the
whole state):

```json
{
  "state": { "message": "I was charged twice for my subscription. Please help today." },
  "questions": {
    "category": { "type": "choice", "instructions": "Which team should handle this?",
                  "criteria": { "billing": "Charges and payments", "technical": "Software failures", "other": "None of these" } },
    "urgent":   { "type": "noul", "instructions": "Does the sender request help today?" },
    "frustration": { "type": "score", "instructions": "How frustrated does the sender sound?",
                     "criteria": ["Neutral request", "Frustrated but civil", "Angry or threatening"] }
  }
}
```

Question-writing rules: ask what the state *says* (not what you would conclude);
describe Score levels as checkable situations, not degrees; include a no-match
option in Choice questions; one judgment per question; multiple items → one
named state field per item (`reports.r1`), one question per item per dimension.
Report answers as the model's judgments with their probabilities — never as your
own conclusions, and never as authorization to act (confidence is distribution
concentration, not permission).

## Limits

- 32 questions, 64 KiB JSON per request; 15 s timeout; 20 attempts per client
  instance; no automatic retries. Daily caps via `PI_TYPESAFE_MAX_*` env vars.
- Bills to your OpenRouter account. Do not include secrets in `state`.
- The tool loads in **new sessions only**; remove
  `~/.pi/agent/extensions/jev-openrouter.ts` to disable it.

## Uninstall

```bash
rm ~/.pi/agent/extensions/jev-openrouter.ts   # tool gone next session
pi remove npm:pi-typesafe                      # also remove the library (optional)
```
