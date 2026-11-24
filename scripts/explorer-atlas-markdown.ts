// explorer-atlas-markdown — render a resolved atlas as the sections a diagram page carries after its
// stages: the code behind each stage, then each claim checked against its source.
// Why: GitHub renders markdown directly, gives every fenced block a copy button, and folds `<details>`,
// so the page needs no hosting and no script to let a reader copy an excerpt or open a helper.
// Deterministic: the same atlas renders the same sections.

import { extname } from 'node:path';
import { VERDICTS, type Check, type Located, type Missing, type ResolvedAtlas, type ResolvedHelper, type ResolvedRef, type Verdict } from './explorer-atlas.ts';
import { cell, longerThanBackticks } from './explorer-markdown.ts';
import { escHtml } from './explorer-render.ts';

export type AtlasContext = {
  // Where a `file#Lx` link points: `<repo>/blob/<branch>`.
  blob: string;
  nodes: { id: string; name: string }[];
};

// The headings these sections add to a page, for the page's own duplicate-anchor check.
export const ATLAS_HEADINGS = { scoreboard: 'Scaffold Flow Atlas', code: 'Code walkthrough', checks: 'Checked against the source', missing: 'In the source, not shown in the flow' };

const LABEL: Record<Verdict, string> = { confirmed: 'Confirmed', partial: 'Partly', unsupported: 'Not found', contradicted: 'Contradicted' };
const KIND: Record<ResolvedRef['kind'], string> = { implements: 'Carries out the step.', enforces: 'Enforces the rule.', tests: 'Test that pins it.' };
const LANGUAGE: Record<string, string> = { '.ts': 'ts', '.mjs': 'js', '.js': 'js', '.sh': 'bash', '.yml': 'yaml', '.yaml': 'yaml', '.json': 'json', '.md': 'markdown' };
// A file with no extension here is a shell tool (`bin/sync`, `.githooks/pre-commit`).
const NO_EXTENSION = 'bash';
const COUNT_COLUMNS = [...VERDICTS.map(verdict => LABEL[verdict]), ATLAS_HEADINGS.missing, 'Code excerpts'];

// Prose keeps its own `code spans`; outside them, text GitHub would read as an HTML tag is escaped. A lone
// backtick opens no span, so then all of it is escaped.
function prose(text: string): string {
  const parts = text.split('`');
  return parts.length % 2 ? parts.map((part, i) => i % 2 ? part : escHtml(part)).join('`') : escHtml(text);
}
// A quote is shown character for character, so every markdown character in it is escaped, and so is a
// leading list marker.
const verbatim = (text: string): string => escHtml(text).replace(/([\\`*_[\]|~#])/g, '\\$1').replace(/^(\s*)([-+]|\d+[.)])(?=\s)/, '$1\\$2');

function fence(file: string, lines: string[]): string[] {
  const ticks = longerThanBackticks(lines.join('\n'), 3), ext = extname(file);
  return [`${ticks}${ext ? LANGUAGE[ext] ?? '' : NO_EXTENSION}`, ...lines, ticks];
}

const lineLink = (context: AtlasContext, file: string, from: number, to = from): string =>
  `[\`${file}:${from}${to > from ? `-${to}` : ''}\`](${context.blob}/${file}#L${from}${to > from ? `-L${to}` : ''})`;

function cited(context: AtlasContext, item: { file?: string; quote?: string } & Located): string[] {
  if (!item.file || !item.quote) return [];
  const where = item.line ? lineLink(context, item.file, item.line) : `\`${item.file}\` (quote not located)`;
  return [`  > ${verbatim(item.quote)}`, '  >', `  > ${where}`];
}

function checkLines(context: AtlasContext, check: Check & Located): string[] {
  const tags = `${check.elsewhere ? ' (outside tracked sources)' : ''}${check.origin === 'diagram' ? ' (from the diagram)' : ''}`;
  return [`- **${LABEL[check.verdict]}**${tags}: ${prose(check.claim)}`, ...cited(context, check),
    ...(check.note ? ['', `  ${prose(check.note)}`] : []), ''];
}

function helperLines(context: AtlasContext, helper: ResolvedHelper): string[] {
  return ['<details>', `<summary><code>${escHtml(helper.name)}</code> · ${helper.kind} · ${helper.file}:${helper.line}</summary>`, '',
    ...(helper.explain ? [prose(helper.explain), ''] : []),
    ...(helper.doc ? [`Comment in the source: ${prose(helper.doc)}`, ''] : []),
    ...fence(helper.file, helper.lines), '',
    `${lineLink(context, helper.file, helper.line, helper.to)}${helper.truncated ? ` (first ${helper.lines.length} lines shown)` : ''}`, '', '</details>', ''];
}

function refLines(context: AtlasContext, ref: ResolvedRef): string[] {
  return [`#### ${prose(ref.title)}`, '', `*${KIND[ref.kind]}* ${prose(ref.explain)}`, '', ...fence(ref.file, ref.lines), '',
    lineLink(context, ref.file, ref.from, ref.to), '',
    ...(ref.why ? [`**Why it matters.** ${prose(ref.why)}`, ''] : []),
    ...(ref.helpers.length ? ['**Methods and helpers used here**', '', ...ref.helpers.flatMap(helper => helperLines(context, helper))] : [])];
}

function stageCode(context: AtlasContext, atlas: ResolvedAtlas, node: { id: string; name: string }): string[] {
  const refs = atlas.refs.filter(ref => ref.node === node.id), prompts = atlas.promptOnly.filter(item => item.node === node.id);
  const none = refs.length || prompts.length ? [] : ['No code was found for this stage; the agent carries it out from the skill text.', ''];
  return [`### ${node.name}: code`, '', ...refs.flatMap(ref => refLines(context, ref)),
    ...prompts.flatMap(item => [`No code here: ${prose(item.what)}`, '']), ...none];
}

// A claim needs attention when it is not fully confirmed, or holds only in a file the page does not track.
const needsAttention = (check: Check): boolean => check.verdict !== 'confirmed' || Boolean(check.elsewhere);

function stageChecks(context: AtlasContext, atlas: ResolvedAtlas, node: { id: string; name: string }): string[] {
  const mine = atlas.checks.filter(check => check.node === node.id);
  if (!mine.length) return [];
  const open = mine.filter(needsAttention), settled = mine.filter(check => !needsAttention(check));
  const folded = settled.length
    ? ['<details>', `<summary>${settled.length} confirmed, with the supporting line</summary>`, '', ...settled.flatMap(check => checkLines(context, check)), '</details>', '']
    : [];
  return [`### ${node.name}: checks`, '', ...open.flatMap(check => checkLines(context, check)), ...folded];
}

// One number per COUNT_COLUMNS entry.
const counts = (atlas: ResolvedAtlas): number[] =>
  [...VERDICTS.map(verdict => atlas.checks.filter(check => check.verdict === verdict).length), atlas.missing.length, atlas.refs.length];
const countHeader = (first: string[]): string[] =>
  [`| ${[...first, ...COUNT_COLUMNS].join(' | ')} |`, `|${[...first.map(() => '---'), ...COUNT_COLUMNS.map(() => '---:')].join('|')}|`];

function missingLines(context: AtlasContext, missing: (Missing & Located)[]): string[] {
  if (!missing.length) return [];
  return [`## ${ATLAS_HEADINGS.missing}`, '', ...missing.flatMap(item => [`- ${prose(item.what)}`, ...cited(context, item), ''])];
}

// The landing section on the map page: every page that has an atlas, with its counts and a total.
export function renderScoreboard(rows: { title: string; link: string; atlas: ResolvedAtlas }[]): string[] {
  if (!rows.length) return [];
  const each = rows.map(row => counts(row.atlas));
  const total = COUNT_COLUMNS.map((_, column) => each.reduce((sum, row) => sum + row[column], 0));
  return [`## ${ATLAS_HEADINGS.scoreboard}`, '',
    `${rows.length} diagram${rows.length === 1 ? '' : 's'}, checked against their source docs. Each page below shows its stages, the code that carries each stage out with the helpers that code calls, and every claim set beside the line of source it rests on.`, '',
    ...countHeader(['Flow']),
    ...rows.map((row, i) => `| [${cell(row.title)}](${row.link}) | ${each[i].join(' | ')} |`),
    `| **All flows** | ${total.map(n => `**${n}**`).join(' | ')} |`, '',
    'The verdicts and explanations were written by an agent and are judgments. Quotes and code are read from the repo when the pages are built, and `npm test` fails when a quoted line or an explained block of code changes.', ''];
}

// The sections a page gains from its atlas, each ending in a blank line.
export function renderAtlas(atlas: ResolvedAtlas, context: AtlasContext): string[] {
  return [
    `## ${ATLAS_HEADINGS.code}`, '',
    ...(atlas.overview ? [prose(atlas.overview), ''] : []),
    'Each excerpt is read from the repo when this page is built. The explanations were written by an agent; `npm test` fails when the lines they explain change.', '',
    ...context.nodes.flatMap(node => stageCode(context, atlas, node)),
    `## ${ATLAS_HEADINGS.checks}`, '',
    ...(atlas.summary ? [prose(atlas.summary), ''] : []),
    ...countHeader([]), `| ${counts(atlas).join(' | ')} |`, '',
    'An agent judged each claim against the source; each quote is found in its file when this page is built.', '',
    ...context.nodes.flatMap(node => stageChecks(context, atlas, node)),
    ...missingLines(context, atlas.missing),
  ];
}
