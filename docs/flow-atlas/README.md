# Scaffold Flow Atlas

[`index.html`](index.html) is one self-contained page covering every flow diagram in this repo: the 17 skill
and process diagrams in [`docs/diagrams`](../diagrams/README.md) and the
[agentic task queue architecture](../agentic-task-queue/design.md). Open it in a browser from a clone;
GitHub shows the HTML source, not the page.

For each flow it shows:

- the detailed diagram (the SVG already in the repo), with pan and zoom
- each stage: how it works, where it breaks, and its handoffs
- a code walkthrough: the lines that carry out each stage, an explanation, and the methods and helpers
  those lines call, each with a Copy button
- a claim-by-claim check of the diagram against the skill doc it summarizes, with the supporting quote and
  a link to the exact line

## What kind of evidence this is

The page is a snapshot of commit `3ff4a42` taken on 2026-11-24. It is not rebuilt by `npm run diagrams` and
no check keeps it current, so read it against that commit.

| Part | How it was produced |
|---|---|
| Verdicts, explanations, choice of code ranges | Written by Claude agents that read the docs and the code. They are judgments. |
| Quotes and their line numbers | Located in the cited file by script; all were found. |
| Code excerpts | Extracted from the repo by line range by script, which checked each range against a string the agent named. |
| Helper list under an excerpt | Found by script: names the excerpt uses that are defined in its file or a file it imports. |

Opened from a file, the page's question box copies the question with its context to paste into an agent
chat. Live answers work only when the page is published as a claude.ai Artifact.
