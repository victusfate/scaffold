# TDD log: c4-structurizr

## Slice 1 — C4 model and Structurizr workspace
- Status: done
- Notes: identifiers are generated with a kind prefix; a double quote becomes a single quote because the DSL reference documents no escape.

## Slice 2 — C4 picture and native C4
- Status: done
- Notes: rendering both on the concierge diagrams showed native C4 unreadable (no automatic layout), so the picture is a flowchart in C4 notation and native C4 is folded under it. This revised the design's third output from a separate file to a folded block.

## Slice 3 — explorer spec to C4 model
- Status: done
- Notes: the workspace description is the system's description, not the page lede, which talks about the page.

## Slice 4 — render-c4 CLI; task queue page opts in
- Status: done
- Notes: editing `test:checks` in package.json tripped the atlas drift check on six pages that quote that line. Their anchors now match the start of the line; each explanation was re-read and acknowledged.

## Slice 5 — mind-meld c4
- Status: done
- Notes: no dynamic views, since the map records imports and not calls.

## Slice 6 — docs
- Status: done
- Notes: skills/diagram.md, skills/mind-meld.md, docs/diagrams/README.md.
