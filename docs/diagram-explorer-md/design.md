# Design: diagram-explorer-md

## Outcome
- Problem: the 18 skill diagrams in `docs/diagrams/` "are too down in the weeds for easily discussing"
  (owner, 2026-11-19). The owner wants visitors to "click through and get more context, possibly
  copy/pasting to their llms if they need more information (but leave that up to them)".
- Change: a system map in the README links to one page per skill. Each page starts high level and
  drills down. Everything is plain markdown on GitHub, with no hosting and no scripts.
- Evidence: unknown until a reader uses it. Check that every page renders on GitHub and that every link
  from the README resolves (link check in tests).
- Contribution mode: collaborative. Owner chose the structure and the navigation; the model owns the
  format.

## Decisions
### Markdown drill-down, not hosted explorer pages
**Decision:** README → `docs/diagrams/pages/<slug>.md`. Each page has an overview mermaid diagram (4–6
boxes), stage sections with links, the existing detailed diagram shown in full (owner: "auto show the detailed flows"), a glossary, and
an "Ask your LLM" code block.
**Rationale:** owner: "readme nav, you can click links that open up new md files". GitHub strips scripts
from READMEs and wikis, so interactive explorer pages would need Pages, and the owner chose not to host.
GitHub gives every code block a copy button, which covers handing context to an LLM.

### One spec, two renderers
**Decision:** each page is generated from a `.explorer.json` spec (the existing `ExplorerSpec`) by a
new `--md` mode of `scripts/explorer-render.ts`. `npm run diagrams` regenerates the pages, and a check
fails when a page is stale. New optional fields: node `link` (relative page path) and spec `detail`
(path to the `.mmd` to fold in).
**Rationale:** one source keeps pages from drifting. The same specs render interactive pages if Pages is
turned on later.
**Alternative:** hand-written markdown (19 files that drift from the diagrams).

### Structure
**Decision:** one system-map spec (each skill is a node linking to its page; cross-skill flows such as
"build a feature" and "drain the queue") plus one spec per existing diagram. Owner choice: "One map +
page per skill".

### LLM context is copy-only
**Decision:** each page ends with a fenced text block holding `ask.context`, the page summary, stage
roles and suggested questions. Nothing calls a model. Owner: "leave that up to them".

### SVG, not PNG
**Decision:** diagrams are generated only as SVG; the committed PNGs and the PNG step are removed.
**Rationale:** owner, after comparing them side by side: "I like that svg its superior, lets go with it". `--portable`
renders labels as plain SVG text, so GitHub displays them correctly, and they stay sharp at any zoom
for about the same size.

## Edge cases
- A node `link` to a missing page → the spec check fails.
- A spec with no flow → the overview is drawn from lanes in order.
- Mermaid labels are escaped (quotes, brackets) so GitHub renders them.
