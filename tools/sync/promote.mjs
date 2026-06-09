// File promotion engine — applies policy rules to scaffold source files.
// Writes go through the shared clobber-safe engine (tools/lib/safe-write.mjs):
// .scaffold-keep honored, sidecars for differing files unless force.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { safeWrite, loadKeep } from '../lib/safe-write.mjs';

/**
 * Promote files from srcRoot into destRoot according to policy rules.
 * Returns an array of { path, status } results.
 *
 * Statuses: written | unchanged | kept | sidecar | guarded-skip | protected |
 *           src-missing | would-write | would-sidecar | would-guarded-skip |
 *           would-protected
 */
export function promoteFiles(policy, srcRoot, destRoot, opts = {}) {
  const { check = false, force = false } = opts;
  const results = [];
  const kept = loadKeep(destRoot);

  const { copy, guarded, protected: protected_ } = policy.files;

  // copy entries
  for (const relPath of copy) {
    const srcAbs = join(srcRoot, relPath);
    if (!existsSync(srcAbs)) {
      results.push({ path: relPath, status: 'src-missing' });
      continue;
    }
    const incoming = readFileSync(srcAbs, 'utf8');
    safeWrite(destRoot, relPath, incoming, kept, results, force, { check });
  }

  // guarded entries
  for (const { path: relPath, keep_marker } of guarded) {
    const srcAbs = join(srcRoot, relPath);
    if (!existsSync(srcAbs)) {
      results.push({ path: relPath, status: 'src-missing' });
      continue;
    }
    const incoming = readFileSync(srcAbs, 'utf8');
    if (!incoming.includes(keep_marker)) {
      results.push({ path: relPath, status: check ? 'would-guarded-skip' : 'guarded-skip' });
      continue;
    }
    safeWrite(destRoot, relPath, incoming, kept, results, force, { check });
  }

  // protected entries — record status, never write
  for (const relPath of protected_) {
    results.push({ path: relPath, status: check ? 'would-protected' : 'protected' });
  }

  return results;
}
