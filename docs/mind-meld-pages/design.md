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

## Static-first (task-014, absorbs task-013)
Owner: "the default mind meld runs diagram across a repo … and the interactive running/inspection/
profiling/debugging is if you want to dive deeper", "a repo can be any languages", and "make it clear how
to extend mind meld to support any languages … without bloating scaffold".

- **Default view:** `mind-meld.ts map <repo> <out>` writes a repo map (areas = top-level folders) and one
  page per area (files, definitions with line links, imports). No execution, no Docker.
- **Arrows are declared imports, never inferred calls.** Each file states how its facts were found.
- **Languages are adapters.** One contract (`LanguageAdapter` in `scripts/mind-meld-langs.ts`). Scaffold
  ships TypeScript (compiler), Python (stdlib ast), Rust and Ruby (line patterns plus module rules). A repo
  adds any other language in its own `.mind-meld/languages/<name>.ts`, so scaffold does not grow.
- **A missing tool is stated, not guessed:** the file stays on the map with the reason.
- **Recorded runs stay the opt-in dive** (`flow`, `piece`, `pages`), for flows where behavior matters.
- **Automatic clusters:** an area over 12 files becomes a page of groups (subfolders, plus files sharing a
  first name segment, labelled by their longest shared prefix such as `queue-*`), each with its own page.
  Owner: "make sure to identify and create prefix clusters automatically".
- **Scaffold doesn't commit its own map** (owner choice: line-number links would change on almost every
  code edit). The README says how to generate one.
