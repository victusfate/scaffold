// Shared clobber-safe write engine — the one place the "never silently
// overwrite consumer files" contract lives (agent-authoring-requirements §2a).
// Consumed by tools/hoist-skill/hoist.mjs and tools/sync/promote.mjs.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Returns a matcher over .scaffold-keep patterns in dest (exact path, dir
// prefix, or * glob). Absent file -> matches nothing.
export function loadKeep(dest) {
  const kf = join(dest, '.scaffold-keep');
  if (!existsSync(kf)) return () => false;
  const patterns = readFileSync(kf, 'utf8')
    .split('\n')
    .map(l => l.replace(/#.*/, '').trim())
    .filter(Boolean);
  return (rel) => patterns.some(p => {
    if (p.includes('*')) {
      const re = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return re.test(rel);
    }
    return rel === p || rel.startsWith(p + '/');
  });
}

/**
 * Write content to dest/relPath under the clobber-safe contract:
 *  - kept paths (.scaffold-keep) are never touched
 *  - identical destination -> unchanged
 *  - differing destination -> *.scaffold-new sidecar, unless force
 *  - check mode reports would-write / would-sidecar without writing
 * Pushes { path, status[, sidecar] } onto results.
 * opts.log, when set, receives the hoist-style status line per write.
 */
export function safeWrite(dest, relPath, content, kept, results, force, opts = {}) {
  const { check = false, log = null } = opts;
  if (kept(relPath)) {
    results.push({ path: relPath, status: 'kept' });
    if (log) log(`  kept   ${relPath}`);
    return;
  }
  const abs = join(dest, relPath);
  if (existsSync(abs)) {
    const existing = readFileSync(abs, 'utf8');
    if (existing === content) {
      results.push({ path: relPath, status: 'unchanged' });
      if (log) log(`  unchanged  ${relPath}`);
      return;
    }
    if (!force) {
      if (check) {
        results.push({ path: relPath, status: 'would-sidecar' });
        return;
      }
      mkdirSync(dirname(abs), { recursive: true });
      const sidecar = abs + '.scaffold-new';
      writeFileSync(sidecar, content, 'utf8');
      results.push({ path: relPath, status: 'sidecar', sidecar: relPath + '.scaffold-new' });
      if (log) log(`  sidecar    ${relPath}.scaffold-new`);
      return;
    }
  }
  if (check) {
    results.push({ path: relPath, status: 'would-write' });
    return;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  results.push({ path: relPath, status: 'written' });
  if (log) log(`  written    ${relPath}`);
}
