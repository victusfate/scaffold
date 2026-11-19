// explorer-markdown — render an explorer spec as one GitHub markdown page that starts high level and
// drills down: overview diagram → one section per component → folded detailed diagram → glossary →
// a copyable "Ask your LLM" block.
// Why: GitHub strips scripts from READMEs and wikis, so the interactive explorer page cannot run there.
// Markdown pages linked from the README give the same drill-down with no hosting, and GitHub's copy
// button on code blocks hands the context to the reader's own LLM. Nothing here calls a model.
// Deterministic: the same spec renders the same page.

import type { Bullet, DeepSection, ExplorerNode, ExplorerSpec } from './explorer-spec.ts';

// GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens.
export const githubAnchor = (heading: string): string =>
  heading.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');

const mermaidId = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, '_');
// Quoted mermaid labels: `#quot;` is mermaid's entity for a double quote inside one.
const mermaidLabel = (text: string): string => `"${text.replace(/"/g, '#quot;').replace(/\s+/g, ' ')}"`;
const box = (spec: ExplorerSpec, id: string): string => `${mermaidId(id)}[${mermaidLabel(spec.nodes[id].name)}]`;

// Every flow's hops, once each, in the order they first appear. Without flows, nodes chain in lane order.
function overviewEdges(spec: ExplorerSpec): [string, string][] {
  const ordered = spec.lanes.flatMap(lane => Object.keys(spec.nodes).filter(id => spec.nodes[id].lane === lane.id));
  if (!spec.flows?.length) return ordered.slice(1).map((id, i) => [ordered[i], id]);
  const seen = new Set<string>();
  return spec.flows.flatMap(f => f.steps.map(([from, to]): [string, string] => [from, to]))
    .filter(([from, to]) => !seen.has(`${from}>${to}`) && seen.add(`${from}>${to}`));
}

// A skill page is one chain of labelled boxes. A map (some nodes on no flow) groups every node in
// lane subgraphs so none is left out, then draws the flows between them.
function overview(spec: ExplorerSpec): string[] {
  const edges = overviewEdges(spec);
  const onEdge = new Set(edges.flat());
  const isMap = Object.keys(spec.nodes).some(id => !onEdge.has(id));
  const lines = isMap
    ? [...spec.lanes.flatMap(lane => [`  subgraph ${mermaidId(lane.id)}[${mermaidLabel(lane.name)}]`,
      ...Object.keys(spec.nodes).filter(id => spec.nodes[id].lane === lane.id).map(id => `    ${box(spec, id)}`), '  end']),
      ...edges.map(([from, to]) => `  ${mermaidId(from)} --> ${mermaidId(to)}`)]
    : edges.map(([from, to]) => `  ${box(spec, from)} --> ${box(spec, to)}`);
  return ['```mermaid', 'flowchart LR', ...lines, '```'];
}

function bullets(items: (string | string[])[] | Bullet[], depth = 0): string[] {
  const pad = '  '.repeat(depth);
  return items.flatMap((item): string[] => {
    if (Array.isArray(item)) return bullets(item, depth + 1);
    if (typeof item === 'string') return [`${pad}- ${item}`];
    return [`${pad}- ${item.t}`, ...bullets(item.more, depth + 1), ...(item.code ? ['', '```', item.code, '```'] : [])];
  });
}

function deepSection(section: DeepSection): string[] {
  const table = section.table
    ? [`| ${section.table.head.join(' | ')} |`, `|${section.table.head.map(() => '---').join('|')}|`,
      ...section.table.rows.map(row => `| ${row.join(' | ')} |`)]
    : [];
  return [`**${section.h}**`, '', ...(section.list ? bullets(section.list) : []), ...table, ''];
}

// Navigation the page can't know on its own: the page above it, and the titles of pages it links to.
export interface PageContext { up?: { title: string; link: string }; titles?: Record<string, string>; }

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

function askBlock(spec: ExplorerSpec): string[] {
  const nodes = Object.values(spec.nodes);
  const questions = nodes.flatMap(n => n.qs ?? []);
  const context = [
    ...(spec.ask?.context ? [spec.ask.context, ''] : []),
    `${spec.title}${spec.lede ? `: ${spec.lede}` : ''}`,
    ...nodes.map(n => `- ${n.name}: ${n.role}`),
    ...(questions.length ? ['', 'Questions worth asking:', ...questions.map(q => `- ${q}`)] : []),
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
    ...nodes.map(n => `- [${n.name}](${hasSection(n) ? `#${githubAnchor(n.name)}` : n.link}): ${n.role}`), '',
    ...nodes.filter(hasSection).flatMap(node => nodeSection(node, context.titles ?? {})),
    ...(spec.detail ? ['<details>', '<summary>Detailed flow</summary>', '',
      `![${spec.title}, detailed](${spec.detail})`, '', '</details>', ''] : []),
    ...(glossary.length ? ['## Glossary', '', ...glossary.map(g => `- **${g.t}**: ${g.d}`), ''] : []),
    ...askBlock(spec),
  ].join('\n') + '\n';
}
