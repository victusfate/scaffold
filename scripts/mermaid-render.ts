#!/usr/bin/env node
// mermaid-render — render a mermaid `.mmd` source to SVG locally; optionally
// publish a mermaid.live edit URL.
// Why: mermaid text is the single source of truth; the SVG is a derived,
// offline artifact. Local render is the default and the only thing that runs
// unless you ask to publish — confidential diagrams never leave the machine by
// default. `--publish` is the one explicit remote action (a mermaid.live URL
// the user chooses to open).
// Usage:
//   node scripts/mermaid-render.ts <input.mmd> [--out <file.svg>] [--wrap] [--local] [--open] [--publish] [--no-render]
//     (default)     render <input>.svg locally, nothing remote
//     --wrap        (re)write <input>.md — the .mmd inside a ```mermaid block —
//                   for VS Code live preview; the open preview auto-refreshes
//     --local       print a self-hosted editor URL (the mermaid-live-editor
//                   Docker container on localhost) — the full editor, offline
//     --port <n>    port for --local (default 8080)
//     --open        open the rendered SVG in the OS default viewer (re-render
//                   overwrites it in place, so the viewer refreshes)
//     --publish     also print a mermaid.live edit URL (opt-in remote share)
//     --short       shorten the published URL via is.gd (implies --publish;
//                   sends the diagram to a second service — opt-in)
//     --png         also render <input>.png (high-res, opaque) — the crisp
//                   artifact for a phone photo viewer's native pinch-zoom
//     --html        also write <input>.html — a self-contained interactive
//                   viewer (inline SVG + dependency-free touch pan/zoom) that
//                   opens in any mobile browser; no server, no CDN
//     --portable    render labels as SVG <text> (htmlLabels:false) so text does
//                   not clip in non-browser / mobile SVG viewers
//     --scale <n>   PNG scale factor (default 3); higher = crisper + larger
//     --no-render   skip the local SVG (use with --wrap, --local, or --publish)
//     --out <file>  override the SVG output path (default: <input>.svg)
// Idempotent: the same `.mmd` reproduces the same SVG / PNG / HTML / wrapper.

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// The mermaid editor (mermaid.live or a self-hosted mermaid-live-editor) encodes
// its state as base64url(zlib-deflate(JSON)) after `#pako:`. The same encoding
// works against any host, so `base` selects mermaid.live or a localhost
// container. Pure and deterministic — the unit-tested core.
export function mermaidLiveUrl(mmd: string, theme = 'default', base = 'https://mermaid.live'): string {
  const state = { code: mmd, mermaid: { theme }, autoSync: true, updateDiagram: true };
  const pako = deflateSync(Buffer.from(JSON.stringify(state), 'utf8'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${base}/edit#pako:${pako}`;
}

// Build the title shown atop the live-preview wrapper from the file stem:
// product-photo-service.mmd -> "Product Photo Service".
export function titleFromPath(input: string): string {
  return basename(input).replace(/\.mmd$/, '').split(/[-_]/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// The Markdown wrapper renders live in VS Code's built-in preview (with the
// bierner.markdown-mermaid extension). The .mmd stays the source of truth.
export function wrapMarkdown(mmd: string, input: string): string {
  return [
    `# ${titleFromPath(input)}`,
    '',
    `> Live preview wrapper. Source of truth: \`${basename(input)}\`.`,
    '> Regenerated from the .mmd on each edit; the open preview auto-refreshes.',
    '',
    '```mermaid',
    mmd.replace(/\n$/, ''),
    '```',
    '',
  ].join('\n');
}

// The OS default-viewer command per platform. Pure so it is unit-testable
// without actually spawning a viewer.
export function openerArgs(platform: string, file: string): { cmd: string; args: string[] } {
  if (platform === 'darwin') return { cmd: 'open', args: [file] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', file] };
  return { cmd: 'xdg-open', args: [file] };
}

function openInViewer(file: string): void {
  const { cmd, args } = openerArgs(process.platform, file);
  // Detached so the viewer outlives this short-lived script.
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

// Shorten a URL via is.gd's simple API. Network step (declared) — only reached
// behind --short, which the user opts into knowing the diagram is sent on.
async function shortenUrl(longUrl: string): Promise<string> {
  const api = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`;
  const res = await fetch(api);
  const text = (await res.text()).trim();
  if (!res.ok || !text.startsWith('http')) throw new Error(text || `HTTP ${res.status}`);
  return text;
}

// Fill the self-contained viewer template with the rendered SVG + a title. The
// pan/zoom markup and script live in mermaid-viewer.template.html (a non-code
// asset) so the numeric CSS/JS constants there are not mistaken for magic
// thresholds in this source. Pure — the caller supplies the template text — so
// it is unit-testable without disk access. Replacements use a function value so
// `$` inside the SVG is not interpreted as a replacement pattern.
export function interactiveHtml(svg: string, title: string, template: string): string {
  const inlineSvg = svg.replace(/<\?xml[^>]*\?>/, '').trim();
  return template.replace('%%TITLE%%', () => title).replace('%%SVG%%', () => inlineSvg);
}

// mmdc launches headless Chromium via puppeteer. Two portability concerns are
// handled here so callers never have to: (1) running as root (containers/CI)
// needs --no-sandbox, passed via a temp puppeteer config; (2) --portable emits
// SVG-text labels (htmlLabels:false) via a temp mermaid config. Temp files are
// cleaned up after the run.
function runMmdc(input: string, output: string, opts: { portable?: boolean; scale?: number; background?: string } = {}): void {
  const args = ['-y', '@mermaid-js/mermaid-cli', '-i', input, '-o', output];
  if (opts.scale) args.push('-s', String(opts.scale));
  if (opts.background) args.push('-b', opts.background);
  const temps: string[] = [];
  if (opts.portable) {
    const cfg = join(tmpdir(), `mmrc-${process.pid}-${basename(output)}.json`);
    writeFileSync(cfg, JSON.stringify({ htmlLabels: false, flowchart: { htmlLabels: false } }));
    args.push('-c', cfg); temps.push(cfg);
  }
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) {
    const pcfg = join(tmpdir(), `pptr-${process.pid}-${basename(output)}.json`);
    writeFileSync(pcfg, JSON.stringify({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }));
    args.push('-p', pcfg); temps.push(pcfg);
  }
  try {
    execFileSync('npx', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  } finally {
    for (const f of temps) { try { rmSync(f); } catch { /* best effort */ } }
  }
}

function die(msg: string): never {
  process.stderr.write(`mermaid-render: ${msg}\n`);
  process.exit(1);
}

interface Opts { input?: string; out?: string; wrap: boolean; png: boolean; html: boolean; portable: boolean; scale: string; local: boolean; port: string; open: boolean; publish: boolean; short: boolean; noRender: boolean }

function parseArgs(argv: string[]): Opts {
  const opts: Opts = { wrap: false, png: false, html: false, portable: false, scale: '3', local: false, port: '8080', open: false, publish: false, short: false, noRender: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--wrap') opts.wrap = true;
    else if (argv[i] === '--png') opts.png = true;
    else if (argv[i] === '--html') opts.html = true;
    else if (argv[i] === '--portable') opts.portable = true;
    else if (argv[i] === '--scale') opts.scale = argv[++i];
    else if (argv[i] === '--local') opts.local = true;
    else if (argv[i] === '--port') opts.port = argv[++i];
    else if (argv[i] === '--open') opts.open = true;
    else if (argv[i] === '--publish') opts.publish = true;
    else if (argv[i] === '--short') { opts.short = true; opts.publish = true; }
    else if (argv[i] === '--no-render') opts.noRender = true;
    else if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i].startsWith('--')) die(`unknown option: ${argv[i]}`);
    else opts.input = argv[i];
  }
  return opts;
}

async function main(argv: string[]): Promise<void> {
  const { input, out, wrap, png, html, portable, scale, local, port, open, publish, short, noRender } = parseArgs(argv);
  if (!input) die('usage: node scripts/mermaid-render.ts <input.mmd> [--out <file.svg>] [--png] [--html] [--portable] [--scale <n>] [--wrap] [--local] [--open] [--publish] [--short] [--no-render]');
  if (!existsSync(input)) die(`input not found: ${input}`);
  if (noRender && (png || html)) die('--no-render conflicts with --png/--html, which are renders');
  if (noRender && !publish && !wrap && !open && !local) die('--no-render skips the only output; add --wrap, --local, --open, or --publish, or drop --no-render');

  const mmd = readFileSync(input, 'utf8');
  if (!mmd.trim()) die(`input is empty: ${input}`);
  const svg = out ?? input.replace(/\.mmd$/, '.svg');

  if (wrap) {
    const md = input.replace(/\.mmd$/, '.md');
    writeFileSync(md, wrapMarkdown(mmd, input));
    process.stdout.write(`wrapped: ${md}\n`);
  }

  if (!noRender) {
    // mmdc launches headless Chromium via puppeteer; first run pulls it (one
    // time, heavy). runMmdc auto-handles root/--no-sandbox and --portable.
    try {
      runMmdc(input, svg, { portable });
    } catch {
      die('local render failed via mmdc — ensure network access for the one-time Chromium pull, or use --no-render --publish');
    }
    process.stdout.write(`rendered: ${svg}\n`);

    if (html) {
      const htmlPath = input.replace(/\.mmd$/, '.html');
      const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'mermaid-viewer.template.html'), 'utf8');
      writeFileSync(htmlPath, interactiveHtml(readFileSync(svg, 'utf8'), titleFromPath(input), template));
      process.stdout.write(`interactive viewer: ${htmlPath}\n`);
    }
    if (png) {
      const pngPath = input.replace(/\.mmd$/, '.png');
      try {
        runMmdc(input, pngPath, { portable, scale: Number(scale), background: 'white' });
      } catch {
        die('PNG render failed via mmdc — ensure network access for the one-time Chromium pull');
      }
      process.stdout.write(`rendered: ${pngPath}\n`);
    }
  }
  if (local) {
    process.stdout.write(`local editor URL: ${mermaidLiveUrl(mmd, 'default', `http://localhost:${port}`)}\n`);
  }
  if (open) {
    if (!existsSync(svg)) die(`nothing to open at ${svg} — render first (drop --no-render)`);
    openInViewer(svg);
    process.stdout.write(`opened: ${svg}\n`);
  }
  if (publish) {
    const url = mermaidLiveUrl(mmd);
    if (short) {
      try {
        process.stdout.write(`live edit URL (short): ${await shortenUrl(url)}\n`);
      } catch (e) {
        process.stderr.write(`mermaid-render: URL shorten failed (${(e as Error).message}); using full URL\n`);
        process.stdout.write(`live edit URL: ${url}\n`);
      }
    } else {
      process.stdout.write(`live edit URL: ${url}\n`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(e => die((e as Error).message));
