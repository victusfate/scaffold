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

const PREVIOUS_PLAN = 'grill-with-docs';
const CURRENT_PLAN = 'co-plan';

/** Resolve a recorded rename only against a registry that has adopted it. */
export function resolveManifestEntries(entries: ManifestEntry[], available: Set<string>, refOverride?: string): ManifestEntry[] {
  const migrate = available.has(CURRENT_PLAN) && !available.has(PREVIOUS_PLAN);
  return entries.filter(e => !migrate || e.name !== PREVIOUS_PLAN ||
    !entries.some(n => n.name === CURRENT_PLAN && n.harness === e.harness)).map(e => {
    const ref = refOverride ?? e.ref;
    if (!migrate || e.name !== PREVIOUS_PLAN) return { ...e, ref };
    if (ref !== 'main') throw new Error(
      `${PREVIOUS_PLAN} is pinned to ${ref}; its historical path cannot be renamed to ${CURRENT_PLAN}.\n` +
      `Re-hoist with --names ${CURRENT_PLAN} --harness ${e.harness} --ref main to migrate deliberately, ` +
      `or use a scaffold release that still contains ${PREVIOUS_PLAN}.`,
    );
    return { ...e, name: CURRENT_PLAN, ref };
  });
}

export function upsertManifest(path: string, newEntries: ManifestEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const existing = readManifest(path);
  let header = '# .sync/hoisted — skills hoisted from scaffold; replayed by /pull-scaffold.\n# <name>\t<harness>\t<ref>\n';
  if (existsSync(path)) {
    const commentLines = readFileSync(path, 'utf8').split('\n').filter(l => l.startsWith('#'));
    if (commentLines.length) header = commentLines.join('\n') + '\n';
  }
  // Explicitly hoisting the replacement retires the matching legacy registration.
  const merged = existing.filter(e => e.name !== PREVIOUS_PLAN ||
    !newEntries.some(n => n.name === CURRENT_PLAN && n.harness === e.harness));
  for (const entry of newEntries) {
    const idx = merged.findIndex(e => e.name === entry.name && e.harness === entry.harness);
    if (idx >= 0) merged[idx] = entry;
    else merged.push(entry);
  }
  writeFileSync(path, header + merged.map(e => `${e.name}\t${e.harness}\t${e.ref}`).join('\n') + '\n', 'utf8');
}
