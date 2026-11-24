# Skill and process diagrams

**Start here: [Scaffold at a glance](pages/system-map.md).** It maps every skill; click a skill link under the map for its own page,
which starts with a one-line overview and drills down: each stage, where it breaks, the full detailed
diagram, the code behind each stage, every claim checked against its source, a glossary, and a block you
can copy into your own LLM to ask follow-up questions. The map page ends with the Flow Atlas: every
page's counts in one table.

## How the pages are made

Everything here is generated. Edit the sources, then regenerate:

| You edit | Generated |
|---|---|
| `explorer/<slug>.explorer.json`: a skill's stages, detail, glossary and questions | `pages/<slug>.md` |
| `src/<slug>.mmd`: the detailed mermaid diagram | `generated/<slug>.svg` (shown on the page) |
| `explorer/<slug>.atlas.json`: each claim's verdict and quote, and the code behind each stage | the page's *Code walkthrough* and *Checked against the source* sections |
| `explorer/helpers.atlas.json`: what each helper does | the helper notes under each code excerpt |

```bash
npm run diagrams                 # every SVG and page
npm run diagrams -- tdd qa       # only these SVGs (pages always rebuild)
npm run diagrams:pages           # only the pages: no browser needed
```

## Keeping them current

`npm test` fails when any of these drift, and says what to run:

| You changed | npm test says | You run |
|---|---|---|
| a `src/<slug>.mmd` | `generated/<slug>.svg is stale` | `npm run diagrams -- <slug>` |
| a spec in `explorer/` | `pages/<slug>.md is stale` | `npm run diagrams` |
| a skill (or `AGENTS.md`) a page summarizes | `<slug>: its sources changed since the page was last reviewed` | check the page still matches, update the spec if not, then `npm run diagrams:ack -- <slug>` |

| code or a doc that moved lines under an excerpt or quote | `pages/<slug>.md is stale` | `npm run diagrams:pages` |
| a block of code a page explains, or a helper it explains | `<slug>: the code cited from <file> changed` (or `helper <file>#<name> changed`) | re-read the explanation in the atlas file, fix it if needed, then `npm run diagrams:ack -- <slug>` |
| a sentence a page quotes | `<slug>: quote no longer in <file>` | re-check that claim in `explorer/<slug>.atlas.json`: new quote, new verdict, or remove it |

The atlas format, what is checked by script and what is an agent's judgment, and how to write one for a
new diagram are in [atlas.md](atlas.md).

It also fails on a link that goes nowhere, a term defined two ways, and `<...>` text GitHub would hide.
Each spec's `sources` lists the files its page summarizes.

## C4 and Structurizr

A page about running software can also be written as C4. A spec opts in with
`"c4": { "system": "<name>" }` and marks the nodes that are not containers (`"c4": { "as": "person" }`,
`external`, `database`, `queue`). `npm run diagrams:c4` then writes [`c4/<slug>.dsl`](c4/), a Structurizr
workspace, and `c4/<slug>.md`, the same views drawn with mermaid. `npm test` fails when either is stale.
Only [the task queue design](c4/agentic-task-queue.md) opts in: the other pages are process flows, whose
stages are not parts of a system. `node scripts/mind-meld.ts c4 . <out-dir>` writes the same two files
for a whole repo from its code.

## Adding a diagram

1. Write `src/<slug>.mmd` (copy an existing one). Keep stage-to-stage arrows between stage boxes so the
   image stays landscape, and define every acronym in its legend.
2. Write `explorer/<slug>.explorer.json` (copy `explorer/feature-chain.explorer.json`): 4–6 stages, one
   flow through them, detail in `details`/`risks`, and `"detail": "../generated/<slug>.svg"`.
3. List the files the page summarizes in `"sources"` (with `"reviewed": ""`), add the skill to
   `explorer/system-map.explorer.json` with `"link": "<slug>.md"`, then run `npm run diagrams` and
   `npm run diagrams:ack -- <slug>`.
4. Optional: write `explorer/<slug>.atlas.json` by following [atlas.md](atlas.md).
