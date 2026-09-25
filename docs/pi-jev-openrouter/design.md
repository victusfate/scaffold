# Design: Jev (System 1) via OpenRouter for pi

> Feature: a pi extension (`jev-openrouter.ts`) plus this install doc, so any pi
> agent on any system can add batched Jev judgments routed through OpenRouter.

## Problem

pi-typesafe's bundled `typesafe_evaluate` tool hardcodes the TypeSafe backend
(`api.typesafe.ai`, key from `TYPESAFE_API_KEY` or `/typesafe login`). Agents
whose inference already runs through OpenRouter want Jev (`typesafe/jev-1.13`)
judgments billed to the same OpenRouter account, with no second key store.

pi-typesafe's library API already supports this (`createTypeSafe({ backend:
"openrouter" })`, key from `OPENROUTER_API_KEY`), but no shipped surface exposes
it as a tool. The gap is one small extension file plus copy-paste setup docs.

## Q&A

**Q: Extend pi-typesafe in place, or a sibling extension?**
A: Sibling extension in `~/.pi/agent/extensions/`. It uses only pi-typesafe's
public API (`createTypeSafe`, `normalizeEvaluationRequest`), survives package
updates, and keeps the two backends' billing/consent stories separate (the
shipped `/typesafe` commands and `typesafe_evaluate` stay TypeSafe-only by
design — their README states the tool always uses the TypeSafe backend).

**Q: New tool name or same name?**
A: `jev_evaluate`. Same request schema (Choice / Score / Noul, 1–32 questions)
so prompts written for `typesafe_evaluate` transfer unchanged, but the name
makes which backend (and whose bill) unambiguous in transcripts.

**Q: Where does the key come from?**
A: `OPENROUTER_API_KEY` env var first; fallback to pi's own `/login` store
(`~/.pi/agent/auth.json` → `openrouter.key`). A pi agent that already uses
OpenRouter as its provider therefore needs zero shell config.

**Q: Opt-in gate like `/typesafe enable`?**
A: No gate. The tool is active whenever a key resolves; without a key it throws
a `configuration` error naming both key paths. Simpler, and an enabled-but-keyless
tool looking like a working one is the failure mode pi-typesafe warns about —
here the failure is loud on first call.

## Decisions

- **Extension home:** `~/.pi/agent/extensions/jev-openrouter.ts` (personal
  dir; jiti loads TypeScript directly; no package.json needed because pi-typesafe
  is resolvable from pi's package dir).
- **Model:** backend default `typesafe/jev-1.13` (OpenRouter's pinned Jev
  version). No override knob until one is needed.
- **Budgets:** same defaults as the shipped tool (`DEFAULT_MAX_REQUESTS` = 20
  attempts per client instance; 64 KiB JSON; 15 s timeout; no retries). Daily
  caps available via `PI_TYPESAFE_MAX_*` env vars if a run needs bounding.
- **Verified:** real round-trip through `openrouter.ai/api/alpha/decisions`
  returned calibrated answers in ~330 ms at ~$0.000017/request (2026-09-25).

## Canonical vocabulary

- **Jev** — TypeSafe's non-generative judgment model; answers typed questions
  with probabilities, not prose.
- **`jev_evaluate`** — the tool this extension registers (OpenRouter-routed).
- **`typesafe_evaluate`** — pi-typesafe's shipped tool (TypeSafe-routed).
- **backend** — pi-typesafe's routing target: `"typesafe"` (default) or
  `"openrouter"`.
