# Plan: diagram-explorer-md

| # | Slice | Behaviors | Status |
|---|---|---|---|
| 1 | Markdown renderer | spec → page: title/lede, overview mermaid from the first flow (else lanes), one section per node with anchor, nested `more` detail, risks, deep tables, glossary, copyable ask block, label escaping | todo |
| 2 | Links + folded detail | node `link` and spec `detail` fields; validation; `<details>` with the generated image | todo |
| 3 | CLI + pipeline | `explorer-render --md`; `npm run diagrams` renders `docs/diagrams/explorer/*.explorer.json` → `docs/diagrams/pages/`; `--check-md` fails on stale pages or broken links, wired into `npm test` | todo |
| 4 | Content | system-map spec + 18 skill specs; README nav | todo |
