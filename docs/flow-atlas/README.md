# Scaffold Flow Atlas

One page per flow diagram in this repo: the 17 skill and process diagrams in [`docs/diagrams`](../diagrams/README.md) and the
[agentic task queue architecture](../agentic-task-queue/design.md). Each page shows the diagram, every stage, the code that carries the
stage out with an explanation of each excerpt and the helpers it calls, and a claim-by-claim check against the skill doc the diagram summarizes.

| Flow | Confirmed | Partly | Not found | Contradicted | In the source, not shown | Code excerpts |
|---|---:|---:|---:|---:|---:|---:|
| **Run the work** | | | | | | |
| [Orchestration](orchestration.md) | 29 | 7 | 0 | 0 | 10 | 12 |
| [Queue task lifecycle](queue-lifecycle.md) | 29 | 6 | 0 | 0 | 10 | 14 |
| [One loop tick](loop-tick.md) | 30 | 5 | 0 | 0 | 6 | 14 |
| [Session continuity](session-continuity.md) | 30 | 3 | 0 | 0 | 8 | 9 |
| **Build** | | | | | | |
| [Feature chain](feature-chain.md) | 30 | 6 | 0 | 0 | 8 | 12 |
| [TDD](tdd.md) | 37 | 6 | 0 | 0 | 4 | 11 |
| [PR workflow](pr-workflow.md) | 29 | 5 | 0 | 0 | 11 | 13 |
| **Quality** | | | | | | |
| [Review gates](review-gates.md) | 33 | 3 | 0 | 0 | 5 | 12 |
| [QA](qa.md) | 34 | 3 | 0 | 0 | 8 | 6 |
| [Investigate](investigate.md) | 31 | 1 | 0 | 0 | 7 | 6 |
| [Prune](prune.md) | 26 | 0 | 0 | 0 | 4 | 11 |
| [Add linter](add-linter.md) | 28 | 3 | 0 | 0 | 8 | 13 |
| **Share and improve** | | | | | | |
| [Scaffold sync](scaffold-sync.md) | 30 | 6 | 0 | 0 | 8 | 14 |
| [Skillify](skillify.md) | 30 | 4 | 0 | 0 | 4 | 14 |
| [Retro](retro.md) | 35 | 1 | 0 | 0 | 9 | 1 |
| **Specialist tools** | | | | | | |
| [Council](council.md) | 43 | 1 | 0 | 0 | 4 | 6 |
| [Mind meld](mind-meld.md) | 46 | 1 | 1 | 0 | 8 | 14 |
| **Design docs** | | | | | | |
| [Agentic task queue](agentic-task-queue.md) | 23 | 1 | 1 | 0 | 9 | 14 |
| **All flows** | 573 | 62 | 2 | 0 | 131 | 196 |

15 of the confirmed or partly confirmed claims hold only in a file their diagram does not list as a source, so the repo's drift check does not watch them. They are marked "outside tracked sources".

## How the flows connect

- **Build a feature**: Queue → Orchestration → Feature chain → PR workflow → Scaffold sync. Task picked up. Feature started on the working branch. Reviewed and tested. Merged; consumer repos pull it.
- **Keep quality up**: TDD → Review gates → QA. Slices green. Fixes applied and re-verified.
- **Learn from a session**: Retro → Skillify → Scaffold sync. A repeatable workflow found. Skill PR to scaffold, merged by owner.

## What kind of evidence this is

These pages are a snapshot of commit `3ff4a42` taken on 2026-11-24. They are not rebuilt by `npm run diagrams` and no check keeps them
current, so read them against that commit; every source link is pinned to it.

| Part | How it was produced |
|---|---|
| Verdicts, explanations, choice of code ranges | Written by AI agents that read the docs and the code. They are judgments. |
| Quotes and their line numbers | Located in the cited file by script; all were found. |
| Code excerpts | Extracted from the repo by line range by script, which checked each range against a string the agent named. |
| Helper list under an excerpt | Found by script: names the excerpt uses that are defined in its file or a file it imports. |
| Helper explanations | Written by agents that read each definition. |

A stage marked "No code here" is carried out by the agent from the skill text alone.
