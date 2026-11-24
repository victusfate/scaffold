// explorer-markdown — render an explorer spec as one GitHub markdown page that starts high level and
// drills down: overview diagram → one section per component → the full detailed diagram → glossary →
// a copyable "Ask your LLM" block.
// Why: GitHub strips scripts from READMEs and wikis, so the interactive explorer page cannot run there.
// Markdown pages linked from the README give the same drill-down with no hosting, and GitHub's copy
// button on code blocks hands the context to the reader's own LLM. Nothing here calls a model.
// Deterministic: the same spec renders the same page.

import { anchor } from './check-agents-detail.ts';
import { mermaidId, mermaidText } from './explorer-render.ts';
import { uniqueId } from './identifier.ts';
import type { Bullet, DeepSection, ExplorerNode, ExplorerSpec } from './explorer-spec.ts';

// Quoted mermaid labels: `#quot;` is mermaid's entity for a double quote inside one.
const mermaidLabel = (text: string): string => `"${mermaidText(text).replace(/"/g, '#quot;')}"`;
// Mermaid ids per spec: sanitized, then suffixed so ids that sanitize alike (`a.b`, `a_b`) stay two boxes.
function diagramIds(spec: ExplorerSpec): Map<string, string> {
  const ids = new Map<string, string>(), used = new Set<string>();
  for (const key of Object.keys(spec.nodes)) ids.set(key, uniqueId(mermaidId(key), used));
  return ids;
}

// A fence or code-span delimiter longer than any backtick run in the text, so the text is shown as is.
export const longerThanBackticks = (text: string, min: number): string =>
  '`'.repeat(Math.max(min, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
export function codeSpan(text: string): string {
  const tick = longerThanBackticks(text, 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${tick}${pad}${text}${pad}${tick}`;
}
// Lanes get their own prefix so a lane and a node may share an id.
const laneId = (id: string): string => `l_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
// A markdown table cell: `|` would end the cell.
export const cell = (text: string): string => text.replace(/\|/g, '\\|');

// Every flow's hops, once each, in the order they first appear. No flows, no arrows: an arrow is a claim.
function overviewEdges(spec: ExplorerSpec): [string, string][] {
  const hops = (spec.flows ?? []).flatMap(f => f.steps.map(([from, to]): [string, string] => [from, to]));
  return [...new Map(hops.map(hop => [hop.join('>'), hop])).values()];
}

// The palette the detailed diagrams in docs/diagrams/src use (light fill, darker border, dark text), so
// an overview and its detailed flow read as one set. Boxes take their lane's color, in lane order.
const PALETTE = [
  'fill:#bfdbfe,stroke:#1d4ed8', 'fill:#bbf7d0,stroke:#15803d', 'fill:#ddd6fe,stroke:#6d28d9',
  'fill:#fde68a,stroke:#b45309', 'fill:#fecaca,stroke:#b91c1c', 'fill:#e5e7eb,stroke:#374151',
];
const TEXT = 'color:#1f2937';
const MAP_LANE = 'fill:#f9fafb,stroke:#d1d5db,color:#374151';

function laneColors(spec: ExplorerSpec, isMap: boolean, ids: Map<string, string>): string[] {
  const lanes = spec.lanes.map((lane, i) => ({ lane, i, ids: Object.keys(spec.nodes).filter(id => spec.nodes[id].lane === lane.id) }))
    .filter(({ ids }) => ids.length);
  return [
    ...lanes.map(({ i }) => `  classDef lane${i} ${PALETTE[i % PALETTE.length]},${TEXT}`),
    ...lanes.map(({ i, ids: keys }) => `  class ${keys.map(k => ids.get(k)).join(',')} lane${i}`),
    ...(isMap ? lanes.map(({ lane }) => `  style ${laneId(lane.id)} ${MAP_LANE}`) : []),
  ];
}

// A skill page is one chain of labelled boxes. A map (some nodes on no flow) groups every node in
// lane subgraphs so none is left out, then draws the flows between them.
function overview(spec: ExplorerSpec): string[] {
  const edges = overviewEdges(spec);
  const ids = diagramIds(spec);
  const box = (key: string): string => `${ids.get(key)}[${mermaidLabel(spec.nodes[key].name)}]`;
  const onEdge = new Set(edges.flat());
  const isMap = Object.keys(spec.nodes).some(id => !onEdge.has(id));
  const lines = isMap
    ? [...spec.lanes.flatMap(lane => [`  subgraph ${laneId(lane.id)}[${mermaidLabel(lane.name)}]`,
      ...Object.keys(spec.nodes).filter(key => spec.nodes[key].lane === lane.id).map(key => `    ${box(key)}`), '  end']),
      ...edges.map(([from, to]) => `  ${ids.get(from)} --> ${ids.get(to)}`)]
    : edges.map(([from, to]) => `  ${box(from)} --> ${box(to)}`);
  return ['```mermaid', 'flowchart LR', ...lines, ...laneColors(spec, isMap, ids), '```'];
}

function bullets(items: (string | string[])[] | Bullet[], depth = 0): string[] {
  const pad = '  '.repeat(depth);
  return items.flatMap((item): string[] => {
    if (Array.isArray(item)) return bullets(item, depth + 1);
    if (typeof item === 'string') return [`${pad}- ${item}`];
    const fence = item.code ? longerThanBackticks(item.code, 3) : '';
    return [`${pad}- ${item.t}`, ...bullets(item.more, depth + 1), ...(item.code ? ['', fence, item.code, fence] : [])];
  });
}

function deepSection(section: DeepSection): string[] {
  const table = section.table
    ? [`| ${section.table.head.map(cell).join(' | ')} |`, `|${section.table.head.map(() => '---').join('|')}|`,
      ...section.table.rows.map(row => `| ${row.map(cell).join(' | ')} |`)]
    : [];
  return [`**${section.h}**`, '', ...(section.list ? bullets(section.list) : []), ...table, ''];
}

// Navigation the page can't know on its own: the page above it, and the titles of pages it links to.
// `source` puts the repo (under its name) and this page's URL in the LLM block, so an assistant can
// read the real files.
export interface PageContext {
  up?: { title: string; link: string };
  titles?: Record<string, string>;
  source?: { name: string; repo: string; page: string };
  // Ready-made sections placed after the detailed diagram (render-explorer-pages: the page's atlas).
  sections?: string[];
}

const SKILL_FILE = /(?:^|\/)skills\/([^/]+)\.md$/;

// A deeper link reads as where it goes: a page's title, or "/name skill" for a skill file.
function linkLabel(link: string, titles: Record<string, string>): string {
  const skill = SKILL_FILE.exec(link)?.[1];
  return titles[link] ?? (skill ? `/${skill} skill` : link);
}

// A node with nothing beyond its role (a map entry) links straight to its own page: a section holding
// only that sentence and a link would cost the reader an extra click for nothing.
const hasSection = (node: ExplorerNode): boolean =>
  !node.link || Boolean(node.details?.length || node.risks?.length || node.deep?.length || node.qs?.length);

function nodeSection(node: ExplorerNode, titles: Record<string, string>): string[] {
  return [
    `## ${node.name}`, '', node.role, '',
    ...(node.link ? [`Details: [${linkLabel(node.link, titles)}](${node.link})`, ''] : []),
    ...(node.details?.length ? [...bullets(node.details), ''] : []),
    ...(node.risks?.length ? ['**Where it breaks**', '', ...bullets(node.risks), ''] : []),
    ...(node.deep ?? []).flatMap(deepSection),
  ];
}

// The block is read in GitHub's fixed-width code box, so prose wraps at 80 columns on word boundaries;
// a wrapped list item keeps a hanging indent. A single long word (a URL) is never split.
const WRAP = 80;
function wrap(text: string, first = '', rest = first): string[] {
  const lines: string[] = [];
  let line = first;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const prefix = lines.length ? rest : first;
    if (line.length > prefix.length && line.length + 1 + word.length > WRAP) { lines.push(line); line = rest + word; }
    else line += (line.length > prefix.length ? ' ' : '') + word;
  }
  return [...lines, line];
}

// With a page URL the block stays short: a network-capable assistant reads the page itself. Without one
// (an offline copy), the block carries the page summary instead.
function askBlock(spec: ExplorerSpec, source?: PageContext['source']): string[] {
  const nodes = Object.values(spec.nodes);
  const questions = nodes.flatMap(n => n.qs ?? []);
  const where = source
    ? ['Read this page:', source.page, `${source.name}: ${source.repo}`]
    : [...(spec.ask?.context ? [''] : []), ...wrap(`${spec.title}${spec.lede ? `: ${spec.lede}` : ''}`),
      ...nodes.flatMap(n => wrap(`${n.name}: ${n.role}`, '- ', '  '))];
  const context = [
    ...(spec.ask?.context ? wrap(spec.ask.context) : []),
    ...where,
    ...(questions.length ? ['', 'Questions worth asking:', ...questions.flatMap(q => wrap(q, '- ', '  '))] : []),
  ];
  return ['## Ask your LLM', '', 'Copy this block into your own assistant to ask about anything on this page.', '',
    '```text', ...context, '```'];
}

export function renderMarkdown(spec: ExplorerSpec, context: PageContext = {}): string {
  const nodes = Object.values(spec.nodes);
  const glossary = Object.values(spec.glossary ?? {});
  return [
    ...(context.up ? [`[← ${context.up.title}](${context.up.link})`, ''] : []),
    `# ${spec.title}`, '',
    ...(spec.lede ? [spec.lede, ''] : []),
    ...overview(spec), '',
    ...nodes.map(n => `- [${n.name}](${hasSection(n) ? `#${anchor(n.name)}` : n.link}): ${n.role}`), '',
    ...nodes.filter(hasSection).flatMap(node => nodeSection(node, context.titles ?? {})),
    ...(spec.detail ? ['## Detailed flow', '', `![${spec.title}, detailed](${spec.detail})`, ''] : []),
    ...(context.sections ?? []),
    ...(glossary.length ? ['## Glossary', '', ...glossary.map(g => `- **${g.t}**: ${g.d}`), ''] : []),
    ...askBlock(spec, context.source),
  ].join('\n') + '\n';
}
