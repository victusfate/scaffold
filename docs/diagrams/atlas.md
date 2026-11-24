# The atlas: claims and code behind a diagram page

A page built from `explorer/<slug>.explorer.json` paraphrases a skill. Its atlas, `explorer/<slug>.atlas.json`,
ties that paraphrase back to the repo: each claim to the line of source it rests on, and each stage to the
code that carries it out. `scripts/render-explorer-pages.ts` turns the atlas into the page's *Code walkthrough*
and *Checked against the source* sections.

## What is judgment and what is checked

| Part | Who produces it | What keeps it true |
|---|---|---|
| A claim's verdict, note and supporting quote | An agent that read the source | The quote must still be in its file, or `npm test` fails |
| Which lines explain a stage, and the explanation | An agent that read the code | The lines must still hash to what was explained, or `npm test` fails |
| What a helper does | An agent that read its definition | The definition must still hash to what was explained, or `npm test` fails |
| Line numbers, the code shown, which helpers an excerpt calls | Script, on every build | Rebuilt from the repo; a moved line only makes the page stale |

Any agent harness can write an atlas; nothing in the build calls a model.

## The file

```json
{
  "summary": "How well the flow matches its source, in two or three sentences.",
  "checks": [
    { "node": "loop", "origin": "spec", "kind": "role", "claim": "The claim as the page words it.",
      "verdict": "confirmed", "file": "skills/tdd.md", "quote": "text copied from the file", "note": "" }
  ],
  "missing": [ { "what": "A rule in the source the flow does not show.", "file": "skills/tdd.md", "quote": "..." } ],
  "code": {
    "overview": "How much of the flow is code, and which files carry it.",
    "refs": [
      { "node": "loop", "file": "scripts/queue.ts", "anchor": "text of one line in the block", "before": 2, "count": 9,
        "hash": "", "title": "claim: lease a task", "explain": "What the lines do.", "why": "What depends on it.",
        "kind": "implements" }
    ],
    "promptOnly": [ { "node": "prep", "what": "What the agent does here from the skill text alone." } ]
  }
}
```

- `node` is a stage id from the spec. `origin` is `spec` or `diagram` (a box only the `.mmd` shows).
- `verdict` is `confirmed`, `partial`, `unsupported` (no quote) or `contradicted`. Write a `note` for all but
  `confirmed`. Set `"elsewhere": true` when the claim holds only in a file the spec's `sources` does not list.
- A code excerpt is the `count` lines that start `before` lines above the line containing `anchor`. Pick an
  anchor of 8 or more characters that appears once in the file. Leave `hash` empty and run
  `npm run diagrams:ack -- <slug>` to record it. `kind` is `implements`, `enforces` or `tests`.
- Acknowledging never guesses: when an anchor finds no block, or several that differ, it stops and asks for
  a new anchor. A claim that is not `unsupported` must carry a `file` and a `quote`.
- A stage with no code gets a `promptOnly` entry, never a loosely related excerpt.
- `explorer/helpers.atlas.json` maps `<file>#<name>` to `{ "explain", "hash" }` for helpers the excerpts call.
  A helper with no entry is shown with its definition only.
- A helper is any top-level name the excerpt mentions that is defined in its file or a file it imports
  (TypeScript, JavaScript and shell). The match is by word, so a name used only in a comment counts.

## Writing or re-checking one

1. Read the spec, its `.mmd`, and every file in the spec's `sources` in full.
2. Check each stage's role, each detail and risk, each flow step, each glossary entry that states a fact, and
   each diagram box the spec does not cover. A claim is `confirmed` only when you found text that says it.
3. List what the source requires that the flow does not show under `missing`.
4. For each stage, find the code that implements or enforces it (`scripts/`, `bin/`, `tools/`,
   `.github/workflows/`, hooks). Read the code you cite. Prefer the implementation over its test.
5. Run `npm run diagrams:ack -- <slug>`, then `npm run diagrams:pages`, and read the page.

## Owner decisions

- **D1, 2026-11-24.** The markdown pages are the in-repo form; no separate HTML export. Owner: "1 - replace".
- **D2, 2026-11-24.** A change to cited code fails the tests. Owner: "lets have the test fail so its forced up to
  date earlier".
- **D3, 2026-11-24.** The agentic task queue diagram has a generated page. Owner: "3 - add iut".
