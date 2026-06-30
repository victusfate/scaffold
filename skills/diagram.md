## Instructions

Generate or refine a [mermaid](https://mermaid.js.org) diagram, keeping the
`.mmd` text as the single source of truth. Edit the text and re-render — never
convert to a lossy shape format (excalidraw, draw.io, hand-tuned SVG).

**Canonical rule:** mermaid `.mmd` text is the source; the rendered image is a
derived artifact. All edits happen in text and re-render.

**Local by default.** Render locally and view it; the diagram leaves the machine
only when the user asks to **publish** (the one explicit remote action). View
priority: (1) render + open in the system default viewer, (2) VS Code live
preview for side-by-side editing, (3) publish to mermaid.live.

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
slug before writing so the user can correct it. **Same slug → overwrite the same
file** (it is the source of truth, and git holds its history); pick a new slug
only for a genuinely different diagram. This file is diffable — commit it.

### Step 4 — choose how to view (default: render + open in system viewer)

Offer the three ways to view, **in this priority order**. Default to Mode A;
proceed with it unless the user prefers another.

- **(a) System default viewer** — *default*. Render the SVG and open it in the
  OS default app. Zero config, fast. (Mode A.)
- **(b) VS Code live preview** — side-by-side text + live-refresh + zoom, for
  iterative editing. (Mode B.)
- **(c) Publish to mermaid.live** — shareable URL; sends the diagram text
  remotely, so flag it for confidential diagrams. (Mode C.)

#### Mode A — render + open in the system default viewer (default)

```bash
node scripts/mermaid-render.ts diagrams/<slug>.mmd --open
```

- Renders `<slug>.svg`, then hands it to the OS opener (`open` / `xdg-open` /
  `start`). **Which app opens depends on the OS `.svg` file association** — for
  crisp vector zoom a browser is best; macOS Preview rasterizes SVG and is
  unreliable for dense diagrams.
- `--out <file.svg>` overrides the output path.
- First render pulls a headless Chromium via `npx mmdc` (heavy, one time);
  mention this. In a sandboxed/CI env needing `--no-sandbox`, pass
  `-p puppeteer-config.json` (`{"args":["--no-sandbox"]}`) to `mmdc`.
- Render without opening by dropping `--open`.

#### Mode B — VS Code live preview (iterative editing)

Side-by-side editing with live-refresh + zoom. Requires VS Code:

1. **Check VS Code:** `command -v code`. If missing, prompt the user to install
   it (macOS: `brew install --cask visual-studio-code`; else
   <https://code.visualstudio.com/download>; or run **Shell Command: Install
   'code' command in PATH**). Do not auto-install; if they decline, use Mode A.

   Note: `code` may resolve to a VS Code fork (Windsurf, Cursor). Confirm with
   `readlink -f "$(command -v code)"` if behavior looks off.

2. **Pick a preview style:**

   - **Markdown preview (recommended)** — needs `bierner.markdown-mermaid`
     (~5M installs, the common one). Check / install:

     ```bash
     code --list-extensions | grep -q bierner.markdown-mermaid \
       || code --install-extension bierner.markdown-mermaid   # confirm first
     node scripts/mermaid-render.ts diagrams/<slug>.mmd --wrap --no-render
     code diagrams/<slug>.md
     ```

     `--wrap` (re)writes `<slug>.md` (the `.mmd` inside a ` ```mermaid ` block).
     Open **Preview to the Side** (`Cmd+K V` / `Ctrl+K V`). On each edit, re-run
     `--wrap` and the open preview auto-refreshes. Fixed fit (no zoom).

   - **SVG image preview (zoomable)** — re-render the SVG and view it in VS
     Code's image preview, which zooms (`Cmd`+scroll) and auto-refreshes:

     ```bash
     node scripts/mermaid-render.ts diagrams/<slug>.mmd   # overwrites the .svg
     code diagrams/<slug>.svg                              # Reopen With → Image Preview
     ```

     To make `.svg` open as image preview automatically, set the workspace
     association `"workbench.editorAssociations": {"*.svg": "imagePreview.previewEditor"}`.

3. **Iterate:** the user describes a change, edit the `.mmd`, re-render (and
   `--wrap` for the markdown style). The open viewer refreshes in place.

#### Mode C — publish to mermaid.live (only when the user asks)

Emit a `mermaid.live` edit URL. This is the single remote action and it sends
the diagram text to mermaid.live — flag that before doing it for any
confidential diagram.

```bash
node scripts/mermaid-render.ts diagrams/<slug>.mmd --publish            # render + URL
node scripts/mermaid-render.ts diagrams/<slug>.mmd --publish --no-render # URL only
node scripts/mermaid-render.ts diagrams/<slug>.mmd --short --no-render   # shortened URL
```

- The URL opens the mermaid.live **editor** with the diagram pre-loaded and
  editable, but it is **stateless** — edits there do not sync back to the
  `.mmd`. Keep editing locally and re-publish.
- `--short` runs the (long, content-encoding) URL through is.gd, so the diagram
  reaches a **second** service. Opt-in; flag it for confidential diagrams.

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
  <slug>.md      # optional — Markdown wrapper for live VS Code preview / embedding
```

## Guardrails

- No excalidraw, no draw.io, no lossy shape export as an edit target.
- Local by default. The diagram leaves the machine only on an explicit
  `--publish`; never publish a confidential diagram without flagging it.
- Single responsibility: generate + render + iterate mermaid. Nothing else.
- Idempotent: re-running on the same `.mmd` reproduces the same SVG.
