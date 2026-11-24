// explorer-atlas — tie a diagram page to the repo: each claim to the line of source it rests on, each
// stage to the code that carries it out, and each code excerpt to the helpers it calls.
// Why: a page that only paraphrases a skill can drift from it unnoticed. The verdicts and explanations
// in `explorer/<slug>.atlas.json` are written by an agent (they are judgments); everything this file
// does with them is mechanical. A quote is found in its file and given a line number. An excerpt is
// found by an anchor line and must still hash to what was explained. A helper's definition must still
// hash to what was explained. Anything that no longer matches is a problem, so `npm test` fails until
// the explanation is re-read (render-explorer-pages --ack records the new hashes).
// Nothing here calls a model. The same data and the same repo give the same result.

import { sourceHash } from './render-diagrams.ts';
import { definitionsIn, importedFiles, type DefinitionBlock } from './explorer-atlas-defs.ts';

export const VERDICTS = ['confirmed', 'partial', 'unsupported', 'contradicted'] as const;
export type Verdict = typeof VERDICTS[number];
const REF_KINDS = ['implements', 'enforces', 'tests'] as const;

// One claim the page or its diagram makes, judged against the source. `elsewhere` marks a claim that
// holds only in a file the spec's `sources` does not list, so the review hash does not watch it.
export type Check = {
  node: string; origin: 'spec' | 'diagram'; kind: string; claim: string; verdict: Verdict;
  file?: string; quote?: string; note?: string; elsewhere?: boolean;
};
// A rule in the source that neither the page nor the diagram shows.
export type Missing = { what: string; file?: string; quote?: string };
// An excerpt is located by `anchor` (text of one line), which sits `before` lines into a block of
// `count` lines; `hash` is the block as it was when `explain` was written.
export type CodeRef = {
  node: string; file: string; anchor: string; before: number; count: number; hash: string;
  title: string; explain: string; why?: string; kind: typeof REF_KINDS[number];
};
export type AtlasData = {
  summary?: string;
  checks: Check[];
  missing?: Missing[];
  code?: { overview?: string; refs: CodeRef[]; promptOnly?: { node: string; what: string }[] };
};
// Keyed `<file>#<name>`: what a helper does, and the hash of its definition when that was written.
export type HelperNotes = Record<string, { explain: string; hash: string }>;

export type Located = { line?: number };
type Helper = DefinitionBlock & { file: string };
export type ResolvedHelper = Helper & { explain?: string };
// Where an excerpt sits in its file now.
type Placed = { file: string; from: number; to: number; lines: string[] };
export type ResolvedRef = CodeRef & Placed & { helpers: ResolvedHelper[] };
export type ResolvedAtlas = {
  summary: string;
  checks: (Check & Located)[];
  missing: (Missing & Located)[];
  overview: string;
  refs: ResolvedRef[];
  promptOnly: { node: string; what: string }[];
};

// Reads a repo-relative file, or undefined when it does not exist.
export type ReadFile = (path: string) => string | undefined;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

// The 1-based line a quote sits on. A quote may cross a hard line wrap or a blank line, so when no single
// line holds it, whitespace is collapsed and the line holding its first character is returned.
export function locateQuote(text: string, quote: string): number | undefined {
  const lines = text.split('\n');
  const direct = lines.findIndex(line => line.includes(quote));
  if (direct >= 0) return direct + 1;
  const starts: number[] = [];
  let flat = '';
  for (const line of lines) {
    starts.push(flat.length);
    if (line.trim()) flat += `${collapse(line)} `;
  }
  const at = flat.indexOf(collapse(quote));
  return at < 0 ? undefined : starts.findLastIndex(start => start <= at) + 1;
}

export const blockHash = (lines: string[]): string => sourceHash(lines.join('\n'));

// The block around each line that holds the anchor, in file order.
function candidateBlocks(text: string, ref: CodeRef): Placed[] {
  const lines = text.split('\n');
  return lines.flatMap((line, i) => {
    if (!line.includes(ref.anchor) || i < ref.before) return [];
    const block = lines.slice(i - ref.before, i - ref.before + ref.count);
    return [{ file: ref.file, from: i - ref.before + 1, to: i - ref.before + block.length, lines: block }];
  });
}

// Where the excerpt is now: the block around an anchor line that still hashes to what was explained.
// Line numbers may move freely; the text may not.
export function locateBlock(text: string, ref: CodeRef): Placed | undefined {
  return candidateBlocks(text, ref).find(block => blockHash(block.lines) === ref.hash);
}

const WORD = /[A-Za-z_$][\w$]*/g;
// quality-ok: magic-number — enough helpers to explain an excerpt without burying it
const MAX_HELPERS = 12;
const helperKey = (helper: Helper): string => `${helper.file}#${helper.name}`;

// The helpers an excerpt calls: names it uses that are defined at the top level of its own file (outside
// the excerpt) or of a file it imports. The first definition of a name wins, own file first. A name is
// matched as a word, so one that appears only in a comment or a string counts too.
export function helpersOf(placed: Placed, read: ReadFile): Helper[] {
  const own = read(placed.file);
  if (own === undefined) return [];
  const words = new Set(placed.lines.join('\n').match(WORD) ?? []);
  const inExcerpt = (file: string, def: DefinitionBlock): boolean => file === placed.file && def.line >= placed.from && def.line <= placed.to;
  const found = new Map<string, Helper>();
  for (const file of [placed.file, ...importedFiles(placed.file, own, read)]) {
    const used = definitionsIn(file, read(file) ?? '').filter(def => words.has(def.name) && !inExcerpt(file, def));
    for (const def of used) if (!found.has(def.name)) found.set(def.name, { ...def, file });
  }
  return [...found.values()].slice(0, MAX_HELPERS);
}

// quality-ok: magic-number — enough of a quote to recognize it in a one-line problem message
const QUOTE_PREVIEW = 60;
const short = (text: string): string => text.length > QUOTE_PREVIEW ? `${text.slice(0, QUOTE_PREVIEW)}…` : text;
// quality-ok: magic-number — a shorter anchor matches lines all over a file
const MIN_ANCHOR = 8;

const isText = (value: unknown): boolean => typeof value === 'string' && value.length > 0;

function checkShape(check: Check): string | undefined {
  if (!isText(check?.claim) || !isText(check.node)) return 'every check needs a node and a claim';
  if (!VERDICTS.includes(check.verdict)) return `unknown verdict "${String(check.verdict)}"`;
  const needsQuote = check.verdict !== 'unsupported' && !(check.file && check.quote);
  return needsQuote ? `a ${check.verdict} claim needs a file and a quote: "${short(check.claim)}"` : undefined;
}

function refShape(ref: CodeRef): string | undefined {
  if (![ref?.node, ref?.file, ref?.title, ref?.anchor].every(isText)) return 'every code excerpt needs a node, a file, a title and an anchor';
  if (!REF_KINDS.includes(ref.kind)) return `unknown kind "${String(ref.kind)}" for "${ref.title}"`;
  const placed = ref.anchor.trim().length >= MIN_ANCHOR && ref.before >= 0 && ref.count > ref.before;
  return placed ? undefined : `"${ref.title}" needs an anchor of ${MIN_ANCHOR}+ characters that sits inside its block`;
}

const isList = (value: unknown): boolean => value === undefined || Array.isArray(value);

// What is wrong with the file itself, before anything is looked up in the repo.
function validateAtlas(slug: string, data: AtlasData, nodeIds: string[]): string[] {
  if (!Array.isArray(data?.checks)) return [`${slug}: atlas needs a checks array`];
  if (![data.missing, data.code?.refs, data.code?.promptOnly].every(isList)) return [`${slug}: missing, code.refs and code.promptOnly must be lists`];
  const refs = data.code?.refs ?? [];
  const named = [...data.checks, ...refs, ...(data.code?.promptOnly ?? [])].map(item => item?.node).filter(isText);
  const unknown = [...new Set(named.filter(id => !nodeIds.includes(id)))].map(id => `atlas names unknown stage "${id}"`);
  return [...unknown, ...data.checks.flatMap(check => checkShape(check) ?? []), ...refs.flatMap(ref => refShape(ref) ?? [])]
    .map(problem => `${slug}: ${problem}`);
}

function locateCited<T extends { file?: string; quote?: string }>(slug: string, item: T, read: ReadFile, problems: string[]): T & Located {
  if (!item.file || !item.quote) return item;
  const text = read(item.file);
  const line = text === undefined ? undefined : locateQuote(text, item.quote);
  if (line === undefined) problems.push(`${slug}: quote no longer in ${item.file}: "${short(item.quote)}": re-check the claim in explorer/${slug}.atlas.json`);
  return { ...item, line };
}

function resolveHelper(slug: string, helper: Helper, notes: HelperNotes, problems: string[]): ResolvedHelper {
  const key = helperKey(helper), note = notes[key];
  if (note && note.hash !== helper.hash) {
    problems.push(`${slug}: helper ${key} changed: check its explanation in explorer/helpers.atlas.json, then run npm run diagrams:ack -- ${slug}`);
  }
  return { ...helper, explain: note?.explain };
}

function resolveRef(slug: string, ref: CodeRef, env: { read: ReadFile; notes: HelperNotes }, problems: string[]): ResolvedRef | undefined {
  const placed = locateBlock(env.read(ref.file) ?? '', ref);
  if (!placed) {
    problems.push(`${slug}: the code cited from ${ref.file} ("${ref.title}") changed: check its explanation in explorer/${slug}.atlas.json, then run npm run diagrams:ack -- ${slug}`);
    return undefined;
  }
  return { ...ref, ...placed, helpers: helpersOf(placed, env.read).map(helper => resolveHelper(slug, helper, env.notes, problems)) };
}

// Places every quote and excerpt in the repo as it is now. `problems` lists whatever no longer matches;
// a file that is itself malformed resolves to no atlas at all, so a page never shows empty counts for it.
export function resolveAtlas(slug: string, data: AtlasData, env: { read: ReadFile; notes: HelperNotes; nodeIds: string[] }): { atlas?: ResolvedAtlas; problems: string[] } {
  const problems = validateAtlas(slug, data, env.nodeIds);
  if (problems.length) return { problems };
  const atlas: ResolvedAtlas = {
    summary: data.summary ?? '',
    checks: data.checks.map(check => locateCited(slug, check, env.read, problems)),
    missing: (data.missing ?? []).map(item => locateCited(slug, item, env.read, problems)),
    overview: data.code?.overview ?? '',
    refs: (data.code?.refs ?? []).flatMap(ref => resolveRef(slug, ref, env, problems) ?? []),
    promptOnly: data.code?.promptOnly ?? [],
  };
  return { atlas, problems };
}

// The block an excerpt points at once it has been re-read: the one that still matches, else the only
// block its anchor finds. An anchor that finds none, or several that all differ, cannot be placed.
function acknowledgedBlock(text: string, ref: CodeRef): Placed | undefined {
  const candidates = candidateBlocks(text, ref);
  return locateBlock(text, ref) ?? (candidates.length === 1 ? candidates[0] : undefined);
}

// Records the current hash of every excerpt and of every explained helper those excerpts call. Run after
// re-reading the explanations. `lost` lists the excerpts whose anchor no longer finds exactly one block:
// those need a new anchor written by hand, and nothing should be saved until they have one.
export function ackAtlas(data: AtlasData, notes: HelperNotes, read: ReadFile): { data: AtlasData; notes: HelperNotes; lost: string[] } {
  const lost: string[] = [], nextNotes = { ...notes };
  const refs = (data.code?.refs ?? []).map(ref => {
    const placed = acknowledgedBlock(read(ref.file) ?? '', ref);
    if (!placed) { lost.push(`${ref.file} ("${ref.title}")`); return ref; }
    for (const helper of helpersOf(placed, read)) {
      const key = helperKey(helper);
      if (nextNotes[key]) nextNotes[key] = { ...nextNotes[key], hash: helper.hash };
    }
    return { ...ref, hash: blockHash(placed.lines) };
  });
  return { data: data.code ? { ...data, code: { ...data.code, refs } } : data, notes: nextNotes, lost };
}
