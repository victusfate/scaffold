#!/usr/bin/env node
/**
 * dispatch-orientation.ts — how long a dispatched subagent spends orienting before its first edit.
 *
 * A cold subagent loses most of its wall-clock time to sequential exploration (grep, read, grep, read) before it
 * changes anything. This reads Claude Code subagent transcripts (`<project>/<session>/subagents/agent-*.jsonl`) and
 * reports, per agent, the tool calls and seconds from its first prompt to its first edit, plus whether its brief
 * carried a "Start here" block (docs/agents-detail.md#dispatch-briefs). Compare the two cohorts to see whether the
 * block pays off before automating it.
 *
 * "First edit" = an Edit / Write / NotebookEdit / MultiEdit call, or a Bash call that writes into the workspace
 * (sed -i, perl -pi, git commit/apply/cherry-pick/rm/mv, a Python open(..., 'w'), or a > / >> redirect to a path
 * outside /tmp, /dev and the scratch roots). Setup such as `git fetch` / `git merge origin/main` is not an edit.
 *
 * Usage: node scripts/dispatch-orientation.ts [--since YYYY-MM-DD] [--json] <transcript-dir-or-file>...
 * Default input: every subagents/ directory under ~/.claude/projects/<cwd-derived project dir>.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const BASH_WRITE_PATTERNS: RegExp[] = [
  /\bsed\s+(-[a-zA-Z]*\s+)*-i/,
  /\bperl\s+-[a-zA-Z]*p[a-zA-Z]*i/,
  /\bgit\s+(-C\s+\S+\s+)?(-c\s+\S+\s+)*(commit|apply|cherry-pick|rm|mv)\b/,
  /\bopen\([^)]*,\s*['"][wa]['"]/,
  /\.write_text\(/,
];
/** A > or >> redirect whose target is not a throwaway location. */
const REDIRECT = /(^|[^0-9&>])>>?\s*("?)([^\s"|&;]+)\2/g;
const THROWAWAY_TARGET = /^(\/tmp\/|\/dev\/|\$\{?T(MP|MPDIR)?\b|~\/scratch\/|\$HOME\/scratch\/|\/home\/[^/]+\/scratch\/|&)/;
const LOOKS_LIKE_PATH = /[/.]/;
/** The shell text a redirect can live in: heredoc bodies (often Python, where `a > b` is a comparison) and
 *  arithmetic expansions are removed first. */
function shellOnly(command: string): string {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, '\n')
    .replace(/\$\(\([^)]*\)\)/g, '');
}
const START_HERE = /^#{1,4}\s*start here\b|^\*\*start here\*\*|^start here:/im;

export interface AgentOrientation {
  id: string;
  description: string;
  startHere: boolean;
  toolsBeforeEdit: number | null;
  secondsToFirstEdit: number | null;
  totalTools: number;
  startedAt: string;
}

interface ContentBlock { type?: string; name?: string; input?: Record<string, unknown>; text?: string }
interface TranscriptLine { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } }

export function bashWrites(command: string): boolean {
  if (BASH_WRITE_PATTERNS.some((re) => re.test(command))) return true;
  for (const m of shellOnly(command).matchAll(REDIRECT)) {
    const target = m[3];
    if (LOOKS_LIKE_PATH.test(target) && !THROWAWAY_TARGET.test(target)) return true;
  }
  return false;
}

export function isEdit(block: ContentBlock): boolean {
  if (!block.name) return false;
  if (EDIT_TOOLS.has(block.name)) return true;
  return block.name === 'Bash' && typeof block.input?.command === 'string' && bashWrites(block.input.command);
}

function promptText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c: ContentBlock) => (c.type === 'text' && c.text) || '').join('\n');
}

interface Walk { start: number | null; startedAt: string; prompt: string; tools: number; toolsBeforeEdit: number | null; secondsToFirstEdit: number | null }

function stamp(line: TranscriptLine): number {
  return line.timestamp ? Date.parse(line.timestamp) : NaN;
}

function noteFirstPrompt(w: Walk, line: TranscriptLine): void {
  const ts = stamp(line);
  if (line.type !== 'user' || w.start !== null || Number.isNaN(ts)) return;
  w.start = ts;
  w.startedAt = line.timestamp ?? '';
  w.prompt = promptText(line.message?.content);
}

function toolUses(line: TranscriptLine): ContentBlock[] {
  if (line.type !== 'assistant' || !Array.isArray(line.message?.content)) return [];
  return (line.message.content as ContentBlock[]).filter((b) => b.type === 'tool_use');
}

function noteTool(w: Walk, block: ContentBlock, ts: number): void {
  if (w.toolsBeforeEdit === null && isEdit(block)) {
    w.toolsBeforeEdit = w.tools;
    if (w.start !== null && !Number.isNaN(ts)) w.secondsToFirstEdit = Math.round((ts - w.start) / 1000);
  }
  w.tools++;
}

/** Orientation for one transcript's lines. A brief referenced by path is read too, so file-based briefs count. */
export function analyse(id: string, lines: TranscriptLine[], description = '', readBrief = readBriefFile): AgentOrientation {
  const w: Walk = { start: null, startedAt: '', prompt: '', tools: 0, toolsBeforeEdit: null, secondsToFirstEdit: null };
  for (const line of lines) {
    noteFirstPrompt(w, line);
    for (const block of toolUses(line)) noteTool(w, block, stamp(line));
  }
  const brief = w.prompt + '\n' + readBrief(w.prompt);
  return { id, description, startHere: START_HERE.test(brief), toolsBeforeEdit: w.toolsBeforeEdit,
    secondsToFirstEdit: w.secondsToFirstEdit, totalTools: w.tools, startedAt: w.startedAt };
}

/** Briefs are often a file the prompt points at ("Your brief is the file /…/x.md"); include its text. */
function readBriefFile(prompt: string): string {
  const m = prompt.match(/(\/[^\s'"`]+\.md)\b/);
  if (!m || !existsSync(m[1])) return '';
  try { return readFileSync(m[1], 'utf8'); } catch { return ''; }
}

function transcriptFiles(inputs: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string): void => {
    const st = statSync(p);
    if (st.isFile()) { if (/agent-[^/]+\.jsonl$/.test(p)) out.push(p); return; }
    for (const name of readdirSync(p)) walk(join(p, name));
  };
  for (const p of inputs) if (existsSync(p)) walk(p);
  return out;
}

function parse(file: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    try { lines.push(JSON.parse(raw) as TranscriptLine); } catch { /* a partially written last line */ }
  }
  return lines;
}

function description(file: string): string {
  const meta = file.replace(/\.jsonl$/, '.meta.json');
  if (!existsSync(meta)) return '';
  try {
    const d = (JSON.parse(readFileSync(meta, 'utf8')) as { description?: unknown }).description;
    return typeof d === 'string' ? d : '';
  } catch { return ''; }
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function summarise(rows: AgentOrientation[]): Record<string, { agents: number; edited: number; medianToolsBeforeEdit: number | null; medianSecondsToFirstEdit: number | null }> {
  const out: ReturnType<typeof summarise> = {};
  for (const [label, cohort] of [['start-here', rows.filter((r) => r.startHere)], ['cold', rows.filter((r) => !r.startHere)]] as const) {
    const edited = cohort.filter((r) => r.toolsBeforeEdit !== null);
    out[label] = {
      agents: cohort.length,
      edited: edited.length,
      medianToolsBeforeEdit: median(edited.map((r) => r.toolsBeforeEdit as number)),
      medianSecondsToFirstEdit: median(edited.flatMap((r) => (r.secondsToFirstEdit === null ? [] : [r.secondsToFirstEdit]))),
    };
  }
  return out;
}

interface Args { since: string; json: boolean; inputs: string[] }

function parseArgs(argv: string[]): Args {
  const args: Args = { since: '', json: false, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since') args.since = argv[++i] ?? '';
    else if (argv[i] === '--json') args.json = true;
    else args.inputs.push(argv[i]);
  }
  if (!args.inputs.length) args.inputs.push(join(homedir(), '.claude', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-')));
  return args;
}

function printRows(rows: AgentOrientation[]): void {
  for (const r of rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    console.log([r.startedAt.slice(0, 16), r.startHere ? 'START' : 'cold ', String(r.toolsBeforeEdit ?? '-').padStart(4),
      String(r.secondsToFirstEdit ?? '-').padStart(6) + 's', String(r.totalTools).padStart(5), r.description.slice(0, 60)].join('  '));
  }
}

function printSummary(summary: ReturnType<typeof summarise>): void {
  console.log('cohort      agents edited  median-tools-before-edit  median-seconds-to-first-edit');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`${k.padEnd(11)} ${String(v.agents).padStart(6)} ${String(v.edited).padStart(6)}  ${String(v.medianToolsBeforeEdit ?? '-').padStart(24)}  ${String(v.medianSecondsToFirstEdit ?? '-').padStart(28)}`);
  }
}

function main(argv: string[]): void {
  const { since, json, inputs } = parseArgs(argv);
  const rows = transcriptFiles(inputs)
    .map((f) => analyse(basename(f, '.jsonl'), parse(f), description(f)))
    .filter((r) => r.totalTools > 0 && (!since || r.startedAt >= since));
  const summary = summarise(rows);
  if (json) { console.log(JSON.stringify({ summary, agents: rows }, null, 1)); return; }
  printRows(rows);
  printSummary(summary);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
