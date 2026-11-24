// explorer-atlas-defs — find a file's top-level definitions and the repo files it imports, by line pattern.
// Why: an excerpt on a diagram page calls helpers the reader has not seen, and the page shows each one's
// whole definition. scaffold's own code keeps definitions at column 0, so a definition is the lines from
// its name to the next column-0 line: no compiler, no bracket counting, and the same rule for shell.
// (scripts/mind-meld-langs.ts also lists TypeScript definitions, but only exported ones, without an end
// line, and it needs the optional `typescript` package; this page needs every helper and its full text.)
// Only what the source states is reported.

import { dirname, extname, join } from 'node:path';
import { sourceHash } from './render-diagrams.ts';

export type DefinitionBlock = {
  name: string;
  kind: string;        // "function", "const", "type", ... or "shell function"
  line: number;        // 1-based line of the definition
  to: number;          // last line shown
  lines: string[];     // the definition, capped at MAX_SHOWN lines
  truncated: boolean;  // the definition is longer than what is shown
  doc: string;         // the comment directly above it, if any
  hash: string;        // of every line of the definition, shown or not
};

const JS_LIKE = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);
const JS_DEF = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\*?|const|let|type|interface|class|enum)\s+([A-Za-z_$][\w$]*)/;
const SH_DEF = /^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)/;
const SHEBANG_SHELL = /^#!.*\b(?:ba|z|da)?sh\b/;
// A comment line, with its marker stripped: `//`, `#` (not a shebang), or a line of a `/** ... */` block.
const COMMENT = /^\s*(?:\/\/+|#(?!!)|\/\*+|\*\/?)\s?(.*?)\s*(?:\*\/)?$/;
// A decorative rule (`// ── Section ──`) names a region of the file, not the definition under it.
const RULE = /^(?:[─═]{2,}|[=-]{3,})|(?:[─═]{2,}|[=-]{3,})$/;
// A column-0 closing bracket that opens the next part (`): string {`, `}, {`) is not the end.
const CLOSER = /^[})\]]/, OPENS_MORE = /(?:[{([]|=>)\s*$/;
const HEREDOC = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?/;
// quality-ok: magic-number — a name shorter than this matches ordinary words in an excerpt
const MIN_NAME = 3;
// quality-ok: magic-number — lines of a definition shown on the page; the rest is one click away
const MAX_SHOWN = 24;
// quality-ok: magic-number — comment lines read above a definition
const MAX_DOC = 8;

type Language = 'js' | 'shell';
// Which patterns apply: by extension, or a shell shebang on a file with none. Anything else has no definitions.
function languageOf(file: string, text: string): Language | undefined {
  const ext = extname(file);
  if (JS_LIKE.has(ext)) return 'js';
  return ext === '.sh' || (ext === '' && SHEBANG_SHELL.test(text)) ? 'shell' : undefined;
}

// Tells, line by line, whether the text after that line is inside a literal that may hold column-0 text of
// its own: a template literal in a script, a heredoc in shell. Such lines never end a definition.
function literalTracker(language: Language): (line: string) => boolean {
  let open = false, heredocEnd = '';
  const script = (line: string): boolean => {
    if ((line.replace(/\\./g, '').match(/`/g) ?? []).length % 2) open = !open;
    return open;
  };
  const shell = (line: string): boolean => {
    heredocEnd = heredocEnd ? (line.trim() === heredocEnd ? '' : heredocEnd) : HEREDOC.exec(line)?.[1] ?? '';
    return heredocEnd !== '';
  };
  return language === 'js' ? script : shell;
}

// A definition runs to the line before the next column-0 line. A closing bracket at column 0 is its last
// line, unless that line opens the next part.
function definitionEnd(lines: string[], start: number, language: Language): number {
  const insideLiteral = literalTracker(language);
  let last = start, inside = insideLiteral(lines[start]);
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i], wasInside = inside;
    inside = insideLiteral(line);
    const ends = !wasInside && /^\S/.test(line) && !(CLOSER.test(line) && OPENS_MORE.test(line));
    if (ends) return CLOSER.test(line) ? i : last;
    if (line.trim()) last = i;
  }
  return last;
}

function docAbove(lines: string[], start: number): string {
  const doc: string[] = [];
  for (let i = start - 1; i >= 0 && doc.length < MAX_DOC; i--) {
    const comment = COMMENT.exec(lines[i]);
    if (!comment || RULE.test(comment[1])) break;
    if (comment[1]) doc.unshift(comment[1]);
  }
  return doc.join(' ').trim();
}

function named(language: Language, line: string): { name: string; kind: string } | undefined {
  if (language === 'js') {
    const match = JS_DEF.exec(line);
    return match ? { name: match[2], kind: match[1].replace('*', '') } : undefined;
  }
  const match = SH_DEF.exec(line);
  return match ? { name: match[1], kind: 'shell function' } : undefined;
}

// Every top-level definition in a file, first definition of a name only.
export function definitionsIn(file: string, text: string): DefinitionBlock[] {
  const language = languageOf(file, text);
  if (!language) return [];
  const lines = text.split('\n'), seen = new Set<string>(), found: DefinitionBlock[] = [];
  let covered = -1;   // last line of the definition being read: nothing inside it is a definition of its own
  lines.forEach((line, start) => {
    const def = start > covered ? named(language, line) : undefined;
    if (!def) return;
    covered = definitionEnd(lines, start, language);
    if (def.name.length < MIN_NAME || seen.has(def.name)) return;
    seen.add(def.name);
    const whole = lines.slice(start, covered + 1), shown = whole.slice(0, MAX_SHOWN);
    found.push({ ...def, line: start + 1, to: start + shown.length, lines: shown, truncated: whole.length > shown.length,
      doc: docAbove(lines, start), hash: sourceHash(whole.join('\n')) });
  });
  return found;
}

const JS_IMPORT = /from\s+['"](\.[^'"]+)['"]/g;
const SHELL_SOURCE = /^\s*(?:source|\.)\s+\S*?([\w-]+\.sh)\b/gm;

// The repo files a file pulls names from: relative imports for scripts, sourced files for shell (looked
// for beside the file and in its `lib/`). `read` decides what exists.
export function importedFiles(file: string, text: string, read: (path: string) => string | undefined): string[] {
  const dir = dirname(file), language = languageOf(file, text);
  if (!language) return [];
  const candidates = language === 'js'
    ? [...text.matchAll(JS_IMPORT)].map(match => [join(dir, match[1])])
    : [...text.matchAll(SHELL_SOURCE)].map(match => [join(dir, match[1]), join(dir, 'lib', match[1])]);
  const found = candidates.flatMap(paths => paths.map(path => path.replace(/\\/g, '/')).find(path => read(path) !== undefined) ?? []);
  return [...new Set(found)].filter(path => path !== file);
}
