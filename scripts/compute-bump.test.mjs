#!/usr/bin/env node
// Tests for scripts/compute-bump.mjs — conventional-commit version bump logic.

import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;

function assert(label, cond, detail = '') {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const { computeBump } = await import('./compute-bump.mjs');

// feat → minor
{
  const r = computeBump(['feat(sync): add sidecars'], '1.2.3');
  assert('feat bumps minor', r.bump === 'minor' && r.next === '1.3.0', JSON.stringify(r));
}

// fix → patch
{
  const r = computeBump(['fix: handle quoted ref'], '1.2.3');
  assert('fix bumps patch', r.bump === 'patch' && r.next === '1.2.4', JSON.stringify(r));
}

// breaking → major
{
  const r = computeBump(['feat!: drop node 16'], '1.2.3');
  assert('feat! bumps major', r.bump === 'major' && r.next === '2.0.0', JSON.stringify(r));
}

// BREAKING CHANGE in body → major
{
  const r = computeBump(['feat: x', 'BREAKING CHANGE: y'], '0.5.0');
  assert('BREAKING CHANGE bumps major', r.bump === 'major' && r.next === '1.0.0', JSON.stringify(r));
}

// docs/chore only → none
{
  const r = computeBump(['docs: readme', 'chore: bump version'], '1.2.3');
  assert('docs/chore is none', r.bump === 'none' && r.next === null, JSON.stringify(r));
}

// mixed: feat outranks fix
{
  const r = computeBump(['fix: a', 'feat(x): b', 'docs: c'], '1.2.3');
  assert('feat outranks fix', r.bump === 'minor' && r.next === '1.3.0', JSON.stringify(r));
}

// major outranks everything
{
  const r = computeBump(['feat: a', 'fix!: b'], '1.2.3');
  assert('fix! outranks feat', r.bump === 'major' && r.next === '2.0.0', JSON.stringify(r));
}

// CLI: messages on stdin, version as arg, next version on stdout
{
  const out = execFileSync(process.execPath, [join(HERE, 'compute-bump.mjs'), '1.2.3'], {
    input: 'feat: something\nfix: other\n', encoding: 'utf8',
  }).trim();
  assert('CLI prints next version', out === '1.3.0', out);
}

// CLI: no bump → prints none
{
  const out = execFileSync(process.execPath, [join(HERE, 'compute-bump.mjs'), '1.2.3'], {
    input: 'docs: readme\n', encoding: 'utf8',
  }).trim();
  assert('CLI prints none for no bump', out === 'none', out);
}

console.error(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
