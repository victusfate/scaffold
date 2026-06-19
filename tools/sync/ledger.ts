// Managed-file ledger — the materialized "prior state" used to prune orphans.
// Each sync writes .sync/managed: one `<relPath>\t<sha256>` line per file in
// the managed set (policy-promoted files scaffold owns on disk). A later sync
// diffs the previous ledger against the new managed set to find orphans.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

// relPath -> sha256 of the content scaffold owns at that path.
export type Ledger = Map<string, string>;

const HEADER =
  '# .sync/managed — files scaffold placed here; used to prune orphans on sync.\n' +
  '# Generated; do not edit by hand. <path>\\t<sha256>\n';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function readLedger(path: string): Ledger {
  const ledger: Ledger = new Map();
  if (!existsSync(path)) return ledger;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const p = line.slice(0, tab).trim();
    const h = line.slice(tab + 1).trim();
    if (p && h) ledger.set(p, h);
  }
  return ledger;
}

export function writeLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = [...ledger.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, h]) => `${p}\t${h}`)
    .join('\n');
  writeFileSync(path, HEADER + body + (body ? '\n' : ''), 'utf8');
}
