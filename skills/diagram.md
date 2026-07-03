## Instructions

Generate or refine a [mermaid](https://mermaid.js.org) diagram, keeping the
`.mmd` text as the single source of truth. Edit the text and re-render — never
convert to a lossy shape format (excalidraw, draw.io, hand-tuned SVG).

**Canonical rule:** mermaid `.mmd` text is the source; the rendered image is a
derived artifact. All edits happen in text and re-render.

**Local by default.** Render and view locally; the diagram leaves the machine
only when the user asks to **publish** (the one explicit remote action). View
priority: (1) lightweight Node live-preview server that watches the `.mmd`,
(2) self-hosted mermaid.live editor via Docker (fully offline), (3) render +
open in the system default viewer, (4) VS Code live preview, (5) publish to the
public mermaid.live.

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

### Step 4 — choose how to view (default: lightweight live preview)

Offer the ways to view, **in this priority order**. Default to Mode A; proceed
with it unless the user prefers another.

- **(a) Lightweight live preview (Node)** — *default*. A zero-dependency local
  server regenerates the **self-contained** static viewer (inline SVG + pan/zoom,
  no CDN) on each `.mmd` save and hot-reloads the browser tab. Edit the text in
  any editor; the picture follows. (Mode A.)
- **(b) Local mermaid.live editor (Docker)** — the full split-pane editor,
  fully offline (edit in the browser). Heavier (needs Docker). (Mode B.)
- **(c) System default viewer** — render the SVG and open it in the OS default
  app. One-shot, no server. (Mode C.)
- **(d) VS Code live preview** — side-by-side inside the editor. (Mode D.)
- **(e) Publish to mermaid.live** — shareable URL; sends the diagram text
  remotely, so flag it for confidential diagrams. (Mode E.)
- **(f) Mobile viewing (PNG + interactive HTML)** — a high-res PNG for the
  phone photo viewer's native pinch-zoom, and/or a self-contained interactive
  HTML viewer (inline SVG + touch pan/zoom, no server, no CDN). Best when the
  reader is on a phone. (Mode F.)

#### Mode A — lightweight live preview via the Node watcher (default)

Keeps the `.mmd` the source of truth: edit it in any editor and a browser tab
reloads on save. On each change the watcher regenerates the **same
self-contained artifact `--html` produces** (inline SVG + dependency-free touch
pan/zoom, no CDN) and pushes an SSE reload. Built-ins only (`http` +
`fs.watchFile` + SSE).

```bash
node scripts/mermaid-watch.ts diagrams/<slug>.mmd [--port 8080] [--portable]
```

Then open the printed `http://localhost:<port>`. Run it in the background and
keep editing the `.mmd` — the tab follows each change. `--portable` renders
SVG-text labels (see below) so nothing clips.

- Each save re-renders via `mmdc` (a couple seconds) — the cost of producing the
  real offline artifact rather than a CDN client render. Fully self-contained: no
  network after the one-time `mmdc` Chromium fetch.
- Stop it with Ctrl-C (or kill the backgrounded process).

#### Mode B — local mermaid.live editor via Docker (fully offline)

The same mermaid.live editor, self-hosted offline. The `#pako:` encoding is
identical, so the diagram opens pre-loaded with full live edit + pan + zoom.

1. **Check Docker:** `docker info >/dev/null 2>&1`. If it fails (Docker absent
   or daemon stopped), say so and fall back to Mode A or C (no install pushed).

2. **Ensure the container (idempotent):**

   ```bash
   docker ps --filter "name=mermaid-live" --format '{{.Names}}' | grep -q mermaid-live \
     || docker run -d --name mermaid-live -p 8080:8080 ghcr.io/mermaid-js/mermaid-live-editor
   ```

   First run pulls the image (~27 MB compressed, one time; nginx + static SPA).
   It persists across runs; stop with `docker stop mermaid-live`.

3. **Open the diagram in the local editor:**

   ```bash
   node scripts/mermaid-render.ts diagrams/<slug>.mmd --local --no-render
   ```

   Open the printed `http://localhost:8080/edit#pako:…` URL. Use `--port <n>` if
   8080 is taken (match the `docker run -p`).

4. **Iterate:** the editor is stateless (edits there do not sync back to the
   `.mmd`). Keep the `.mmd` as source — on each change, edit it and re-run
   `--local` for a fresh pre-loaded URL.

#### Mode C — render + open in the system default viewer

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

#### Mode D — VS Code live preview (iterative editing)

Side-by-side editing with live-refresh + zoom. Requires VS Code:

1. **Check VS Code:** `command -v code`. If missing, prompt the user to install
   it (macOS: `brew install --cask visual-studio-code`; else
   <https://code.visualstudio.com/download>; or run **Shell Command: Install
   'code' command in PATH**). Do not auto-install; if they decline, use Mode A
   or C.

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

#### Mode E — publish to mermaid.live (only when the user asks)

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

#### Mode F — mobile viewing (PNG + interactive HTML)

For a reader on a phone, two portable artifacts beat a live server (localhost is
awkward to reach from a phone, and a code-editor SVG preview clips and cannot
pan/zoom well):

```bash
# high-res opaque PNG — opens in the photo viewer with native pinch-zoom/pan
node scripts/mermaid-render.ts diagrams/<slug>.mmd --png [--scale <n>]

# self-contained interactive viewer — inline SVG + dependency-free touch
# pan/zoom, opens in any mobile browser; no server, no CDN, no external fetch
node scripts/mermaid-render.ts diagrams/<slug>.mmd --html

# both at once, alongside the SVG
node scripts/mermaid-render.ts diagrams/<slug>.mmd --png --html
```

- `--png` renders `<slug>.png` at `--scale 3` by default (crisp when zoomed).
- `--html` writes `<slug>.html` with the SVG inlined and a few lines of pointer/
  wheel/pinch handling — deliver it, open it in a browser, pinch to zoom.
- **`--portable`** renders labels as SVG `<text>` instead of HTML labels, so text
  does not clip in non-browser / mobile SVG viewers (mermaid's default HTML
  labels reflow to the viewer's fonts and overflow their boxes). Add it whenever
  the artifact will be viewed outside a browser. Authors can still opt back into
  HTML labels via the `.mmd` init block when a node needs rich HTML.

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
  <slug>.png     # optional — high-res raster for phone photo-viewer pinch-zoom
  <slug>.html    # optional — self-contained interactive pan/zoom viewer
  <slug>.md      # optional — Markdown wrapper for live VS Code preview / embedding
```

## Guardrails

- No excalidraw, no draw.io, no lossy shape export as an edit target.
- Local by default. The diagram leaves the machine only on an explicit
  `--publish`; never publish a confidential diagram without flagging it.
- Single responsibility: generate + render + iterate mermaid. Nothing else.
- Idempotent: re-running on the same `.mmd` reproduces the same SVG.
