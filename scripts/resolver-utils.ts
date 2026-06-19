// Validation helpers for check-resolvable.mjs phases.
import { readFileSync } from 'node:fs';

// Turn a /pattern/flags cell (backtick-wrapped) into a RegExp.
export function compileCell(cell, skill, fail) {
  const raw = cell.replace(/`/g, '').trim();
  const m = raw.match(/^\/(.*)\/([a-z]*)$/s);
  if (!m) { fail('Parse', `${skill}: regex cell is not /pattern/flags → ${raw}`); return null; }
  const body = m[1].replace(/\\\|/g, '|');
  try {
    return new RegExp(body, m[2]);
  } catch (e) {
    fail('Parse', `${skill}: uncompilable regex (${e.message})`);
    return null;
  }
}

export function anchorSlug(cell) {
  const m = cell.replace(/`/g, '').match(/\^\\?\/([a-z0-9-]+)/);
  return m ? m[1] : null;
}

const STOPWORDS = new Set(
  'a an the to of and or as in on for with into via end md from this that'.split(' ')
);

export function tokens(text) {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOPWORDS.has(t))
  );
}

export function jaccard(a, b) {
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function frontmatterDescription(file) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1].split('\n');
  for (let i = 0; i < fm.length; i++) {
    const line = fm[i];
    if (!line.startsWith('description:')) continue;
    const inline = line.slice('description:'.length).trim();
    if (inline && inline !== '|' && inline !== '>') return inline;
    const parts = [];
    for (let j = i + 1; j < fm.length && /^\s+\S/.test(fm[j]); j++) parts.push(fm[j].trim());
    return parts.join(' ');
  }
  return null;
}

export const normalizeWhitespace = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
