// Shared RESOLVER.md parsing utilities used by check-resolvable.mjs and hoist-skill.
import { readFileSync, existsSync } from 'node:fs';

// Parse a RESOLVER.md table row, treating pipe characters inside backtick spans
// as alternation (not column separators). `\|` inside a backtick cell unescapes
// to `|` during regex compilation — existing escaped patterns remain valid.
export function splitRow(row) {
  const cells = [];
  let current = '';
  let inBacktick = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '`') {
      inBacktick = !inBacktick;
      current += ch;
    } else if (ch === '|' && !inBacktick) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) cells.push(current.trim());
  return cells.filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
}

// Read a RESOLVER.md file and return parsed rows: { name, regexCell, path, purpose }.
// Skips header, separator, and malformed rows (<4 cells) silently. Returns [] if absent.
export function parseResolverRows(resolverPath) {
  if (!existsSync(resolverPath)) return [];
  const rows = [];
  let inTable = false;
  for (const line of readFileSync(resolverPath, 'utf8').split('\n')) {
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (!isRow) { if (inTable && line.trim()) break; continue; }
    const cells = splitRow(line);
    if (cells[0] === 'Skill') { inTable = true; continue; }
    if (/^-{2,}$/.test(cells[0]?.replace(/[:\s]/g, ''))) continue;
    if (!inTable || cells.length < 4) continue;
    rows.push({
      name:      cells[0].replace(/`/g, ''),
      regexCell: cells[1],
      path:      cells[2].replace(/`/g, ''),
      purpose:   cells[3],
    });
  }
  return rows;
}
