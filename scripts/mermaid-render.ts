#!/usr/bin/env node
// mermaid-render — render a mermaid `.mmd` source to SVG locally; optionally
// publish a mermaid.live edit URL.
// Why: mermaid text is the single source of truth; the SVG is a derived,
// offline artifact. Local render is the default and the only thing that runs
// unless you ask to publish — confidential diagrams never leave the machine by
// default. `--publish` is the one explicit remote action (a mermaid.live URL
// the user chooses to open).
// Usage:
//   node scripts/mermaid-render.ts <input.mmd> [--out <file.svg>] [--wrap] [--publish] [--no-render]
//     (default)     render <input>.svg locally, nothing remote
//     --wrap        (re)write <input>.md — the .mmd inside a ```mermaid block —
//                   for VS Code live preview; the open preview auto-refreshes
//     --open        open the rendered SVG in the OS default viewer (re-render
//                   overwrites it in place, so the viewer refreshes)
//     --publish     also print a mermaid.live edit URL (opt-in remote share)
//     --short       shorten the published URL via is.gd (implies --publish;
//                   sends the diagram to a second service — opt-in)
//     --no-render   skip the local SVG (use with --wrap or --publish)
//     --out <file>  override the output path (default: <input>.svg)
// Idempotent: the same `.mmd` reproduces the same SVG / wrapper.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

// mermaid.live encodes editor state as base64url(zlib-deflate(JSON)) after
// `#pako:`. Pure and deterministic — the unit-tested core.
export function mermaidLiveUrl(mmd: string, theme = 'default'): string {
  const state = { code: mmd, mermaid: { theme }, autoSync: true, updateDiagram: true };
  const pako = deflateSync(Buffer.from(JSON.stringify(state), 'utf8'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `https://mermaid.live/edit#pako:${pako}`;
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

function die(msg: string): never {
  process.stderr.write(`mermaid-render: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { input?: string; out?: string; wrap: boolean; open: boolean; publish: boolean; short: boolean; noRender: boolean } {
  const opts: { input?: string; out?: string; wrap: boolean; open: boolean; publish: boolean; short: boolean; noRender: boolean } = { wrap: false, open: false, publish: false, short: false, noRender: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--wrap') opts.wrap = true;
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
  const { input, out, wrap, open, publish, short, noRender } = parseArgs(argv);
  if (!input) die('usage: node scripts/mermaid-render.ts <input.mmd> [--out <file.svg>] [--wrap] [--open] [--publish] [--short] [--no-render]');
  if (!existsSync(input)) die(`input not found: ${input}`);
  if (noRender && !publish && !wrap && !open) die('--no-render skips the only output; add --wrap, --open, or --publish, or drop --no-render');

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
    // time, heavy). In a sandboxed/CI env that needs --no-sandbox, pass
    // `-p puppeteer-config.json` where the file is {"args":["--no-sandbox"]}.
    try {
      execFileSync('npx', ['-y', '@mermaid-js/mermaid-cli', '-i', input, '-o', svg], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
    } catch {
      die('local render failed via mmdc — ensure network access for the one-time Chromium pull, or use --no-render --publish');
    }
    process.stdout.write(`rendered: ${svg}\n`);
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
