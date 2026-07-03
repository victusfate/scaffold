#!/usr/bin/env node
// mermaid-watch — live preview that regenerates the *static, self-contained*
// interactive HTML on every `.mmd` save and hot-reloads the browser tab.
// Why: keep the `.mmd` the single source of truth, edit it in any editor, and
// see the update. Unlike a CDN client-renderer, it serves exactly the portable
// artifact `mermaid-render --html` produces (inline SVG + pan/zoom, no network),
// so what you watch is what you'd open offline. TypeScript, like the rest of the
// tooling; built-ins only (http + fs.watchFile + Server-Sent Events).
// Usage:
//   node scripts/mermaid-watch.ts <file.mmd> [--port 8080] [--portable]
// Then open http://localhost:<port> and edit the file; the tab re-renders.

import http from 'node:http';
import { readFileSync, existsSync, watchFile } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 8080;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const POLL_INTERVAL_MS = 200; // watchFile poll — survives editors that replace the file on save

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER = join(HERE, 'mermaid-render.ts');

interface WatchOpts { file?: string; port: number; portable: boolean }

function die(msg: string): never {
  process.stderr.write(`mermaid-watch: ${msg}\n`);
  process.exit(1);
}

export function parseArgs(argv: string[]): WatchOpts {
  const opts: WatchOpts = { port: DEFAULT_PORT, portable: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') opts.port = Number(argv[++i]);
    else if (argv[i] === '--portable') opts.portable = true;
    else if (argv[i].startsWith('--')) die(`unknown option: ${argv[i]}`);
    else opts.file = argv[i];
  }
  return opts;
}

// Inject a tiny SSE client that reloads the tab on a "reload" event. Kept out of
// the static template so the saved `--html` artifact stays free of live-reload
// wiring — only the watch server adds it. Pure, so it is unit-testable.
export function injectReload(html: string): string {
  const snippet = '<script>new EventSource("/events").onmessage=function(){location.reload()}</script>';
  return html.includes('</body>') ? html.replace('</body>', snippet + '</body>') : html + snippet;
}

// Regenerate the static interactive HTML via mermaid-render, then return it with
// the live-reload snippet injected. Delegates rendering — does not reimplement it.
function renderPage(file: string, portable: boolean): string {
  const args = [RENDER, file, '--html'];
  if (portable) args.push('--portable');
  execFileSync('node', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  return injectReload(readFileSync(file.replace(/\.mmd$/, '.html'), 'utf8'));
}

function main(argv: string[]): void {
  const { file, port, portable } = parseArgs(argv);
  if (!file) die('usage: node scripts/mermaid-watch.ts <file.mmd> [--port 8080] [--portable]');
  if (!existsSync(file)) die(`file not found: ${file}`);

  let page: string;
  try {
    page = renderPage(file, portable);
  } catch {
    die(`initial render failed for ${file} — ensure the mmdc/Chromium render works`);
  }
  const clients = new Set<http.ServerResponse>();
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(HTTP_OK, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
    } else if (req.url === '/events') {
      res.writeHead(HTTP_OK, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(HTTP_NOT_FOUND);
      res.end();
    }
  });

  watchFile(file, { interval: POLL_INTERVAL_MS }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    try { page = renderPage(file, portable); } catch { /* keep the last good page on a render error */ }
    for (const res of clients) {
      try { res.write('data: reload\n\n'); } catch { clients.delete(res); }
    }
  });

  server.listen(port, () => {
    process.stdout.write(`mermaid-watch: http://localhost:${port}  (watching ${resolve(file)})\n`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
