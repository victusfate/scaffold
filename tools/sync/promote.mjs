// File promotion engine — applies policy rules to scaffold source files.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Promote files from srcRoot into destRoot according to policy rules.
 * Returns an array of { path, status } results.
 *
 * Statuses: written | unchanged | guarded-skip | protected | src-missing | would-write | would-guarded-skip | would-protected
 */
export async function promoteFiles(policy, srcRoot, destRoot, opts = {}) {
  const { check = false, force = false } = opts;
  const results = [];

  const { copy, guarded, protected: protected_ } = policy.files;

  // copy entries
  for (const relPath of copy) {
    const srcAbs = join(srcRoot, relPath);
    if (!existsSync(srcAbs)) {
      results.push({ path: relPath, status: 'src-missing' });
      continue;
    }
    const incoming = readFileSync(srcAbs, 'utf8');
    results.push(applyWrite(relPath, incoming, destRoot, check, force));
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
    results.push(applyWrite(relPath, incoming, destRoot, check, force));
  }

  // protected entries — record status, never write
  for (const relPath of protected_) {
    results.push({ path: relPath, status: check ? 'would-protected' : 'protected' });
  }

  return results;
}

function applyWrite(relPath, incoming, destRoot, check, force) {
  const destAbs = join(destRoot, relPath);
  if (existsSync(destAbs)) {
    const existing = readFileSync(destAbs, 'utf8');
    if (existing === incoming) return { path: relPath, status: 'unchanged' };
  }
  if (check) return { path: relPath, status: 'would-write' };
  mkdirSync(dirname(destAbs), { recursive: true });
  writeFileSync(destAbs, incoming, 'utf8');
  return { path: relPath, status: 'written' };
}
