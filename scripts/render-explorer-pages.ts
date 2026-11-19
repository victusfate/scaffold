#!/usr/bin/env node
// render-explorer-pages — build docs/diagrams/pages/<slug>.md from docs/diagrams/explorer/<slug>.explorer.json.
// Why: the markdown pages are derived output (like docs/diagrams/generated); the specs are what anyone
// edits. --check fails on a stale page, a link to a missing page and a missing detail image, so a
// visitor never clicks into nothing.
// Usage:
//   node scripts/render-explorer-pages.ts          write every page (run by npm run diagrams)
//   node scripts/render-explorer-pages.ts --check  report problems, write nothing; exit 1 on any

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './explorer-markdown.ts';
import { validateSpec, type ExplorerSpec } from './explorer-spec.ts';

const DIAGRAMS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'diagrams');

// Links resolve from the page's own directory; a #fragment is not part of the file.
function linkProblems(slug: string, spec: ExplorerSpec, pagesDir: string): string[] {
  const exists = (rel: string): boolean => existsSync(resolve(pagesDir, rel.split('#')[0]));
  return [
    ...Object.entries(spec.nodes).flatMap(([id, n]) => n.link && !exists(n.link) ? [`${slug}: node ${id} links to missing ${n.link}`] : []),
    ...(spec.detail && !exists(spec.detail) ? [`${slug}: detail image missing ${spec.detail}`] : []),
  ];
}

// Returns every problem found. Writes pages unless `check`. Links are checked after every page is
// written, so a link to a sibling page built in the same run resolves.
export function buildPages(root: string, options: { check: boolean }): string[] {
  const specDir = join(root, 'explorer'), pagesDir = join(root, 'pages');
  const specs = readdirSync(specDir).filter(f => f.endsWith('.explorer.json')).sort().map(file => ({
    slug: file.replace(/\.explorer\.json$/, ''),
    spec: JSON.parse(readFileSync(join(specDir, file), 'utf8')) as ExplorerSpec,
  }));
  const invalid = specs.flatMap(({ slug, spec }) => validateSpec(spec).map(e => `${slug}: ${e}`));
  if (invalid.length) return invalid;
  const stale = specs.flatMap(({ slug, spec }) => {
    const page = join(pagesDir, `${slug}.md`), markdown = renderMarkdown(spec);
    if (existsSync(page) && readFileSync(page, 'utf8') === markdown) return [];
    if (options.check) return [`pages/${slug}.md is stale: run npm run diagrams`];
    writeFileSync(page, markdown);
    return [];
  });
  return [...specs.flatMap(({ slug, spec }) => linkProblems(slug, spec, pagesDir)), ...stale];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = buildPages(DIAGRAMS, { check: process.argv.includes('--check') });
  for (const p of problems) process.stderr.write(`render-explorer-pages: ${p}\n`);
  process.exit(problems.length ? 1 : 0);
}
