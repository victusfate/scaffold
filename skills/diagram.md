## Instructions

Generate or refine a [mermaid](https://mermaid.js.org) diagram, keeping the
`.mmd` text as the single source of truth. Edit the text and re-render — never
convert to a lossy shape format (excalidraw, draw.io, hand-tuned SVG).

**Canonical rule:** mermaid `.mmd` text is the source; the rendered image is a
derived artifact. All edits happen in text and re-render.

**Local by default.** Render locally and keep the diagram on the machine.
Never send it to a remote renderer unless the user asks to **publish** — that is
the one explicit remote action.

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

### Step 4 — render locally (default)

Render the SVG locally. Nothing leaves the machine.

```bash
node scripts/mermaid-render.ts diagrams/<slug>.mmd
```

- `--out <file.svg>` — override the output path (default: `<slug>.svg`).
- Shells out to `npx -y @mermaid-js/mermaid-cli` on demand (not vendored). The
  **first** run pulls a headless Chromium via puppeteer — heavy, one time.
  Mention this if it's the first render.
- In a sandboxed/CI env that needs `--no-sandbox`, render with a puppeteer
  config: `npx -y @mermaid-js/mermaid-cli -p puppeteer-config.json -i in.mmd -o out.svg`
  where `puppeteer-config.json` is `{"args":["--no-sandbox"]}`.

### Step 5 — live preview in VS Code (for iterative editing)

For the side-by-side experience (edit the text, watch the diagram update), use
VS Code's built-in Markdown preview. Fully local — nothing is published.

1. **Check VS Code is installed:**

   ```bash
   command -v code
   ```

   If `code` is **not** found, prompt the user to install VS Code before
   continuing the preview path:
   - macOS: `brew install --cask visual-studio-code`
   - else: download from <https://code.visualstudio.com/download>
   - already installed but `code` missing: in VS Code run **Shell Command:
     Install 'code' command in PATH** from the Command Palette.

   Do not auto-install. Ask first, then fall back to Step 4 (local SVG) if they
   decline.

2. **Check the mermaid plugin, offer to install it:**

   ```bash
   code --list-extensions | grep -q bierner.markdown-mermaid
   ```

   If absent, offer to install (this is the one user-facing install — confirm
   first):

   ```bash
   code --install-extension bierner.markdown-mermaid
   ```

   `bierner.markdown-mermaid` renders mermaid live inside VS Code's built-in
   Markdown preview. For previewing a raw `.mmd` instead of a Markdown doc, the
   `.mmd`-native alternative is `vstirbu.vscode-mermaid-preview` — offer it if
   the user prefers to edit the `.mmd` directly.

3. **Open the diagram and the preview side by side.** The built-in preview
   renders Markdown, so embed the diagram in a Markdown doc (this doubles as the
   embed-in-docs deliverable):

   ```bash
   code diagrams/<slug>.md
   ```

   Then **Open Preview to the Side** (`Cmd+K V` on macOS / `Ctrl+K V`
   elsewhere). Editing the ` ```mermaid ` block updates the preview live. Keep
   `diagrams/<slug>.mmd` as the committed source and re-render its SVG from
   Step 4 when done.

### Step 6 — publish (only when the user asks)

Only when the user asks to **publish / share**, emit a `mermaid.live` edit URL.
This is the single remote action and it sends the diagram text to mermaid.live —
flag that before doing it for any confidential diagram.

```bash
node scripts/mermaid-render.ts diagrams/<slug>.mmd --publish            # render + URL
node scripts/mermaid-render.ts diagrams/<slug>.mmd --publish --no-render # URL only
```

### Step 7 — embed in docs (when asked)

To embed in a Markdown doc, prefer a fenced ` ```mermaid ` block (GitHub renders
it inline) or reference the rendered SVG: `![<title>](diagrams/<slug>.svg)`.

### Step 8 — iterate in text

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
