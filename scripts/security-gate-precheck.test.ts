#!/usr/bin/env node
// security-gate-precheck.test.ts — the fast, scanner-free feedback modes of the security gate: `--precheck`
// reports EVERY uncovered file and every malformed ack line in one pass (and passes a complete review), and
// `--draft` prints a review skeleton naming every changed file. No scanners or network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { malformedAcks, renamePairs, uncoveredNote } from './security-gate.ts';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'security-gate.ts');
const T = mkdtempSync(join(tmpdir(), 'security-gate-precheck-'));
const ORIGIN = join(T, 'origin.git');
const REPO = join(T, 'repo');

function sh(cmd: string, args: string[], cwd = REPO): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const g = (...args: string[]) => sh('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=t', ...args]);
function write(path: string, text: string): void {
  mkdirSync(dirname(join(REPO, path)), { recursive: true });
  writeFileSync(join(REPO, path), text);
}
function gate(...args: string[]) {
  return spawnSync(process.execPath, [GATE, ...args], { cwd: REPO, encoding: 'utf8' });
}

sh('git', ['init', '-q', '--bare', ORIGIN], T);
sh('git', ['clone', '-q', ORIGIN, REPO], T);
write('README.md', 'base\n');
g('add', '.'); g('commit', '-qm', 'base'); g('branch', '-M', 'main'); g('push', '-q', 'origin', 'main');
g('checkout', '-qb', 'feature');
for (const f of ['src/a.ts', 'src/b.ts', 'docs/c.md']) write(f, `${f}\n`);
g('add', '.'); g('commit', '-qm', 'feature');

try {
  void test('precheck lists every uncovered file and every malformed ack line at once', () => {
    const body = join(T, 'partial.md');
    writeFileSync(body, '## Security review\n- `src/a.ts`: reviewed\n\nsecurity-ack: sast:x@src/a.ts:1 missing the dash reason\n');
    const r = gate('--precheck', body);
    assert.equal(r.status, 4, r.stdout);
    assert.match(r.stdout, /3 problems/);
    assert.match(r.stdout, /does not cover `src\/b\.ts`/);
    assert.match(r.stdout, /does not cover `docs\/c\.md`/);
    assert.match(r.stdout, /malformed ack line/);
  });

  void test('precheck passes a review that names every changed file', () => {
    const body = join(T, 'full.md');
    writeFileSync(body, '## Security review\n- `src/a.ts`: ok\n- `src/b.ts`: ok\n- `docs/c.md`: ok\n\n'
      + 'security-ack: sast:x@src/a.ts:1 — linear regex over our own CLI output\n');
    const r = gate('--precheck', body);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /precheck: passed/);
  });

  void test('precheck refuses a body with no review section', () => {
    const body = join(T, 'none.md');
    writeFileSync(body, '## Summary\nno review\n');
    assert.equal(gate('--precheck', body).status, 4);
  });

  void test('draft names every changed file as a backticked path', () => {
    const r = gate('--draft');
    assert.equal(r.status, 0, r.stdout);
    for (const f of ['src/a.ts', 'src/b.ts', 'docs/c.md']) assert.ok(r.stdout.includes(`\`${f}\``), f);
    assert.match(r.stdout, /^## Security review/m);
  });

  void test('malformedAcks accepts only the gate-recognised ack shape', () => {
    assert.deepEqual(malformedAcks('security-ack: id — reason\nsecurity-ack: id —   spaced reason\nsecurity-ack: id reason\nnot an ack'), ['security-ack: id reason']);
  });
} finally {
  void test('cleanup', () => rmSync(T, { recursive: true, force: true }));
}

void test('an uncovered rename names both sides and says to list both paths', () => {
  const r = renamePairs('M\0a.ts\0R100\0old/x.ts\0new/x.ts\0A\0b.ts\0');
  assert.deepEqual([...r], [['old/x.ts', 'new/x.ts']]);
  assert.match(uncoveredNote('old/x.ts', r), /renamed to `new\/x\.ts` — list both paths/);
  assert.match(uncoveredNote('new/x.ts', r), /renamed from `old\/x\.ts` — list both paths/);
  assert.equal(uncoveredNote('a.ts', r), 'the security review does not cover `a.ts`');
});
