# Jev (System 1) via OpenRouter — pi setup

> Copy-paste runbook: add batched Jev judgments to any pi agent, routed through
> OpenRouter (billed to your OpenRouter account, no TypeSafe key needed).
> Design notes: [design.md](design.md). Tested against pi-typesafe 0.7.4, pi 0.87.

## What you get

- **`jev_evaluate`** tool in every pi session: one batched call answers 1–32
  typed questions (Choice / Score / Noul) about a state you supply. Jev is a
  non-generative System 1 model — calibrated probabilities, no prose, no
  hallucinated text, in a few hundred ms for a fraction of a cent.
- Routing: `openrouter.ai/api/alpha/decisions`, model `typesafe/jev-1.13`,
  billed to your OpenRouter account (input tokens only; output is free).
- Key: `OPENROUTER_API_KEY` env var, else **pi's own `/login` store**
  (`~/.pi/agent/auth.json` → `openrouter.key`) — an OpenRouter-provider pi
  agent needs no shell config at all.

## System 1 vs System 2 split

| Tier | Model | Role |
|---|---|---|
| System 1 | `typesafe/jev-1.13` via `jev_evaluate` | micro-decisions: branching, triage, file targeting, binary checks, rubric scores — instead of spending CoT tokens |
| System 2 | your session LLM | architecture, code synthesis, multi-step debugging, anything Jev returns low confidence (< 0.70) on |

Offload evaluation state to `jev_evaluate` in batched calls; keep reasoning
tokens for generative work.

## Install (new system, ~2 minutes)

```bash
# 1. Install pi-typesafe (provides the library the extension builds on)
pi install npm:pi-typesafe

# 2. Ensure the OpenRouter key is reachable — either pi is already logged in:
#      ~/.pi/agent/auth.json contains {"openrouter": {"type": "api_key", "key": "sk-or-..."}}
#    or export it in your shell profile:
echo 'export OPENROUTER_API_KEY="sk-or-v1-xxxxxxxx"' >> ~/.bashrc

# 3. Drop the extension into the personal extensions dir (full file below)
mkdir -p ~/.pi/agent/extensions
$EDITOR ~/.pi/agent/extensions/jev-openrouter.ts   # paste the file from this doc

# 4. One-time loadability fixes (see Troubleshooting for the failure modes):
#    a. `pi install` lands the lib in ~/.pi/agent/npm/node_modules, which is NOT on
#       the extensions dir's module-resolution path — expose it:
ln -s npm/node_modules ~/.pi/agent/node_modules
#    b. pi-typesafe is ESM-only but pi compiles extensions as CJS — mark the dir ESM:
printf '{\n  "type": "module"\n}\n' > ~/.pi/agent/extensions/package.json
#    c. the extension imports @earendil-works/pi-tui — install it next to pi-typesafe:
( cd ~/.pi/agent/npm && npm install @earendil-works/pi-tui )
```

Verify the extension loads before starting the session (should print
`LOADED OK, exports: [ 'default' ]`):

```bash
cd ~/.pi/agent/extensions && npx -y tsx -e \
  "import('./jev-openrouter.ts').then(m => console.log('LOADED OK', Object.keys(m)))"
```

Start a **new pi session** (tools register at startup) and verify:

```
/typesafe status        # informational only — describes the TypeSafe key, not this tool
```

Then just ask the agent to use it, e.g. "triage these three failures with
jev_evaluate". Without a usable key the first call throws a `configuration`
error naming both key paths — it cannot fail silently.

## The extension file

`~/.pi/agent/extensions/jev-openrouter.ts`:

```typescript
// Jev judgments over OpenRouter — a sibling tool to pi-typesafe's `typesafe_evaluate`.
//
// pi-typesafe's bundled tool hardcodes the TypeSafe backend (api.typesafe.ai key). This
// extension registers `jev_evaluate` with the SAME request schema, routed through
// createTypeSafe({ backend: "openrouter" }): key from OPENROUTER_API_KEY (or pi's /login
// store), model typesafe/jev-1.13. Usage bills to your OpenRouter account.
// /typesafe login and /typesafe enable do NOT apply — they drive the TypeSafe backend.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTypeSafe } from "pi-typesafe";
import { DEFAULT_MAX_INPUT_BYTES, DEFAULT_MAX_REQUESTS, normalizeEvaluationRequest } from "pi-typesafe";
import { TypeSafeIntegrationError } from "pi-typesafe";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";

const disclosure =
  "Submitted state and questions will be sent to openrouter.ai (model typesafe/jev-1.13) " +
  "and billed to your OpenRouter account. Do not include secrets. Results are model " +
  "judgments, not proof or authorization.";

const sample = {
  state: { message: "I was charged twice for my subscription. Please help today." },
  questions: {
    category: {
      type: "choice",
      instructions: "Which team should handle this message?",
      criteria: { billing: "Charges and payments", technical: "Software failures", other: "None of these" },
    },
    urgent: { type: "noul", instructions: "Does the sender request help today?" },
    frustration: {
      type: "score",
      instructions: "How frustrated does the sender sound?",
      criteria: ["Neutral request", "Frustrated but civil", "Angry or threatening"],
    },
  },
};

function format(result: any, expanded = false): string {
  const lines = [`Jev·OpenRouter · ${JSON.stringify(result.model)} · ${result.elapsedMs} ms`];
  for (const [id, answer] of Object.entries<any>(result.answers)) {
    const label = JSON.stringify(id);
    if (answer.type === "noul") lines.push(`${label}: P(yes) = ${answer.noul.toFixed(3)}`);
    else if (answer.type === "choice")
      lines.push(`${label}: ${JSON.stringify(answer.choice)} · confidence ${answer.confidence.toFixed(3)}`);
    else lines.push(`${label}: ${answer.score.toFixed(3)} · confidence ${answer.confidence.toFixed(3)}`);
    if (expanded && answer.type !== "noul") lines.push(`  ${JSON.stringify(answer.probabilities)}`);
  }
  lines.push(`${result.usage.input_tokens} input / ${result.usage.output_tokens} output tokens`);
  lines.push("Confidence is distribution concentration, not proof of correctness.");
  return lines.join("\n");
}

function piOpenRouterKey(): string | undefined {
  // Pi's own credential store (the key /login saves): ~/.pi/agent/auth.json -> {openrouter:{type,key}}
  try {
    const parsed = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8"));
    const key = parsed?.openrouter?.key;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

function resolveKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY?.trim() || piOpenRouterKey();
}

export default function jevOpenRouterExtension(pi: ExtensionAPI): void {
  let client: ReturnType<typeof createTypeSafe> | undefined;

  pi.registerTool({
    name: "jev_evaluate",
    label: "Jev (OpenRouter)",
    description:
      `Evaluate supplied state with independent Choice, Score, and Noul questions in one ` +
      `Jev request routed via OpenRouter (model typesafe/jev-1.13). Each question judges the ` +
      `whole state, so when several items are involved, put each item in a named state field ` +
      `(e.g. \`reports.r1\`) and ask one question per item per dimension; never aggregate ` +
      `several items into one question. ${disclosure} Requires OPENROUTER_API_KEY in the ` +
      `environment (or Pi's /login store). Limit: 32 questions, ` +
      `${Math.round(DEFAULT_MAX_INPUT_BYTES / 1024)} KiB JSON, ${DEFAULT_MAX_REQUESTS} attempts ` +
      `per session; no retries.`,
    promptSnippet: "Ask batched structured questions with Jev via OpenRouter (external service)",
    promptGuidelines: [
      `Request shape, all three question kinds in one call: ${JSON.stringify(sample)}`,
      "Use jev_evaluate only for requested semantic judgments, not calculations or exact lookups; send only the relevant permitted data.",
      "Batch independent jev_evaluate questions over the same state; use code or explicit permission rules for actions, never confidence as authorization.",
      "When jev_evaluate judges several items, give each item a named state field and ask one question per item per dimension, naming the field in the instructions; one question over many items returns an unusable blend.",
      "Report jev_evaluate answers as the model's judgments with their probabilities; do not replace them with your own guesses, and say when an answer is uncertain.",
    ],
    parameters: {
      type: "object",
      properties: {
        state: { type: ["object", "string"], description: "The state to judge (JSON object or string)." },
        questions: {
          type: "object",
          description:
            "1-32 named questions. Each: {type:'choice',instructions,criteria:{key:label}} | " +
            "{type:'noul',instructions} | {type:'score',instructions,criteria:[levels...]}.",
          additionalProperties: true,
        },
      },
      required: ["state", "questions"],
    },
    prepareArguments: (args: any) => normalizeEvaluationRequest(args),
    async execute(_id: string, params: any, signal?: AbortSignal) {
      const key = resolveKey();
      if (!key) {
        throw new TypeSafeIntegrationError(
          "configuration",
          "No OpenRouter key: set OPENROUTER_API_KEY or log in via Pi's /login " +
            "(stored at ~/.pi/agent/auth.json). /typesafe login does not apply to the OpenRouter backend.",
        );
      }
      client ??= createTypeSafe({ backend: "openrouter", apiKey: key, maxRequests: DEFAULT_MAX_REQUESTS });
      const request = normalizeEvaluationRequest(params);
      try {
        const result = await client.evaluate(request, signal ? { signal } : {});
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      } catch (error) {
        const safe =
          error instanceof TypeSafeIntegrationError ? error : new TypeSafeIntegrationError("http", String(error));
        throw safe;
      }
    },
    renderCall(args: any) {
      return new Text(`Jev·OpenRouter · ${Object.keys(args?.questions ?? {}).length} questions · external request`, 0, 0);
    },
    renderResult(result: any, { expanded, isPartial }: any) {
      if (isPartial) return new Text("Jev·OpenRouter · waiting for response", 0, 0);
      if (!result?.details?.answers)
        return new Text((result?.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n"), 0, 0);
      return new Text(format(result.details, expanded), 0, 0);
    },
  });
}
```

## Request shape

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

Answers come back as `category: {choice, probabilities, confidence}`,
`urgent: {noul: 0.99}`, `frustration: {score, probabilities, confidence}` plus
model/usage/elapsedMs. Every question runs in parallel and in isolation —
batching more questions barely changes latency.

## Writing questions that work

- Ask about what the state **says**, not what you would conclude ("Does the
  reporter state the problem occurs consistently?", not "Is the bug real?").
- Describe Score levels as checkable situations, not degrees ("Workaround
  exists", not "medium").
- Include a no-match option (`other`, `unclear`) in Choice questions.
- One judgment per question; multiple items → one named state field per item
  (`reports.r1`), one question per item per dimension.
- Read probability + confidence together; confidence is distribution
  concentration, not proof or authorization to act.

## Uninstall / disable

```bash
rm ~/.pi/agent/extensions/jev-openrouter.ts   # tool gone next session
pi remove npm:pi-typesafe                      # also remove the library (optional)
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `No OpenRouter key` on first call | Neither `OPENROUTER_API_KEY` nor `~/.pi/agent/auth.json` has a key — run `/login` in pi or export the var, then restart the session |
| 401/403 from openrouter.ai | Key invalid or revoked — re-login |
| 402 | OpenRouter credits exhausted — top up at openrouter.ai/credits |
| Tool not listed in a session | Tools register at startup — start a new session; check the file is at `~/.pi/agent/extensions/jev-openrouter.ts` |
| `Failed to load extension: Cannot find module 'pi-typesafe'` | `pi install` puts the lib in `~/.pi/agent/npm/node_modules`, which is not on the extensions dir's module-resolution path — `ln -s npm/node_modules ~/.pi/agent/node_modules` |
| `No "exports" main defined in .../pi-typesafe/package.json` | pi-typesafe is ESM-only (only `"import"` conditions in its exports map) and pi compiles the extension as CJS — write `{"type": "module"}` to `~/.pi/agent/extensions/package.json` so tsx loads it as ESM |
| `Cannot find package '@earendil-works/pi-tui'` | Install it next to pi-typesafe: `( cd ~/.pi/agent/npm && npm install @earendil-works/pi-tui )` — pin it to your pi's bundled version if peer versions clash |
| Want the TypeSafe-hosted tool instead | Skip this extension; `/typesafe login` + `/typesafe enable` and use `typesafe_evaluate` |

## Related

- Steering architecture — pairing Jev with the session LLM for fast multi-turn
  decisions: [jev-multi-turn-steering.md](jev-multi-turn-steering.md)
- pi-typesafe README (question-writing guidance, caps): `~/.pi/agent/npm/node_modules/pi-typesafe/README.md`
- TypeSafe primitives docs: https://docs.typesafe.ai/primitives
- OpenRouter decisions endpoint: `POST https://openrouter.ai/api/alpha/decisions`
