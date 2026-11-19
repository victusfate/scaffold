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
const TOP_LANE = '(top)';
// Tests, specs, fixtures, type declarations and vendored or built trees are not what the repo ships. Not
// shared with lib/dependency-watch's list: that copy ships into other repos on its own and imports nothing.
const NOT_SHIPPED = /\.d\.ts$|(^|\/)\.mind-meld\/|(^|\/)(tests?|spec|specs|fixtures|testdata|vendor|node_modules|target|dist|build)\/|\.(test|spec)\.(ts|tsx|mts)$|(^|\/)test_[^/]*\.py$|_test\.py$|_(spec|test)\.rb$/;

const areaOf = (file: string): string => file.includes('/') ? file.split('/')[0] : ROOT_AREA;
// Page names are plain files (no leading dot, no path characters) and unique: `index.md` is the map's,
// and areas whose names clean up alike (`.github`, `github`) get a numbered suffix.
function pageNames(areas: string[]): Map<string, string> {
  const used = new Set([MAP_FILE]), names = new Map<string, string>();
  for (const area of areas) {
    const base = area === ROOT_AREA ? 'root' : area.replace(/^\.+/, '').replace(/[^\w.-]/g, '_') || 'area';
    let name = `${base}.md`;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}.md`;
    used.add(name); names.set(area, name);
  }
  return names;
}

export async function scanRepo(root: string): Promise<ModuleFacts[]> {
  const adapters = await loadAdapters(root);
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  // Regular files only: a tracked file deleted from the working tree, or a symlink, is not mapped.
  const isFile = (f: string): boolean => { try { return lstatSync(join(root, f)).isFile(); } catch { return false; } };
  return languageFacts(root, tracked.filter(f => f && adapterFor(f, adapters) && !NOT_SHIPPED.test(f) && isFile(f)), adapters);
}

interface MapOptions { sourcePrefix: string }

function moduleNode(m: ModuleFacts, area: string, options: MapOptions): ExplorerNode {
  const link = (line?: number): string => `<${options.sourcePrefix}${m.file}${line ? `#L${line}` : ''}>`;
  const inArea = area === ROOT_AREA ? m.file : m.file.slice(area.length + 1);
  const elsewhere = m.imports.filter(f => areaOf(f) !== area);
  const definitions: Bullet[] = m.definitions.length
    ? [{ t: 'Defines', more: m.definitions.map(d => `${codeSpan(d.name)} (${d.kind}): [line ${d.line}](${link(d.line)})`) }]
    : [];
  return {
    lane: inArea.includes('/') ? inArea.split('/')[0] : TOP_LANE,
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

function areaSpec(area: string, modules: ModuleFacts[], options: MapOptions): ExplorerSpec {
  const files = new Set(modules.map(m => m.file));
  const nodes = modules.map(m => [m.file, moduleNode(m, area, options)] as const);
  const lanes = [...new Set(nodes.map(([, node]) => node.lane))];
  const steps = modules.flatMap(m => m.imports.filter(f => files.has(f)).map((f): [string, string, string, string] => [m.file, f, 'imports', '']));
  return {
    title: area,
    lede: `${modules.length} source files in \`${area === ROOT_AREA ? '.' : `${area}/`}\`, with their definitions and the imports between them. Arrows are imports declared in source, not observed calls.`,
    lanes: lanes.map(id => ({ id, name: id })),
    // Grouped by lane, so the page reads folder by folder.
    nodes: Object.fromEntries(lanes.flatMap(lane => nodes.filter(([, node]) => node.lane === lane))),
    flows: steps.length ? [{ id: 'imports', name: IMPORTS, steps }] : [],
    ask: { context: `The reader is learning how the ${area} part of this repo is organized, from a static map (no code was run).` },
  };
}

function mapSpec(areas: Map<string, ModuleFacts[]>, pages: Map<string, string>): ExplorerSpec {
  const hops = new Map<string, number>();
  for (const [area, modules] of areas) {
    for (const target of modules.flatMap(m => m.imports.map(areaOf)).filter(t => t !== area)) {
      hops.set(`${area}\0${target}`, (hops.get(`${area}\0${target}`) ?? 0) + 1);
    }
  }
  const steps = [...hops].map(([key, n]): [string, string, string, string] => {
    const [from, to] = key.split('\0');
    return [from, to, 'imports', `${n} import${n === 1 ? '' : 's'}`];
  });
  const languages = (modules: ModuleFacts[]): string => [...new Set(modules.map(m => m.language))].sort().join(', ');
  return {
    title: MAP_TITLE,
    lede: 'Every source file in this repo, by top-level folder, from a static map (no code was run). Tests, fixtures and vendored or built folders are left out. Click an area for its files and definitions. Arrows are imports declared in source, not observed calls; record a run with mind-meld to see what actually executes.',
    lanes: [{ id: 'areas', name: 'Areas' }],
    nodes: Object.fromEntries([...areas].map(([area, modules]) => [area, {
      lane: 'areas', name: area, link: pages.get(area),
      role: `${modules.length} module${modules.length === 1 ? '' : 's'} (${languages(modules)})`,
    }])),
    flows: steps.length ? [{ id: 'imports', name: IMPORTS, steps }] : [],
    ask: { context: 'The reader wants an overview of how this repo is organized, from a static map (no code was run).' },
  };
}

// Writes the repo map and one page per area into outDir; returns the file names written.
export async function writeMap(root: string, outDir: string): Promise<string[]> {
  const facts = await scanRepo(root);
  if (!facts.length) throw new Error('mind-meld map: no source files in a supported language (add an adapter in .mind-meld/languages)');
  const areas = new Map<string, ModuleFacts[]>();
  for (const m of facts) areas.set(areaOf(m.file), [...(areas.get(areaOf(m.file)) ?? []), m]);
  const options: MapOptions = { sourcePrefix: `${relative(outDir, root) || '.'}/` };
  const pageOf = pageNames([...areas.keys()]);
  const map = mapSpec(areas, pageOf);
  const titles = Object.fromEntries([...pageOf].map(([area, page]) => [page, area]));
  const context: PageContext = { titles, up: { title: MAP_TITLE, link: MAP_FILE } };
  const pages: [string, ExplorerSpec, PageContext][] = [
    [MAP_FILE, map, { titles }],
    ...[...areas].map(([area, modules]): [string, ExplorerSpec, PageContext] => [pageOf.get(area)!, areaSpec(area, modules, options), context]),
  ];
  mkdirSync(outDir, { recursive: true });
  for (const [file, spec, pageContext] of pages) {
    const problems = validateSpec(spec);
    if (problems.length) throw new Error(`mind-meld map: ${file}: ${problems.join('; ')}`);
    writeFileSync(join(outDir, file), renderMarkdown(spec, pageContext));
  }
  return pages.map(([file]) => file);
}
