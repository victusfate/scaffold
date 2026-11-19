# PRD: diagram-explorer-md

Decisions: [design.md](design.md).

## Problem
The skill diagrams are too detailed to discuss, and a visitor can't drill from "what is this?" to "how
does it work?" or hand the context to their own LLM.

## Solution
The README shows a system map of all skills, linked to one markdown page per skill. Each page goes from
an overview to stage detail to the full diagram (folded), and ends with a copyable "Ask your LLM" block.
Pages are generated from `.explorer.json` specs by `explorer-render.ts --md`, and kept current by
`npm run diagrams` plus a stale check in `npm test`.

## User stories
1. A visitor sees every skill and how they connect on one map in the README, and clicks into any skill.
2. On a skill page they get the gist from a 4–6 box overview, then open any stage for detail.
3. The original detailed diagram is one click away (folded).
4. They can copy a block with the page's context and questions into their own LLM.
5. A maintainer edits one spec; the page regenerates; a stale or broken page fails `npm test`.

## Testing
`explorer-markdown.test.ts`: rendering from a fixture spec (overview, anchors, nested detail, tables,
folded detail, glossary, ask block, mermaid label escaping). The check mode fails on stale pages and on
links to missing pages. Real pages are checked by rendering all specs in `npm test`.

## Out of scope
GitHub Pages and the interactive HTML pages (the specs support them later); changing the detailed
`.mmd` diagrams.
