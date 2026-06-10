#!/usr/bin/env node
// compute-bump — derive the next semver from conventional-commit messages.
// Why: version-bump.yml needs a pure, testable core; the workflow previously
// re-applied bumps to an already-bumped package.json on every PR push.
// Usage: git log --pretty=%s%n%b <range> | node scripts/compute-bump.mjs <current-version>
// Prints the next version, or "none" when no release-worthy commit exists.

/**
 * messages: array of commit subject/body lines.
 * current: semver string the bump applies to.
 * Returns { bump: 'major'|'minor'|'patch'|'none', next: string|null }.
 */
export function computeBump(messages, current) {
  let bump = 'none';
  for (const line of messages) {
    if (/(BREAKING CHANGE|^feat(\(.*\))?!:|^fix(\(.*\))?!:)/.test(line)) { bump = 'major'; break; }
    if (/^feat(\(.*\))?:/.test(line)) { if (bump !== 'major') bump = 'minor'; }
    else if (/^fix(\(.*\))?:/.test(line)) { if (bump === 'none') bump = 'patch'; }
  }
  if (bump === 'none') return { bump, next: null };

  const [major, minor, patch] = current.split('.').map(Number);
  const next = bump === 'major' ? `${major + 1}.0.0`
             : bump === 'minor' ? `${major}.${minor + 1}.0`
             : `${major}.${minor}.${patch + 1}`;
  return { bump, next };
}

// ---------------------------------------------------------------- CLI
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = process.argv[2];
  if (!current || !/^\d+\.\d+\.\d+$/.test(current)) {
    console.error('usage: ... | compute-bump.mjs <current-version>');
    process.exit(1);
  }
  const input = await new Promise((res) => {
    let buf = '';
    process.stdin.on('data', d => buf += d);
    process.stdin.on('end', () => res(buf));
  });
  const { next } = computeBump(input.split('\n'), current);
  console.log(next ?? 'none');
}
