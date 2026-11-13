## Instructions

Generate or refine a [mermaid](https://mermaid.js.org) diagram.

Two outputs, both text-sourced: a **mermaid diagram** (Steps 1–6) or a
standalone **interactive explorer page** (Mode G) when the reader needs to
trace flows, drill into components, look up terms and ask questions.

**Canonical rule:** mermaid `.mmd` text (or, for Mode G, the `.explorer.json`
spec) is the single source of truth; the rendered image or page is a derived
artifact. All edits happen in text and re-render.
Never convert to a lossy shape format (excalidraw, draw.io, hand-tuned SVG).

**Local by default.** Render and view locally; the diagram leaves the machine
only when the user asks to **publish** (the one explicit remote action). View
priority is the Step 4 order.

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
file** (git holds its history); pick a new slug only for a different diagram.
Commit it (it is diffable).

### Step 4 — choose how to view (default: lightweight live preview)

Offer the ways to view, **in this priority order**. Proceed with Mode A unless
the user prefers another.

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
- **(g) Interactive explorer page** — not a view of one `.mmd` but its own
  output: a standalone HTML page (lanes, traced flows, drill-down, glossary,
  timeline, topics, Q&A) rendered from a `.explorer.json` spec. Use it when the
  reader will explore rather than glance. (Mode G.)

#### Mode A — lightweight live preview via the Node watcher (default)

Edit the `.mmd` in any editor; a browser tab reloads on save. On each change
the watcher regenerates the **same self-contained artifact `--html` produces**
(inline SVG + dependency-free touch pan/zoom, no CDN) and pushes an SSE reload.
Built-ins only (`http` + `fs.watchFile` + SSE).

```bash
node scripts/mermaid-watch.ts diagrams/<slug>.mmd [--port 8080] [--portable]
```

Run it in the background, open the printed `http://localhost:<port>`, and keep
editing the `.mmd`. `--portable` renders SVG-text labels (see Mode F) so nothing
clips.

- Each save re-renders via `mmdc` (a couple seconds), the cost of producing the
  real offline artifact rather than a CDN client render. No network after the
  one-time `mmdc` Chromium fetch.
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
   `.mmd`). On each change, edit the `.mmd` and re-run `--local` for a fresh
   pre-loaded URL.

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

Emit a `mermaid.live` edit URL. This sends the diagram text to mermaid.live;
flag that before doing it for any confidential diagram.

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

#### Mode G — interactive explorer page (flows + drill-down + Q&A)

Pick this over a plain diagram when the reader will **explore** a system rather
than glance at it: interview prep, onboarding, architecture reviews,
incident write-ups. One page holds:

- **Map:** components grouped in lanes (layers or tiers). Selecting one opens an
  inspector: role, "how it works" bullets (each can expand to more detail and a
  code sample), "where it breaks", and deep sections (comparison tables or lists).
- **Flows:** named traces of `[from, to, what, payload]` steps. A flow dims
  uninvolved components, numbers the hops, steps through them, and draws a
  clickable sequence strip.
- **Inline glossary:** any glossary alias in the text becomes a dotted term
  that opens its definition in place (definitions can link to other terms).
- **Timeline:** events in tracks on any scale (years, quarters, sprints,
  `T+5m`), linking to topics and components.
- **Topics:** longer pages, optionally grouped, with labelled notes and links
  back to the map.
- **Q&A:** suggested questions for each component and a free-text box. The
  question goes out with the selected component, the current flow step and
  `ask.context`.

**1. Write the spec** to `diagrams/<slug>.explorer.json`. Copy the shape of
[`skills/diagram/explorer-example.explorer.json`](diagram/explorer-example.explorer.json);
the typed schema is `ExplorerSpec` in `scripts/explorer-spec.ts`. Only
`title`, `lanes` and `nodes` are required; leave out a section and its tab
disappears. Content rules:
- Facts go in the spec, never in the template. Write `role` as one sentence,
  and make `risks` concrete failure modes.
- Every step names real node ids. Put the payload (the data carried) in the
  fourth field.
- Give each important term a glossary entry. List each spelling the text uses
  in `a`, and give each alias to only one term.
- Set `ask.context` to who the reader is and why they are reading. Set
  `ask.style` for answer depth and length.

**2. Validate, render, iterate:**

```bash
node scripts/explorer-render.ts diagrams/<slug>.explorer.json --check   # list problems, exit 1
node scripts/explorer-render.ts diagrams/<slug>.explorer.json           # -> <slug>.explorer.html
node scripts/explorer-render.ts diagrams/<slug>.explorer.json --mmd     # + <slug>.<flowId>.mmd per flow
```

The validator rejects dangling references (a step to a missing node, a node in
a missing lane, a timeline event in a missing track or topic, an alias claimed
by two terms). `--mmd` exports each flow as a mermaid `sequenceDiagram`, so
Modes A–F can render it too. Open the HTML in a browser and check it with
`/qa` (select a node, trace a flow, open a term, check phone width) before
calling it done.

**3. Deliver — local by default.** The page is one self-contained HTML file
(no server, no CDN script), so it works from any harness. Q&A works per host:

| Where the page runs | Q&A behaviour | How to deliver |
|---|---|---|
| Local file, any harness (Claude Code, Codex, agy, pi, Cursor) | **Copy question** puts the question and its context on the clipboard, to paste into the agent chat | Send the `.explorer.html` file (or open it locally) |
| Published claude.ai Artifact (only on request) | **Ask Claude** answers in the page, streaming, through `window.claude.use('sample')` | Claude Code: publish with the Artifact tool, declaring the `sample` capability (load the `artifact-capabilities` skill first) |

Publishing is the one remote action and only happens when the user asks. Never
claim live Q&A in a harness that cannot publish an Artifact; there the copy
fallback is the feature. To change a page, edit the JSON, re-render, and
republish to the same URL.

### Step 5 — embed in docs (when asked)

To embed in a Markdown doc, prefer a fenced ` ```mermaid ` block (GitHub renders
it inline) or reference the rendered SVG: `![<title>](diagrams/<slug>.svg)`.

### Step 6 — iterate in text

The user critiques in words ("split the cache out", "the worker should call the
queue, not the DB"). Edit the `.mmd` text and re-render.

## Output convention

```
diagrams/
  <slug>.mmd     # source of truth — commit this, it's diffable
  <slug>.svg     # rendered artifact — commit or gitignore per repo preference
  <slug>.png     # optional — high-res raster for phone photo-viewer pinch-zoom
  <slug>.html    # optional — self-contained interactive pan/zoom viewer
  <slug>.md      # optional — Markdown wrapper for live VS Code preview / embedding
  <slug>.explorer.json  # Mode G source of truth — commit this
  <slug>.explorer.html  # Mode G rendered page — derived, self-contained
  <slug>.<flow>.mmd     # optional — per-flow sequenceDiagram from --mmd
```

## Guardrails

- No excalidraw, no draw.io, no lossy shape export as an edit target.
- Local by default. The diagram leaves the machine only on an explicit
  `--publish`; never publish a confidential diagram without flagging it.
- Single responsibility: generate + render + iterate text-sourced diagrams
  (mermaid, and explorer pages via the shared renderer). Never hand-write the
  explorer page's HTML; change the spec or the template.
- Idempotent: re-running on the same `.mmd` reproduces the same SVG; the same
  `.explorer.json` reproduces the same page.
