// File promotion engine — applies policy rules to scaffold source files.
// Writes go through the shared clobber-safe engine (tools/lib/safe-write.ts):
// .scaffold-keep honored, sidecars for differing files unless force.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { safeWrite, loadKeep, type WriteResult } from '../lib/safe-write.ts';
import type { Policy } from './policy.ts';

interface PromoteOpts {
  check?: boolean;
  force?: boolean;
}

/**
 * Promote files from srcRoot into destRoot according to policy rules.
 * Returns an array of { path, status } results.
 *
 * Statuses: written | unchanged | kept | sidecar | guarded-skip | protected |
 *           src-missing | would-write | would-sidecar | would-guarded-skip |
 *           would-protected
 */
export function promoteFiles(policy: Policy, srcRoot: string, destRoot: string, opts: PromoteOpts = {}): WriteResult[] {
  const { check = false, force = false } = opts;
  const results: WriteResult[] = [];
  const kept = loadKeep(destRoot);

  const { copy, guarded, protected: protected_ } = policy.files;

  // Reject any relPath that would escape destRoot (path traversal guard)
  const isSafe = (relPath: string): boolean => {
    const abs = resolve(destRoot, relPath);
    return abs.startsWith(resolve(destRoot) + '/') || abs === resolve(destRoot);
  };

  // copy entries
  for (const relPath of copy) {
    if (!isSafe(relPath)) {
      results.push({ path: relPath, status: 'traversal-blocked' });
      continue;
    }
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
    if (!isSafe(relPath)) {
      results.push({ path: relPath, status: 'traversal-blocked' });
      continue;
    }
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
