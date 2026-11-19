# Skill and process diagrams

**Start here: [Scaffold at a glance](pages/system-map.md).** It maps every skill; click a skill link under the map for its own page,
which starts with a one-line overview and drills down: each stage, where it breaks, the full detailed
diagram, a glossary, and a block you can copy into your own LLM to ask follow-up questions.

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

`npm test` fails if a page is stale, a link goes nowhere, or a term is defined two ways.

## Adding a diagram

1. Write `src/<slug>.mmd` (copy an existing one). Keep stage-to-stage arrows between stage boxes so the
   image stays landscape, and define every acronym in its legend.
2. Write `explorer/<slug>.explorer.json` (copy `explorer/feature-chain.explorer.json`): 4–6 stages, one
   flow through them, detail in `details`/`risks`, and `"detail": "../generated/<slug>.svg"`.
3. Add the skill to `explorer/system-map.explorer.json` with `"link": "<slug>.md"`, then run `npm run diagrams`.
