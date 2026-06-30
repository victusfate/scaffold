#!/usr/bin/env node
// mermaid-watch — zero-dependency live preview for a mermaid `.mmd` file.
// Why: keep the `.mmd` the single source of truth and edit it in any editor;
// the browser tab hot-reloads on save. Lighter than Docker (no daemon, no
// image) and it watches the actual file, so edits flow from text to picture.
// Built-ins only: http + fs.watchFile + Server-Sent Events (no chokidar/ws).
// The mermaid runtime loads from the jsdelivr CDN (needs net once, then the
// browser caches it) — for a fully-offline editor use the Docker option.
// Usage:
//   node scripts/mermaid-watch.mjs <file.mmd> [--port 8080] [--theme default]
// Then open http://localhost:<port> and edit the file; the tab re-renders.

import http from 'node:http';
import { readFileSync, existsSync, watchFile } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
const PANZOOM_CDN = 'https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js';

function die(msg) {
  process.stderr.write(`mermaid-watch: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { file: undefined, port: 8080, theme: 'default' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') opts.port = Number(argv[++i]);
    else if (argv[i] === '--theme') opts.theme = argv[++i];
    else if (argv[i].startsWith('--')) die(`unknown option: ${argv[i]}`);
    else opts.file = argv[i];
  }
  return opts;
}

// The preview page: fetches /raw and renders it client-side, re-rendering on
// each Server-Sent "reload" event. svg-pan-zoom adds wheel-zoom + drag-pan.
// Pure (no I/O) so it is unit-testable.
export function pageHtml(file, theme) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>mermaid-watch: ${file}</title>
  <style>
    html,body { margin:0; height:100%; background:#1e1e1e; color:#ddd; font:14px system-ui; }
    #wrap { position:fixed; inset:0; }
    #diagram { width:100%; height:100%; }
    #diagram svg { max-width:none !important; width:100%; height:100%; }
    #bar { position:fixed; top:8px; left:10px; opacity:.7; }
    #err { position:fixed; bottom:8px; left:10px; right:10px; color:#f88; white-space:pre-wrap; font-family:monospace; }
  </style>
  <script src="${PANZOOM_CDN}"></script>
  <script type="module">
    import mermaid from '${MERMAID_CDN}';
    mermaid.initialize({ startOnLoad:false, theme:${JSON.stringify(theme)} });
    const host = document.getElementById('diagram');
    const err = document.getElementById('err');
    let n = 0;
    async function render() {
      try {
        const text = await (await fetch('/raw', { cache:'no-store' })).text();
        const { svg } = await mermaid.render('g' + (++n), text);
        host.innerHTML = svg;
        const el = host.querySelector('svg');
        if (el && window.svgPanZoom) window.svgPanZoom(el, { controlIconsEnabled:true, fit:true, center:true });
        err.textContent = '';
      } catch (e) { err.textContent = String(e && e.message || e); }
    }
    render();
    new EventSource('/events').onmessage = render;
  </script>
</head>
<body>
  <div id="wrap"><div id="diagram"></div></div>
  <div id="bar">watching ${file} — edit & save to refresh</div>
  <div id="err"></div>
</body>
</html>`;
}

function main(argv) {
  const { file, port, theme } = parseArgs(argv);
  if (!file) die('usage: node scripts/mermaid-watch.mjs <file.mmd> [--port 8080] [--theme default]');
  if (!existsSync(file)) die(`file not found: ${file}`);

  const clients = new Set();
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHtml(file, theme));
    } else if (req.url === '/raw') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(readFileSync(file, 'utf8'));
    } else if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(404); res.end();
    }
  });

  // watchFile polls, so it survives editors that replace the file on save.
  watchFile(file, { interval: 200 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) for (const res of clients) res.write('data: reload\n\n');
  });

  server.listen(port, () => {
    process.stdout.write(`mermaid-watch: http://localhost:${port}  (watching ${resolve(file)})\n`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
