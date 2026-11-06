/** Real Git exports must treat changed filenames as data, including pathspec magic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportTree, minimalEnv } from './security-scan-core.ts';

void test('scanner environment preserves operator proxy mode without forwarding Node injection or tokens', () => {
  const work = mkdtempSync(join(tmpdir(), 'scan-env-'));
  const values = { NODE_USE_ENV_PROXY: '1', NODE_OPTIONS: '--require=untrusted-fixture', SCANNER_TEST_TOKEN: 'fixture' };
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    const env = minimalEnv({ work });
    assert.equal(env.NODE_USE_ENV_PROXY, '1');
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.SCANNER_TEST_TOKEN, undefined);
    delete process.env.NODE_USE_ENV_PROXY;
    assert.equal(minimalEnv({ work }).NODE_USE_ENV_PROXY, undefined);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(work, { recursive: true, force: true });
  }
});

void test('restricted scanner export preserves magic-pathspec filenames without excluding changed files', () => {
  const root = mkdtempSync(join(tmpdir(), 'scan-export-'));
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    git('init', '-q');
    const paths = ['victim.ts', ':(exclude)victim.ts', 'glob[1].ts'];
    for (const path of [...paths, 'glob1.ts', 'untouched.ts']) writeFileSync(join(root, path), `committed ${path}\n`);
    git('add', '.');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    writeFileSync(join(root, 'victim.ts'), 'uncommitted content\n');
    const dir = exportTree({ root, work: root }, 'HEAD', join(root, 'export'), paths);
    assert.deepEqual(readdirSync(dir).sort(), [...paths].sort());
    for (const path of paths) assert.equal(readFileSync(join(dir, path), 'utf8'), `committed ${path}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
