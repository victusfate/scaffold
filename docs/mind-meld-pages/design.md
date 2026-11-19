# Design: mind-meld-pages

## Outcome
- Owner request (task-013): "enhance mind meld with what we've done here", meaning the drill-down markdown
  pages with LLM copy blocks built in diagram-explorer-md.
- Change: `node scripts/mind-meld.ts pages <bundle.json>` prints a GitHub markdown page for a validated
  bundle. Anyone can read a repo's recorded walkthrough on GitHub; the offline viewer stays for deep
  exploration.
- Evidence: unknown until a child repo publishes one. Check: the reference bundle renders a page whose
  every claim traces to an indexed span or a recorded event.

## Decisions
### Facts only, no narration
The page holds only indexed and recorded facts: source spans with excerpts, static calls (labelled
static), and recorded calls with inputs, outputs and state changes. Mind-meld's rule: never synthesize a
missing edge, value or run.

### Mapping
| Bundle | Page |
|---|---|
| node layers | lanes (first-seen order) |
| node | stage: `file:line–end` role, source link, excerpt, static calls, recorded calls |
| run with nested calls | flow: parent call → child call, with input and output |
| run with one call (a piece) | recorded under its node only (a flow needs a hop) |
| snapshot hash | stated in the lede, with freshness unknown until `verify` passes |

Recorded values go in code spans, so payload text can't render as markdown or hidden HTML.

### Reuse
`scripts/explorer-markdown.ts` renders the page; the bundle is validated with `validateBundle` first.
`--source-prefix` sets how page links reach source files (default `../` for a page one level down).
