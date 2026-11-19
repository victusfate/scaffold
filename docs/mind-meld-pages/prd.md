# PRD: mind-meld-pages

Design: [design.md](design.md).

## User stories
1. A repo owner turns a recorded mind-meld bundle into one markdown page they can commit and link.
2. A reader sees the observed call path as a diagram, then each function's source, its static calls and
   what each recorded run passed in and got back.
3. A reader copies a short block (context and page URL) into their own LLM.
4. Nothing on the page is invented: every value comes from the bundle.

## Testing
`scripts/mind-meld-pages.test.ts` uses the reference `index()` with a synthetic run (no Docker): lanes,
stages, flow from parent links, recorded values in code spans, single-call runs under their node,
invalid bundles rejected, and the CLI writes markdown.

## Out of scope
Model narration, multi-page tours, and hosting.
