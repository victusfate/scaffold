#!/usr/bin/env node
// render-explorer-pages — build docs/diagrams/pages/<slug>.md from docs/diagrams/explorer/<slug>.explorer.json.
// Why: the markdown pages are derived output (like docs/diagrams/generated); the specs are what anyone
// edits. --check fails on a stale page, a link to a missing page, a missing detail image and a term
// defined two ways, so a visitor never clicks into nothing or reads two meanings.
// A spec that lists `sources` (the skill text and diagram it summarizes) is flagged when any of them
// changes after its last review, so a skill edit can't leave its page describing old behavior.
// Usage:
//   node scripts/render-explorer-pages.ts               write every page (run by npm run diagrams)
//   node scripts/render-explorer-pages.ts --check       report problems, write nothing; exit 1 on any
//   node scripts/render-explorer-pages.ts --ack <slug>  record that these pages were reviewed against
//                                                       their current sources (npm run diagrams:ack)

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchor } from './check-agents-detail.ts';
import { sourceHash } from './render-diagrams.ts';
import { renderMarkdown } from './explorer-markdown.ts';
import { validateSpec, type ExplorerSpec } from './explorer-spec.ts';

// The landing page every other page links back up to.
const MAP = 'system-map';
// Named in each page's LLM block so a reader's assistant can open the sources (this script is scaffold-only).
const REPO_URL = 'https://github.com/victusfate/scaffold';
const PAGES_URL = `${REPO_URL}/blob/main/docs/diagrams/pages`;
const DIAGRAMS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'diagrams');

// Links resolve from the page's own directory; a #fragment is not part of the file.
function linkProblems(slug: string, spec: ExplorerSpec, pagesDir: string): string[] {
  const exists = (rel: string): boolean => existsSync(resolve(pagesDir, rel.split('#')[0]));
  return [
    ...Object.entries(spec.nodes).flatMap(([id, n]) => n.link && !exists(n.link) ? [`${slug}: node ${id} links to missing ${n.link}`] : []),
    ...(spec.detail && !exists(spec.detail) ? [`${slug}: detail image missing ${spec.detail}`] : []),
  ];
}

// Pages are read side by side, so a term must mean the same thing everywhere (case-insensitive).
function glossaryProblems(specs: { slug: string; spec: ExplorerSpec }[]): string[] {
  const first = new Map<string, { slug: string; d: string }>();
  return specs.flatMap(({ slug, spec }) => Object.values(spec.glossary ?? {}).flatMap(term => {
    const key = term.t.toLowerCase(), seen = first.get(key);
    if (!seen) { first.set(key, { slug, d: term.d }); return []; }
    return seen.d === term.d ? [] : [`glossary: "${term.t}" is defined differently in ${seen.slug} and ${slug}`];
  }));
}

// GitHub drops unknown HTML tags, so `docs/<slug>/` outside code would render as `docs//`. Code fences
// and inline code are exempt.
const HTML_LIKE = /<\/?[A-Za-z][^>]*>/g;
function hiddenTextProblems(slug: string, markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...new Set(prose.match(HTML_LIKE) ?? [])]
    .map(tag => `${slug}: "${tag}" would be hidden by GitHub as an HTML tag; wrap it in backticks`);
}

// The page's own headings; a stage with one of these names (or a repeated name) gets GitHub's
// `-1` anchor suffix, so its link in the stage list would land on the wrong section.
const PAGE_HEADINGS = ['Detailed flow', 'Glossary', 'Ask your LLM'];
function headingProblems(slug: string, spec: ExplorerSpec): string[] {
  const names = [...Object.values(spec.nodes).map(n => n.name), ...PAGE_HEADINGS].map(anchor);
  return [...new Set(names.filter((name, i) => names.indexOf(name) !== i))]
    .map(name => `${slug}: two headings share the anchor #${name}; rename the stage`);
}

const reviewHash = (spec: ExplorerSpec, repoRoot: string): string =>
  sourceHash((spec.sources ?? []).map(path => `${path}\0${readFileSync(join(repoRoot, path), 'utf8')}`).join('\0'));

function reviewProblems(slug: string, spec: ExplorerSpec, repoRoot: string): string[] {
  if (!spec.sources) return [];
  const missing = spec.sources.filter(path => !existsSync(join(repoRoot, path)));
  if (missing.length) return missing.map(path => `${slug}: source ${path} does not exist`);
  return reviewHash(spec, repoRoot) === spec.reviewed ? []
    : [`${slug}: its sources changed since the page was last reviewed (${spec.sources.join(', ')}): review it, then run npm run diagrams:ack -- ${slug}`];
}

const specPath = (root: string, slug: string): string => join(root, 'explorer', `${slug}.explorer.json`);

// Records the current source hash in each spec's `reviewed` field (a text edit, so the file keeps its
// layout). Returns the slugs acknowledged.
export function ackPages(root: string, slugs: string[], repoRoot: string): string[] {
  return slugs.map(slug => {
    const text = readFileSync(specPath(root, slug), 'utf8');
    const spec = JSON.parse(text) as ExplorerSpec;
    if (!spec.sources || spec.reviewed === undefined) throw new Error(`${slug}: no sources/reviewed fields to acknowledge`);
    writeFileSync(specPath(root, slug), text.replace(`"reviewed": ${JSON.stringify(spec.reviewed)}`, `"reviewed": ${JSON.stringify(reviewHash(spec, repoRoot))}`));
    return slug;
  });
}

// Returns every problem found. Writes pages unless `check`. Links are checked after every page is
// written, so a link to a sibling page built in the same run resolves.
export function buildPages(root: string, options: { check: boolean; repoRoot?: string }): string[] {
  const repoRoot = options.repoRoot ?? join(root, '..', '..');
  const specDir = join(root, 'explorer'), pagesDir = join(root, 'pages');
  const specs = readdirSync(specDir).filter(f => f.endsWith('.explorer.json')).sort().map(file => ({
    slug: file.replace(/\.explorer\.json$/, ''),
    spec: JSON.parse(readFileSync(join(specDir, file), 'utf8')) as ExplorerSpec,
  }));
  const invalid = specs.flatMap(({ slug, spec }) => validateSpec(spec).map(e => `${slug}: ${e}`));
  if (invalid.length) return invalid;
  const titles = Object.fromEntries(specs.map(({ slug, spec }) => [`${slug}.md`, spec.title]));
  const map = specs.find(({ slug }) => slug === MAP);
  const pages = specs.map(({ slug, spec }) => ({ slug, spec, markdown: renderMarkdown(spec,
    { titles, up: map && slug !== MAP ? { title: map.spec.title, link: `${MAP}.md` } : undefined,
      source: { name: 'Scaffold', repo: REPO_URL, page: `${PAGES_URL}/${slug}.md` } }) }));
  const pagePath = (slug: string): string => join(pagesDir, `${slug}.md`);
  const changed = pages.filter(({ slug, markdown }) => !existsSync(pagePath(slug)) || readFileSync(pagePath(slug), 'utf8') !== markdown);
  if (!options.check) for (const { slug, markdown } of changed) writeFileSync(pagePath(slug), markdown);
  return [
    ...pages.flatMap(({ slug, spec }) => linkProblems(slug, spec, pagesDir)),
    ...glossaryProblems(specs),
    ...pages.flatMap(({ slug, markdown }) => hiddenTextProblems(slug, markdown)),
    ...specs.flatMap(({ slug, spec }) => headingProblems(slug, spec)),
    ...specs.flatMap(({ slug, spec }) => reviewProblems(slug, spec, repoRoot)),
    ...(options.check ? changed.map(({ slug }) => `pages/${slug}.md is stale: run npm run diagrams`) : []),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--ack') {
    for (const slug of ackPages(DIAGRAMS, args.slice(1), join(DIAGRAMS, '..', '..'))) console.log(`acknowledged ${slug}`);
  }
  const problems = buildPages(DIAGRAMS, { check: args.includes('--check') });
  for (const p of problems) process.stderr.write(`render-explorer-pages: ${p}\n`);
  process.exit(problems.length ? 1 : 0);
}
