## Instructions

Generate or refine a [mermaid](https://mermaid.js.org) diagram, keeping the
`.mmd` text as the single source of truth. Edit the text and re-render — never
convert to a lossy shape format (excalidraw, draw.io, hand-tuned SVG).

**Canonical rule:** mermaid `.mmd` text is the source; the rendered image is a
derived artifact. All edits happen in text and re-render.

The render and URL logic lives in `scripts/mermaid-render.ts` — call it, do not
reimplement it.

### Step 1 — scope (one question, only if ambiguous)

If the diagram type or boundary is unclear, ask **one** question (what system,
what level of detail). Otherwise proceed.

### Step 2 — pick the diagram type

| Ask | Mermaid type |
|---|---|
| component / box-and-arrow architecture | `flowchart` |
| request/response, call ordering | `sequenceDiagram` |
| high-level system context & containers | `C4Context` / `C4Container` |
| data model / schema | `erDiagram` |
| lifecycle / state machine | `stateDiagram-v2` |
| type relationships | `classDiagram` |

### Step 3 — write the source

Write the mermaid source to `diagrams/<slug>.mmd` (kebab-case slug). State the
slug before writing so the user can correct it. This file is the diffable source
of truth — commit it.

### Step 4 — render and share

Run the helper. By default it renders the SVG locally **and** prints a
`mermaid.live` edit URL; let the user opt out of either.

```bash
node scripts/mermaid-render.ts diagrams/<slug>.mmd
```

- `--url-only` — print the live edit URL only, skip the local render (good for
  a quick share or when Chromium isn't available).
- `--out <file.svg>` — override the output path (default: `<slug>.svg`).

Notes:
- Local render shells out to `npx -y @mermaid-js/mermaid-cli` on demand (not
  vendored). The **first** run pulls a headless Chromium via puppeteer — heavy,
  one time. Mention this if it's the first render.
- In a sandboxed/CI env that needs `--no-sandbox`, render with a puppeteer
  config: `npx -y @mermaid-js/mermaid-cli -p puppeteer-config.json -i in.mmd -o out.svg`
  where `puppeteer-config.json` is `{"args":["--no-sandbox"]}`.
- The `mermaid.live` URL is the one optional remote touch and the user chooses
  to open it. Never auto-send a confidential diagram to a remote renderer
  (`mermaid.ink` etc.); persisted mode is local `mmdc` only.

### Step 5 — embed in docs (when asked)

To embed in a Markdown doc, prefer a fenced ` ```mermaid ` block (GitHub renders
it inline) or reference the rendered SVG: `![<title>](diagrams/<slug>.svg)`.

### Step 6 — iterate in text

The user critiques in words ("split the cache out", "the worker should call the
queue, not the DB"). Edit the `.mmd` text and re-render. Stay in text. Keep
turns tight.

## Output convention

```
diagrams/
  <slug>.mmd     # source of truth — commit this, it's diffable
  <slug>.svg     # rendered artifact — commit or gitignore per repo preference
```

## Guardrails

- No excalidraw, no draw.io, no lossy shape export as an edit target.
- Persisted mode renders locally only — client architecture stays on the machine.
- Single responsibility: generate + render + iterate mermaid. Nothing else.
- Idempotent: re-running on the same `.mmd` reproduces the same SVG.
