#!/usr/bin/env node
// explorer-render — render an explorer spec (`diagrams/<slug>.explorer.json`) to
// one self-contained interactive HTML page; optionally export each flow as a
// mermaid sequenceDiagram.
// Why: the JSON spec is the source of truth (like a `.mmd`); the page is a
// derived artifact produced deterministically by one generic template
// (explorer.template.html). The page needs no server and no CDN script, so it
// opens in any harness's browser; Q&A is live only where the host grants
// `window.claude.use('sample')` (a published claude.ai Artifact) and falls back
// to copying the question with its context everywhere else.
// Usage:
//   node scripts/explorer-render.ts <slug.explorer.json> [--out <file.html>] [--mmd] [--check]
//     (default)  validate, then write <slug>.explorer.html next to the spec
//     --out      override the HTML output path
//     --mmd      also write <slug>.<flowId>.mmd — a sequenceDiagram per flow,
//                renderable with scripts/mermaid-render.ts
//     --check    validate only; exit 1 with the problems listed
// Idempotent: the same spec reproduces the same HTML and .mmd files.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec, type ExplorerSpec, type Flow } from './explorer-spec.ts';
import { jsonForScript } from './json-script.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, 'explorer.template.html');

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderHtml(spec: ExplorerSpec, template = readFileSync(TEMPLATE, 'utf8')): string {
  return template.replace('__TITLE__', () => escHtml(spec.title)).replace('__SPEC__', () => jsonForScript(spec));
}

// Mermaid participant ids must be plain identifiers; message text must not
// carry `;` or `#` (statement separator / entity prefix).
const mermaidId = (id: string): string => 'n_' + id.replace(/[^A-Za-z0-9_]/g, '_');
const mermaidText = (s: string): string => s.replace(/[#;]/g, c => (c === '#' ? '#35;' : '#59;')).replace(/\s+/g, ' ').trim();

export function flowToMermaid(spec: ExplorerSpec, flow: Flow): string {
  const parts: string[] = [];
  for (const [a, b] of flow.steps) for (const id of [a, b]) if (!parts.includes(id)) parts.push(id);
  const lines = ['sequenceDiagram', `  title ${mermaidText(flow.name)}`];
  for (const id of parts) lines.push(`  participant ${mermaidId(id)} as ${mermaidText(spec.nodes[id].name)}`);
  flow.steps.forEach(([a, b, what], i) => lines.push(`  ${mermaidId(a)}->>${mermaidId(b)}: ${i + 1}. ${mermaidText(what)}`));
  return lines.join('\n') + '\n';
}

export function outPaths(input: string): { html: string; stem: string } {
  const stem = input.replace(/\.explorer\.json$/, '').replace(/\.json$/, '');
  return { html: `${stem}.explorer.html`, stem };
}

function die(msg: string): never {
  process.stderr.write(`explorer-render: ${msg}\n`);
  process.exit(1);
}

type Args = { input?: string; out?: string; mmd: boolean; check: boolean };
export function parseArgs(argv: string[]): Args {
  const a: Args = { mmd: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--mmd') a.mmd = true;
    else if (v === '--check') a.check = true;
    else if (v === '--out') a.out = argv[++i];
    else if (v.startsWith('--')) die(`unknown option: ${v}`);
    else a.input = v;
  }
  return a;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) die('usage: node scripts/explorer-render.ts <slug.explorer.json> [--out <file.html>] [--mmd] [--check]');
  let spec: ExplorerSpec;
  try { spec = JSON.parse(readFileSync(args.input, 'utf8')) as ExplorerSpec; }
  catch (e) { die(`cannot read ${args.input}: ${(e as Error).message}`); }
  const errs = validateSpec(spec);
  if (errs.length) die(`${errs.length} problem(s) in ${args.input}:\n  ${errs.join('\n  ')}`);
  if (args.check) { console.log(`${args.input}: ok`); return; }
  const { html, stem } = outPaths(args.input);
  const out = args.out ?? html;
  writeFileSync(out, renderHtml(spec));
  console.log(out);
  if (args.mmd) for (const f of spec.flows ?? []) {
    const p = `${stem}.${f.id}.mmd`;
    writeFileSync(p, flowToMermaid(spec, f));
    console.log(p);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
