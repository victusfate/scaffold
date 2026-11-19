#!/usr/bin/env node
// render-diagrams — regenerate every committed diagram image from its mermaid source.
// Why: docs/diagrams/src/*.mmd is the only thing anyone edits; docs/diagrams/generated/ is derived
// output, rebuilt in full by this one command so the images can be refreshed at any time and never
// drift from hand edits. Each source renders to generated/<slug>.svg; --portable keeps labels GitHub-safe.
// Usage:
//   node scripts/render-diagrams.ts            (or: npm run diagrams)
//   node scripts/render-diagrams.ts <slug>...  render only these sources

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs', 'diagrams', 'src');
const OUT = join(ROOT, 'docs', 'diagrams', 'generated');
const RENDER = join(ROOT, 'scripts', 'mermaid-render.ts');

const requested = process.argv.slice(2);
const slugs = requested.length
  ? requested
  : readdirSync(SRC).filter(f => f.endsWith('.mmd')).map(f => f.replace(/\.mmd$/, '')).sort();

mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const slug of slugs) {
  const input = join(SRC, `${slug}.mmd`);
  if (!existsSync(input)) { process.stderr.write(`render-diagrams: no source ${input}\n`); failed++; continue; }
  try {
    execFileSync('node', [RENDER, input, '--portable', '--out', join(OUT, `${slug}.svg`)], { stdio: 'inherit' });
  } catch {
    failed++;
  }
}
process.stdout.write(`render-diagrams: ${slugs.length - failed}/${slugs.length} rendered into docs/diagrams/generated/\n`);
process.exit(failed ? 1 : 0);
