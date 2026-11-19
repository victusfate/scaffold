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

// The overview follows the first flow; without one, the nodes chain in lane order.
function overviewEdges(spec: ExplorerSpec): [string, string][] {
  const flow = spec.flows?.[0];
  if (flow) return flow.steps.map(([from, to]) => [from, to]);
  const ordered = spec.lanes.flatMap(lane => Object.keys(spec.nodes).filter(id => spec.nodes[id].lane === lane.id));
  return ordered.slice(1).map((id, i) => [ordered[i], id]);
}

function overview(spec: ExplorerSpec): string[] {
  const edges = overviewEdges(spec);
  const lines = edges.length
    ? edges.map(([from, to]) => `  ${box(spec, from)} --> ${box(spec, to)}`)
    : Object.keys(spec.nodes).map(id => `  ${box(spec, id)}`);
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

function nodeSection(node: ExplorerNode): string[] {
  return [
    `## ${node.name}`, '', node.role, '',
    ...(node.link ? [`Goes deeper: [${node.link}](${node.link})`, ''] : []),
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

export function renderMarkdown(spec: ExplorerSpec): string {
  const nodes = Object.values(spec.nodes);
  const glossary = Object.values(spec.glossary ?? {});
  return [
    `# ${spec.title}`, '',
    ...(spec.lede ? [spec.lede, ''] : []),
    ...overview(spec), '',
    ...nodes.map(n => `- [${n.name}](#${githubAnchor(n.name)}): ${n.role}`), '',
    ...nodes.flatMap(nodeSection),
    ...(spec.detail ? ['<details>', '<summary>Detailed flow</summary>', '',
      `![${spec.title}, detailed](${spec.detail})`, '', '</details>', ''] : []),
    ...(glossary.length ? ['## Glossary', '', ...glossary.map(g => `- **${g.t}**: ${g.d}`), ''] : []),
    ...askBlock(spec),
  ].join('\n') + '\n';
}
