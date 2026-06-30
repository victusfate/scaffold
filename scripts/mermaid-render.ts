#!/usr/bin/env node
// mermaid-render — render a mermaid `.mmd` source to SVG locally and print a
// mermaid.live edit URL.
// Why: mermaid text is the single source of truth; the SVG and the URL are
// derived artifacts. Local render (via mmdc) keeps confidential diagrams off
// remote renderers; the mermaid.live URL is opt-in (the user opens it).
// Usage:
//   node scripts/mermaid-render.ts <input.mmd> [--out <file.svg>] [--url-only]
// Prints the live edit URL and, unless --url-only, the rendered SVG path.
// Idempotent: the same `.mmd` reproduces the same SVG.

import { readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

function die(msg: string): never {
  process.stderr.write(`mermaid-render: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { input?: string; out?: string; urlOnly: boolean } {
  const opts: { input?: string; out?: string; urlOnly: boolean } = { urlOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url-only') opts.urlOnly = true;
    else if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i].startsWith('--')) die(`unknown option: ${argv[i]}`);
    else opts.input = argv[i];
  }
  return opts;
}

function main(argv: string[]): void {
  const { input, out, urlOnly } = parseArgs(argv);
  if (!input) die('usage: node scripts/mermaid-render.ts <input.mmd> [--out <file.svg>] [--url-only]');
  if (!existsSync(input)) die(`input not found: ${input}`);

  const mmd = readFileSync(input, 'utf8');
  if (!mmd.trim()) die(`input is empty: ${input}`);

  if (!urlOnly) {
    const svg = out ?? input.replace(/\.mmd$/, '.svg');
    // mmdc launches headless Chromium via puppeteer; first run pulls it (one
    // time, heavy). In a sandboxed/CI env that needs --no-sandbox, pass
    // `-p puppeteer-config.json` where the file is {"args":["--no-sandbox"]}.
    try {
      execFileSync('npx', ['-y', '@mermaid-js/mermaid-cli', '-i', input, '-o', svg], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
    } catch {
      die('local render failed via mmdc — ensure network access for the one-time Chromium pull, or use --url-only');
    }
    process.stdout.write(`rendered: ${svg}\n`);
  }
  process.stdout.write(`live edit URL: ${mermaidLiveUrl(mmd)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
