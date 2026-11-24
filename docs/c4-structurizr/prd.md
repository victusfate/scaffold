# PRD: C4 and Structurizr output

## Problem Statement
Enterprise architects ask for C4 diagrams and a Structurizr workspace. Scaffold produces mermaid flowcharts,
explorer pages and a mind-meld repo map, none of which they can load into their tooling.

## Solution
Two commands. `render-c4` turns an explorer spec that opts in into a Structurizr workspace, a C4 picture
that renders on GitHub, and mermaid's native C4 syntax. `mind-meld c4` does the same for a whole repo from
its static map. Both are plain text generation: no model, no Java, no Docker.

## Outcome and Evidence
- Desired improvement: a client can open a generated `.dsl` in Structurizr and see context, container,
  component and dynamic views without editing it.
- Assumptions and probes: see `design.md` (Assumptions). The DSL has not been parsed by Structurizr on the
  build host; that evidence is unknown until someone loads a file.
- Evidence that would force a revision: a Structurizr parse error on a generated file; an owner judgment that
  the generated views say something the source does not.
- Product evidence, separate from passing tests: the owner's visual comparison of generated output against a
  hand conversion of the two concierge diagrams and the task queue design.
- Preservation: specs without `c4` are untouched (`scripts/explorer-spec.ts`, existing page tests);
  `mind-meld map` output is unchanged (`scripts/mind-meld-map.test.ts`).

## User Stories
1. As an architect, I want a Structurizr workspace of a system, so that I can load it into our tooling.
2. As a reader on GitHub, I want a C4 picture that renders without tools, so that I can read it in the repo.
3. As a spec author, I want to mark a node as a person, an external system, a database or a queue, so that
   the views use the right C4 element.
4. As a spec author, I want pages that are not about running software left alone, so that no meaningless C4
   appears.
5. As a maintainer, I want `npm test` to fail when a generated file is stale, so that C4 never drifts from
   its spec.
6. As a client engineer, I want a C4 model of my repo from its code, so that I start from facts.
7. As an architect, I want every component to name its source file, so that I can trace it.
8. As a spec author, I want one line per problem when my spec cannot be converted, so that I can fix it.

## Implementation Decisions
- A neutral `C4Model` with a validator; converters from an explorer spec and from mind-meld facts; emitters
  for Structurizr DSL, the C4 picture and native C4.
- `ExplorerSpec` gains `c4`; `ExplorerNode` gains `c4`. The spec validator rejects an unknown `c4.as`.
- Identifiers are generated, prefixed by kind, and unique. Quotes and line breaks in text are normalized.
- Generated files live in `docs/diagrams/c4/`; `--check` joins `npm run test:checks`.
- The task queue design page opts in, with the owner, GitHub and the target repo added as nodes.

## Testing Decisions
- Good tests assert the emitted text for a small model and the model for a small spec, through the exported
  functions and the CLI, on a temp directory.
- Tested: model validation, each emitter, both converters, the CLI (write, `--check`, bad spec), the
  mind-meld command.
- Prior art: `scripts/explorer-render.test.ts`, `scripts/mind-meld-map.test.ts`.
- Diagnosis: `node scripts/render-c4.ts <spec> --out <dir>` reproduces any output from its spec.

## Out of Scope
- Rendering Structurizr diagrams, calling `structurizr-cli`, deployment views, styles beyond a default set.
- Converting mermaid flowcharts or images. Calls observed at run time (mind-meld recordings).

## Further Notes
- Open: confirm a generated workspace in Structurizr Lite once Java or Docker is available.
