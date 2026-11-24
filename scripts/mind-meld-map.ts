// mind-meld-map — mind-meld's default view: a static map of a whole repo, in any of its supported
// languages, as drill-down GitHub pages. The repo map shows its areas (top-level folders) and the imports
// between them; each area page shows its source files, their definitions with line links, and imports.
// No execution and no Docker: recording runs (flow/piece) is the opt-in dive for flows that need it.
// Facts only: arrows are imports declared in source, never inferred calls, and every definition says
// how it was found (scripts/mind-meld-langs.ts).
// Usage: node scripts/mind-meld.ts map <repo-root> <out-dir>

import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { codeSpan, renderMarkdown, type PageContext } from './explorer-markdown.ts';
import { validateSpec, type Bullet, type ExplorerNode, type ExplorerSpec } from './explorer-spec.ts';
import { adapterFor, languageFacts, loadAdapters, type ModuleFacts } from './mind-meld-langs.ts';

const MAP_TITLE = 'Repo map';
const MAP_FILE = 'index.md';
const IMPORTS = 'Imports (declared in source, not observed calls)';
const ROOT_AREA = '(root)';
// Tests, specs, fixtures, type declarations and vendored or built trees are not what the repo ships. Not
// shared with lib/dependency-watch's list: that copy ships into other repos on its own and imports nothing.
const NOT_SHIPPED = /\.d\.ts$|(^|\/)\.mind-meld\/|(^|\/)(tests?|spec|specs|fixtures|testdata|vendor|node_modules|target|dist|build)\/|\.(test|spec)\.(ts|tsx|mts)$|(^|\/)test_[^/]*\.py$|_test\.py$|_(spec|test)\.rb$/;

const areaOf = (file: string): string => file.includes('/') ? file.split('/')[0] : ROOT_AREA;
// An area's name where a word is needed (a page name, an identifier).
export const areaBase = (area: string): string => area === ROOT_AREA ? 'root' : area;
export const NO_SOURCE = 'no source files in a supported language (add an adapter in .mind-meld/languages)';
export function byArea(facts: ModuleFacts[]): Map<string, ModuleFacts[]> {
  const areas = new Map<string, ModuleFacts[]>();
  for (const m of facts) areas.set(areaOf(m.file), [...(areas.get(areaOf(m.file)) ?? []), m]);
  return areas;
}
export const inAreaPath = (file: string, area: string): string => area === ROOT_AREA ? file : file.slice(area.length + 1);
const cleanName = (name: string): string => name.replace(/^\.+/, '').replace(/[^\w.-]/g, '_') || 'page';

// Unique page names from [key, wanted base] pairs: `index.md` is the map's, and bases that clean up
// alike (`.github`, `github`) get a numbered suffix.
function pageNames(wanted: [string, string][], used = new Set([MAP_FILE])): Map<string, string> {
  const names = new Map<string, string>();
  for (const [key, base] of wanted) {
    let name = `${cleanName(base)}.md`;
    for (let n = 2; used.has(name); n++) name = `${cleanName(base)}_${n}.md`;
    used.add(name); names.set(key, name);
  }
  return names;
}

// ── Groups: how an area splits when it is too big for one page ──────────────────────────────────────
// A subfolder is a group. Files directly in the area cluster by the first segment of their name
// (`queue-db.ts`, `queue-lock.ts` → `queue-*`), labelled by the longest prefix the cluster shares; a file
// that shares its first segment with no other file goes to `(other)`. Found from names only, never guessed.
const OTHER = '(other)';
const MAX_PAGE_MODULES = 12;
const firstSegment = (path: string): string => path.split('/').pop()!.replace(/\.[^.]+$/, '').split(/[-_.]/)[0];

function commonPrefix(names: string[]): string {
  const parts = names.map(n => n.split('/').pop()!.replace(/\.[^.]+$/, '').split('-'));
  const shared: string[] = [];
  for (let i = 0; parts.every(p => p.length > i && p[i] === parts[0][i]); i++) shared.push(parts[0][i]);
  return shared.join('-') || firstSegment(names[0]);
}

export interface Group { key: string; label: string; modules: ModuleFacts[] }

export function groupsOf(area: string, modules: ModuleFacts[]): Group[] {
  const top = modules.filter(m => !inAreaPath(m.file, area).includes('/'));
  const counts = new Map<string, number>();
  for (const m of top) counts.set(firstSegment(m.file), (counts.get(firstSegment(m.file)) ?? 0) + 1);
  const keyOf = (m: ModuleFacts): string => {
    const path = inAreaPath(m.file, area);
    if (path.includes('/')) return `${path.split('/')[0]}/`;
    return (counts.get(firstSegment(m.file)) ?? 0) > 1 ? firstSegment(m.file) : OTHER;
  };
  const byKey = new Map<string, ModuleFacts[]>();
  for (const m of modules) byKey.set(keyOf(m), [...(byKey.get(keyOf(m)) ?? []), m]);
  return [...byKey].sort(([a], [b]) => Number(a === OTHER) - Number(b === OTHER) || a.localeCompare(b)).map(([key, members]) => ({
    key,
    label: key.endsWith('/') || key === OTHER ? key : `${commonPrefix(members.map(m => m.file))}-*`,
    modules: members,
  }));
}

export async function scanRepo(root: string): Promise<ModuleFacts[]> {
  const adapters = await loadAdapters(root);
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  // Regular files only: a tracked file deleted from the working tree, or a symlink, is not mapped.
  const isFile = (f: string): boolean => { try { return lstatSync(join(root, f)).isFile(); } catch { return false; } };
  return languageFacts(root, tracked.filter(f => f && adapterFor(f, adapters) && !NOT_SHIPPED.test(f) && isFile(f)), adapters);
}

interface MapOptions { sourcePrefix: string }

function moduleNode(m: ModuleFacts, area: string, lane: string, options: MapOptions): ExplorerNode {
  const link = (line?: number): string => `<${options.sourcePrefix}${m.file}${line ? `#L${line}` : ''}>`;
  const inArea = inAreaPath(m.file, area);
  const elsewhere = m.imports.filter(f => areaOf(f) !== area);
  const definitions: Bullet[] = m.definitions.length
    ? [{ t: 'Defines', more: m.definitions.map(d => `${codeSpan(d.name)} (${d.kind}): [line ${d.line}](${link(d.line)})`) }]
    : [];
  return {
    lane,
    name: inArea,
    role: `${m.language} module, ${m.lines} lines.`,
    details: [
      `Source: [${m.file}](${link()})`,
      ...definitions,
      ...(elsewhere.length ? [`Imports from other areas: ${elsewhere.map(codeSpan).join(', ')}`] : []),
      `How found: ${m.method}`,
    ],
  };
}

const importSteps = (from: (m: ModuleFacts) => string, to: (file: string) => string | undefined, modules: ModuleFacts[]) => {
  const hops = new Map<string, number>();
  for (const m of modules) for (const file of m.imports) {
    const target = to(file);
    if (target !== undefined && target !== from(m)) hops.set(`${from(m)}\0${target}`, (hops.get(`${from(m)}\0${target}`) ?? 0) + 1);
  }
  return [...hops].map(([key, n]): [string, string, string, string] => {
    const [a, b] = key.split('\0');
    return [a, b, 'imports', `${n} import${n === 1 ? '' : 's'}`];
  });
};
const importFlow = (steps: [string, string, string, string][]) => steps.length ? [{ id: 'imports', name: IMPORTS, steps }] : [];

// A page of modules, grouped in lanes (an area that fits on one page, or one group of a big area).
interface ModulesPage { title: string; where: string; area: string; lanes: [string, ModuleFacts[]][] }

function modulesSpec({ title, where, area, lanes }: ModulesPage, options: MapOptions): ExplorerSpec {
  const modules = lanes.flatMap(([, members]) => members);
  const files = new Set(modules.map(m => m.file));
  return {
    title,
    lede: `${modules.length} source files in ${where}, with their definitions and the imports between them. Arrows are imports declared in source, not observed calls.`,
    lanes: lanes.map(([lane]) => ({ id: lane, name: lane })),
    nodes: Object.fromEntries(lanes.flatMap(([lane, members]) => members.map(m => [m.file, moduleNode(m, area, lane, options)]))),
    flows: importFlow(importSteps(m => m.file, f => files.has(f) ? f : undefined, modules)),
    ask: { context: `The reader is learning how ${where} in this repo is organized, from a static map (no code was run).` },
  };
}

// A big area's page: its groups, each linking to its own page, with the imports between them.
function groupsSpec(area: string, groups: Group[], pages: Map<string, string>): ExplorerSpec {
  const groupOf = new Map(groups.flatMap(g => g.modules.map(m => [m.file, g.key])));
  return {
    title: area,
    lede: `${groups.reduce((n, g) => n + g.modules.length, 0)} source files in \`${area}/\`, grouped by subfolder and by shared name prefix. Click a group for its files. Arrows are imports declared in source, not observed calls.`,
    lanes: [{ id: 'groups', name: 'Groups' }],
    nodes: Object.fromEntries(groups.map(g => [g.key, {
      lane: 'groups', name: g.label, link: pages.get(`${area}\0${g.key}`),
      role: `${g.modules.length} module${g.modules.length === 1 ? '' : 's'}`,
    }])),
    flows: importFlow(importSteps(m => groupOf.get(m.file)!, f => groupOf.get(f), groups.flatMap(g => g.modules))),
    ask: { context: `The reader is learning how the ${area} part of this repo is organized, from a static map (no code was run).` },
  };
}

function mapSpec(areas: Map<string, ModuleFacts[]>, pages: Map<string, string>): ExplorerSpec {
  const steps = importSteps(m => areaOf(m.file), areaOf, [...areas.values()].flat());
  const languages = (modules: ModuleFacts[]): string => [...new Set(modules.map(m => m.language))].sort().join(', ');
  return {
    title: MAP_TITLE,
    lede: 'Every source file in this repo, by top-level folder, from a static map (no code was run). Tests, fixtures and vendored or built folders are left out. Click an area for its files and definitions. Arrows are imports declared in source, not observed calls; record a run with mind-meld to see what actually executes.',
    lanes: [{ id: 'areas', name: 'Areas' }],
    nodes: Object.fromEntries([...areas].map(([area, modules]) => [area, {
      lane: 'areas', name: area, link: pages.get(area),
      role: `${modules.length} module${modules.length === 1 ? '' : 's'} (${languages(modules)})`,
    }])),
    flows: importFlow(steps),
    ask: { context: 'The reader wants an overview of how this repo is organized, from a static map (no code was run).' },
  };
}

interface Page { file: string; spec: ExplorerSpec; up?: { title: string; link: string } }

// An area that fits on one page lists its modules by group; a bigger one gets a page of groups and one
// page per group, so no page is too dense to read.
function areaPages(area: string, modules: ModuleFacts[], pages: Map<string, string>, options: MapOptions): Page[] {
  const groups = groupsOf(area, modules);
  const file = pages.get(area)!;
  const where = (g?: Group): string => `\`${area === ROOT_AREA ? '.' : `${area}/`}${g ? (g.key === OTHER ? '` (ungrouped files)' : `${g.label}\``) : '`'}`;
  const up = { title: MAP_TITLE, link: MAP_FILE };
  if (modules.length <= MAX_PAGE_MODULES || groups.length < 2) {
    return [{ file, up, spec: modulesSpec({ title: area, where: where(), area, lanes: groups.map(g => [g.label, g.modules]) }, options) }];
  }
  return [
    { file, up, spec: groupsSpec(area, groups, pages) },
    ...groups.map(g => ({ file: pages.get(`${area}\0${g.key}`)!, up: { title: area, link: file },
      spec: modulesSpec({ title: `${area}: ${g.label}`, where: where(g), area, lanes: [[g.label, g.modules]] }, options) })),
  ];
}

// Writes the repo map and its area (and group) pages into outDir; returns the file names written.
export async function writeMap(root: string, outDir: string): Promise<string[]> {
  const facts = await scanRepo(root);
  if (!facts.length) throw new Error(`mind-meld map: ${NO_SOURCE}`);
  const areas = byArea(facts);
  const options: MapOptions = { sourcePrefix: `${relative(outDir, root) || '.'}/` };
  const used = new Set([MAP_FILE]);
  const pageOf = pageNames([...areas.keys()].map(area => [area, areaBase(area)]), used);
  const groupPages = pageNames([...areas].flatMap(([area, modules]) => modules.length <= MAX_PAGE_MODULES ? []
    : groupsOf(area, modules).map((g): [string, string] => [`${area}\0${g.key}`,
      `${cleanName(areaBase(area))}-${g.key === OTHER ? 'other' : g.label.replace(/(-\*|\/)$/, '')}`])), used);
  const allPages = new Map([...pageOf, ...groupPages]);
  const pages: Page[] = [
    { file: MAP_FILE, spec: mapSpec(areas, pageOf) },
    ...[...areas].flatMap(([area, modules]) => areaPages(area, modules, allPages, options)),
  ];
  const titles = Object.fromEntries(pages.map(p => [p.file, p.spec.title]));
  mkdirSync(outDir, { recursive: true });
  for (const { file, spec, up } of pages) {
    const problems = validateSpec(spec);
    if (problems.length) throw new Error(`mind-meld map: ${file}: ${problems.join('; ')}`);
    writeFileSync(join(outDir, file), renderMarkdown(spec, { titles, up } satisfies PageContext));
  }
  return pages.map(p => p.file);
}
