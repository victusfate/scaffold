import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parallelStages, headTree, type Ctx } from './security-scan-core.ts';

void test('scanner jobs overlap, stay bounded and preserve input order', async () => {
  let active = 0, peak = 0;
  const results = await parallelStages([40, 5, 20, 1].map((ms, i) => async () => {
    active++; peak = Math.max(peak, active);
    await delay(ms); active--; return i;
  }), 2);
  assert.deepEqual(results, [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

void test('a scanner error fails closed after all jobs drain', async () => {
  let drained = false;
  await assert.rejects(parallelStages([
    () => Promise.reject(new Error('scanner failed')),
    async () => { await delay(30); drained = true; },
  ]), /scanner failed/);
  assert.equal(drained, true);
  await assert.rejects(parallelStages([], 0), /invalid scanner concurrency/);
});

void test('restricted scanner exports retain committed targets without exporting unrelated files', () => {
  const root = mkdtempSync(join(tmpdir(), 'security-export-test-'));
  try {
    const git = (...args: string[]) => {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    };
    git('init', '-q');
    writeFileSync(join(root, 'target.py'), 'committed = True\n');
    writeFileSync(join(root, 'unrelated'), 'never needed by changed-file SAST\n');
    git('add', 'target.py', 'unrelated');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    writeFileSync(join(root, 'target.py'), 'uncommitted = True\n');
    const work = join(root, 'work'); mkdirSync(work);
    const c = { root, work, headPaths: ['target.py'] } as Ctx;
    const tree = headTree(c);
    assert.equal(existsSync(join(tree, 'target.py')), true);
    assert.equal(existsSync(join(tree, 'unrelated')), false);
    assert.equal(headTree(c), tree);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test('missing human review refuses before launching expensive scanners', () => {
  const work = mkdtempSync(join(tmpdir(), 'security-review-first-'));
  try {
    const body = join(work, 'body.md'); writeFileSync(body, 'No security review section\n');
    mkdirSync(join(work, 'scripts'));
    writeFileSync(join(work, 'scripts/security-scan.ts'), 'throw new Error("scanner must not start");\n');
    const gate = new URL('./security-gate.ts', import.meta.url);
    const r = spawnSync(process.execPath, [gate.pathname, '--gate-dir', work, body], { encoding: 'utf8' });
    assert.equal(r.status, 4);
    assert.match(r.stdout, /no '## Security review' section/);
    assert.doesNotMatch(r.stdout + r.stderr, /scanner must not start/);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

void test('every failed scanner is reported after later jobs finish', async () => {
  const finished: string[] = [];
  const jobs = ['gitleaks', 'semgrep', 'osv', 'eslint'].map((name, i) => async () => {
    await delay(i === 0 ? 20 : 1);
    finished.push(name);
    throw new Error(`${name}: injected failure`);
  });
  await assert.rejects(parallelStages(jobs, 2), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 4);
    for (const name of finished) assert.ok(error.message.includes(`${name}: injected failure`));
    return true;
  });
  assert.deepEqual(finished.sort(), ['eslint', 'gitleaks', 'osv', 'semgrep']);
});
