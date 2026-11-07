import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUN = join(ROOT, 'tools/hoist-skill/run');
const BODY = readFileSync(join(ROOT, 'skills/loop.md'), 'utf8');
const REFERENCE = readFileSync(join(ROOT, 'skills/loop/reference.md'), 'utf8');
const RESOLVER = readFileSync(join(ROOT, '.claude/skills/RESOLVER.md'), 'utf8');

function linkedReference(path: string): string {
  const content = readFileSync(path, 'utf8');
  const link = /\[external driver and continuity\]\(([^)]+)\)/.exec(content)?.[1];
  assert.ok(link, 'on-demand reference link exists');
  assert.ok(!/^@.*reference\.md/m.test(content), 'reference is not auto-included');
  assert.ok(!content.includes('SCAFFOLD_AGENT_LOOP_RESULT'), 'external protocol stays out of the native path');
  return resolve(dirname(path), link);
}

await test('a fresh consumer can resolve the external loop reference from any invoking CWD', () => {
  const dest = mkdtempSync(join(tmpdir(), 'loop-export-'));
  try {
    execFileSync(process.execPath, [RUN, '--names', 'loop', '--harness', 'all', '--into', dest], { cwd: tmpdir() });
    const reference = linkedReference(join(dest, 'skills/loop.md'));
    assert.equal(readFileSync(reference, 'utf8'), REFERENCE);
    assert.equal(readFileSync(join(dest, 'skills/loop.md'), 'utf8'), BODY);
    for (const wrapper of ['.claude/skills/loop/SKILL.md', '.agents/skills/loop/SKILL.md',
      '.pi/skills/loop/SKILL.md', '.cursor/rules/loop.mdc', '.agent/workflows/loop.md'])
      assert.ok(existsSync(join(dest, wrapper)), wrapper);
    writeFileSync(reference, 'consumer reference\n');
    execFileSync(process.execPath, [RUN, '--names', 'loop', '--into', dest]);
    assert.equal(readFileSync(reference, 'utf8'), 'consumer reference\n');
    assert.equal(readFileSync(`${reference}.scaffold-new`, 'utf8'), REFERENCE);
  } finally { rmSync(dest, { recursive: true, force: true }); }
});

await test('a standalone globalized loop keeps a separate, resolvable reference', () => {
  const dest = mkdtempSync(join(tmpdir(), 'loop-global-'));
  try {
    execFileSync('bash', [join(ROOT, 'bin/globalize-skill.sh'), 'loop', '--from', ROOT,
      '--target', dest], { cwd: tmpdir() });
    const path = join(dest, 'loop/SKILL.md');
    assert.equal(readFileSync(linkedReference(path), 'utf8'), REFERENCE);
    assert.ok(!readFileSync(path, 'utf8').includes('Session continuity (opt-in'));
  } finally { rmSync(dest, { recursive: true, force: true }); }
});

await test('scaffold sync copies the reference without eagerly including it', () => {
  const dest = mkdtempSync(join(tmpdir(), 'loop-sync-'));
  try {
    const shipped = readFileSync(join(ROOT, '.github/scaffold-files.txt'), 'utf8');
    assert.ok(shipped.split('\n').includes('skills/loop/reference.md'));
    mkdirSync(join(dest, '.sync'), { recursive: true });
    writeFileSync(join(dest, '.sync/policy.yaml'), 'files:\n  copy:\n    - skills/loop.md\n    - skills/loop/reference.md\nskills:\n  manifest: .sync/hoisted\n');
    execFileSync(process.execPath, [join(ROOT, 'bin/sync'), '--into', dest,
      `--scaffold-root=${ROOT}`], { cwd: tmpdir() });
    assert.equal(readFileSync(linkedReference(join(dest, 'skills/loop.md')), 'utf8'), REFERENCE);
  } finally { rmSync(dest, { recursive: true, force: true }); }
});

await test('linked local references are required before exporting or globalizing a partial mirror', () => {
  const root = mkdtempSync(join(tmpdir(), 'loop-missing-'));
  try {
    const source = join(root, 'source');
    mkdirSync(join(source, 'skills'), { recursive: true });
    mkdirSync(join(source, '.claude/skills/loop'), { recursive: true });
    writeFileSync(join(source, 'skills/loop.md'), BODY);
    writeFileSync(join(source, '.claude/skills/RESOLVER.md'), RESOLVER);
    writeFileSync(join(source, '.claude/skills/loop/SKILL.md'), '@../../../skills/loop.md\n');
    assert.throws(() => execFileSync(process.execPath, [RUN, '--names', 'loop', '--into', join(root, 'consumer')], {
      env: { ...process.env, HOIST_SCAFFOLD_ROOT: source }, stdio: 'pipe',
    }), /missing source skills\/loop\/reference\.md/);
    assert.ok(!existsSync(join(root, 'consumer/skills/loop.md')));
    assert.throws(() => execFileSync('bash', [join(ROOT, 'bin/globalize-skill.sh'), 'loop',
      '--from', source, '--target', join(root, 'global')], { stdio: 'pipe' }), /missing required reference/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

await test('fetched reference sidecars work while old pins without references remain supported', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loop-fetch-'));
  let body = BODY;
  let reference: string | null = REFERENCE;
  const server = createServer((req, res) => {
    const path = req.url?.replace(/^\/[^/]+\//, '');
    const content = path === '.claude/skills/RESOLVER.md' ? RESOLVER
      : path === 'skills/loop.md' ? body
      : path === 'skills/loop/reference.md' ? reference : null;
    res.writeHead(content === null ? 404 : 200);
    res.end(content ?? 'not found');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const run = (dest: string) => promisify(execFile)(process.execPath, [RUN, '--fetch', '--names', 'loop',
    '--into', dest, '--ref', 'v1.0.0'], {
    cwd: tmpdir(), env: { ...process.env, HOIST_RAW_BASE: `http://127.0.0.1:${address.port}` },
  });
  try {
    const dest = join(root, 'consumer');
    await run(dest);
    assert.equal(readFileSync(linkedReference(join(dest, 'skills/loop.md')), 'utf8'), REFERENCE);
    reference = null;
    await assert.rejects(run(join(root, 'missing')), /missing source skills\/loop\/reference\.md/);
    body = 'Old loop release without a sidecar.\n';
    const old = join(root, 'old');
    await run(old);
    assert.equal(readFileSync(join(old, 'skills/loop.md'), 'utf8'), body);
    assert.ok(!existsSync(join(old, 'skills/loop/reference.md')));
  } finally {
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    rmSync(root, { recursive: true, force: true });
  }
});
