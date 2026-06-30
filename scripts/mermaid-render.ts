#!/usr/bin/env node
// mermaid-render — render a mermaid `.mmd` source to SVG locally; optionally
// publish a mermaid.live edit URL.
// Why: mermaid text is the single source of truth; the SVG is a derived,
// offline artifact. Local render is the default and the only thing that runs
// unless you ask to publish — confidential diagrams never leave the machine by
// default. `--publish` is the one explicit remote action (a mermaid.live URL
// the user chooses to open).
// Usage:
//   node scripts/mermaid-render.ts <input.mmd> [--out <file.svg>] [--publish] [--no-render]
//     (default)     render <input>.svg locally, nothing remote
//     --publish     also print a mermaid.live edit URL (opt-in remote share)
//     --no-render   skip the local SVG (use with --publish for a URL only)
//     --out <file>  override the output path (default: <input>.svg)
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

function parseArgs(argv: string[]): { input?: string; out?: string; publish: boolean; noRender: boolean } {
  const opts: { input?: string; out?: string; publish: boolean; noRender: boolean } = { publish: false, noRender: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--publish') opts.publish = true;
    else if (argv[i] === '--no-render') opts.noRender = true;
    else if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i].startsWith('--')) die(`unknown option: ${argv[i]}`);
    else opts.input = argv[i];
  }
  return opts;
}

function main(argv: string[]): void {
  const { input, out, publish, noRender } = parseArgs(argv);
  if (!input) die('usage: node scripts/mermaid-render.ts <input.mmd> [--out <file.svg>] [--publish] [--no-render]');
  if (!existsSync(input)) die(`input not found: ${input}`);
  if (noRender && !publish) die('--no-render skips the only output; add --publish for a URL, or drop --no-render');

  const mmd = readFileSync(input, 'utf8');
  if (!mmd.trim()) die(`input is empty: ${input}`);

  if (!noRender) {
    const svg = out ?? input.replace(/\.mmd$/, '.svg');
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
  if (publish) {
    process.stdout.write(`live edit URL: ${mermaidLiveUrl(mmd)}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
