// Manifest read/write for .sync/hoisted.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ManifestEntry {
  name: string;
  harness: string;
  ref: string;
}

export function readManifest(path: string): ManifestEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const parts = l.split('\t');
      return { name: (parts[0] || '').trim(), harness: (parts[1] || '').trim(), ref: (parts[2] || 'main').trim() };
    })
    .filter(e => e.name && e.harness);
}

export function upsertManifest(path: string, newEntries: ManifestEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const existing = readManifest(path);
  let header = '# .sync/hoisted — skills hoisted from scaffold; replayed by /pull-scaffold.\n# <name>\t<harness>\t<ref>\n';
  if (existsSync(path)) {
    const commentLines = readFileSync(path, 'utf8').split('\n').filter(l => l.startsWith('#'));
    if (commentLines.length) header = commentLines.join('\n') + '\n';
  }
  const merged = [...existing];
  for (const entry of newEntries) {
    const idx = merged.findIndex(e => e.name === entry.name && e.harness === entry.harness);
    if (idx >= 0) merged[idx] = entry;
    else merged.push(entry);
  }
  writeFileSync(path, header + merged.map(e => `${e.name}\t${e.harness}\t${e.ref}`).join('\n') + '\n', 'utf8');
}
