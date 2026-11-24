# Skill and process diagrams

**Start here: [Scaffold at a glance](pages/system-map.md).** It maps every skill; click a skill link under the map for its own page,
which starts with a one-line overview and drills down: each stage, where it breaks, the full detailed
diagram, a glossary, and a block you can copy into your own LLM to ask follow-up questions.

For all the diagrams in one page, with the code behind each stage and a check of every claim against its
skill doc, see the [Flow Atlas](../flow-atlas/README.md) (a dated snapshot).

## How the pages are made

Everything here is generated. Edit the sources, then regenerate:

| You edit | Generated |
|---|---|
| `explorer/<slug>.explorer.json`: a skill's stages, detail, glossary and questions | `pages/<slug>.md` |
| `src/<slug>.mmd`: the detailed mermaid diagram | `generated/<slug>.svg` (shown on the page) |

```bash
npm run diagrams                 # every SVG and page
npm run diagrams -- tdd qa       # only these SVGs (pages always rebuild)
```

## Keeping them current

`npm test` fails when any of these drift, and says what to run:

| You changed | npm test says | You run |
|---|---|---|
| a `src/<slug>.mmd` | `generated/<slug>.svg is stale` | `npm run diagrams -- <slug>` |
| a spec in `explorer/` | `pages/<slug>.md is stale` | `npm run diagrams` |
| a skill (or `AGENTS.md`) a page summarizes | `<slug>: its sources changed since the page was last reviewed` | check the page still matches, update the spec if not, then `npm run diagrams:ack -- <slug>` |

It also fails on a link that goes nowhere, a term defined two ways, and `<...>` text GitHub would hide.
Each spec's `sources` lists the files its page summarizes.

## Adding a diagram

1. Write `src/<slug>.mmd` (copy an existing one). Keep stage-to-stage arrows between stage boxes so the
   image stays landscape, and define every acronym in its legend.
2. Write `explorer/<slug>.explorer.json` (copy `explorer/feature-chain.explorer.json`): 4–6 stages, one
   flow through them, detail in `details`/`risks`, and `"detail": "../generated/<slug>.svg"`.
3. List the files the page summarizes in `"sources"` (with `"reviewed": ""`), add the skill to
   `explorer/system-map.explorer.json` with `"link": "<slug>.md"`, then run `npm run diagrams` and
   `npm run diagrams:ack -- <slug>`.
