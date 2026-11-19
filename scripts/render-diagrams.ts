#!/usr/bin/env node
// render-diagrams — regenerate every committed diagram image from its mermaid source.
// Why: docs/diagrams/src/*.mmd is the only thing anyone edits; docs/diagrams/generated/ is derived
// output, rebuilt in full by this one command so the images can be refreshed at any time and never
// drift from hand edits. Each source renders to generated/<slug>.svg (GitHub-safe labels by default).
// Each SVG is stamped with a hash of its source, so --check (in npm test) catches an SVG that no longer
// matches its .mmd without rendering anything (rendering needs headless Chrome).
// Usage:
//   node scripts/render-diagrams.ts            (or: npm run diagrams)
//   node scripts/render-diagrams.ts <slug>...  render only these sources
//   node scripts/render-diagrams.ts --check    report stale SVGs, render nothing; exit 1 on any

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs', 'diagrams', 'src');
const OUT = join(ROOT, 'docs', 'diagrams', 'generated');
const RENDER = join(ROOT, 'scripts', 'mermaid-render.ts');
const HASH_LENGTH = 12;
const STAMP = /\n?<!-- source-sha256: ([0-9a-f]+) -->\n?/;

export const sourceHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, HASH_LENGTH);

// The stamp sits right after the opening <svg ...> tag; an existing stamp is replaced.
export function stampSvg(svg: string, hash: string): string {
  const clean = svg.replace(STAMP, '');
  const end = clean.indexOf('>', clean.indexOf('<svg')) + 1;
  return `${clean.slice(0, end)}\n<!-- source-sha256: ${hash} -->\n${clean.slice(end)}`;
}

const slugsIn = (src: string): string[] => readdirSync(src).filter(f => f.endsWith('.mmd')).map(f => f.replace(/\.mmd$/, '')).sort();

export function staleSvgs(src: string, out: string): string[] {
  return slugsIn(src).filter(slug => {
    const svg = join(out, `${slug}.svg`);
    return !existsSync(svg) || STAMP.exec(readFileSync(svg, 'utf8'))?.[1] !== sourceHash(readFileSync(join(src, `${slug}.mmd`), 'utf8'));
  }).map(slug => `generated/${slug}.svg is stale: run npm run diagrams -- ${slug}`);
}

function render(slugs: string[]): number {
  mkdirSync(OUT, { recursive: true });
  let failed = 0;
  for (const slug of slugs) {
    const input = join(SRC, `${slug}.mmd`), svg = join(OUT, `${slug}.svg`);
    if (!existsSync(input)) { process.stderr.write(`render-diagrams: no source ${input}\n`); failed++; continue; }
    try {
      execFileSync('node', [RENDER, input, '--out', svg], { stdio: 'inherit' });
      writeFileSync(svg, stampSvg(readFileSync(svg, 'utf8'), sourceHash(readFileSync(input, 'utf8'))));
    } catch {
      failed++;
    }
  }
  process.stdout.write(`render-diagrams: ${slugs.length - failed}/${slugs.length} rendered into docs/diagrams/generated/\n`);
  return failed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const stale = staleSvgs(SRC, OUT);
    for (const p of stale) process.stderr.write(`render-diagrams: ${p}\n`);
    process.exit(stale.length ? 1 : 0);
  }
  process.exit(render(args.length ? args : slugsIn(SRC)) ? 1 : 0);
}
