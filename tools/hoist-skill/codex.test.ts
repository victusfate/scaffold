import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

function run(args: string[], env = process.env): Record<string, unknown> {
  const result = spawnSync(process.execPath, ['tools/hoist-skill/run', ...args], {
    encoding: 'utf8', env,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

await test('Codex export installs a discoverable skill and records its harness', () => {
  const dest = mkdtempSync(join(tmpdir(), 'codex-hoist-'));
  try {
    const result = spawnSync(process.execPath, [
      'tools/hoist-skill/run', '--names', 'tdd', '--harness', 'codex', '--into', dest,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const wrapper = readFileSync(join(dest, '.agents/skills/tdd/SKILL.md'), 'utf8');
    assert.match(wrapper, /^---\nname: tdd\ndescription:/);
    assert.match(wrapper, /\.\.\/\.\.\/\.\.\/skills\/tdd\.md/);
    assert.equal(readFileSync(join(dest, 'skills/tdd.md'), 'utf8'),
      readFileSync('skills/tdd.md', 'utf8'));
    assert.match(readFileSync(join(dest, '.sync/hoisted'), 'utf8'), /tdd\tcodex\tmain/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

await test('Codex plan, replay, and edit protection work through the CLI', () => {
  const dest = mkdtempSync(join(tmpdir(), 'codex-replay-'));
  try {
    const args = ['--names', 'tdd', '--harness', 'codex', '--into', dest];
    const plan = run([...args, '--plan']);
    assert.equal(plan.harness, 'codex');
    const sources = plan.sources as { path: string; required: boolean }[];
    assert.ok(sources.some(s => s.path === '.agents/skills/tdd/SKILL.md' && !s.required));
    assert.ok(!sources.some(s => s.path.startsWith('.agent/workflows/')));
    assert.ok(!existsSync(join(dest, '.sync')));
    run(args);
    const wrapperPath = join(dest, '.agents/skills/tdd/SKILL.md');
    const upstream = readFileSync(wrapperPath, 'utf8');
    writeFileSync(wrapperPath, 'consumer edit\n');
    run(['--from-manifest', '--into', dest]);
    assert.equal(readFileSync(wrapperPath, 'utf8'), 'consumer edit\n');
    assert.equal(readFileSync(`${wrapperPath}.scaffold-new`, 'utf8'), upstream);
    writeFileSync(join(dest, '.scaffold-keep'), '.agents/skills/tdd/SKILL.md\n');
    run([...args, '--force']);
    assert.equal(readFileSync(wrapperPath, 'utf8'), 'consumer edit\n');
    rmSync(join(dest, '.scaffold-keep'));
    run([...args, '--force']);
    assert.equal(readFileSync(wrapperPath, 'utf8'), upstream);
    assert.ok(!existsSync(join(dest, '.claude')));
    assert.ok(!existsSync(join(dest, '.agent/workflows')));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

await test('generated Codex wrappers resolve and all harnesses share the same wrapper', () => {
  const dest = mkdtempSync(join(tmpdir(), 'codex-generated-'));
  const source = mkdtempSync(join(tmpdir(), 'codex-source-'));
  try {
    mkdirSync(join(source, '.claude/skills'), { recursive: true });
    mkdirSync(join(source, 'skills'));
    writeFileSync(join(source, '.claude/skills/RESOLVER.md'),
      readFileSync('.claude/skills/RESOLVER.md', 'utf8'));
    writeFileSync(join(source, 'skills/tdd.md'), 'fixture body\n');
    run(['--names', 'tdd', '--harness', 'all', '--into', dest], {
      ...process.env, HOIST_SCAFFOLD_ROOT: source,
    });
    const wrapperPath = join(dest, '.agents/skills/tdd/SKILL.md');
    const wrapper = readFileSync(wrapperPath, 'utf8');
    const link = /\]\(([^)]+)\)/.exec(wrapper)?.[1];
    assert.ok(link);
    assert.equal(readFileSync(resolve(dirname(wrapperPath), link), 'utf8'), 'fixture body\n');
    assert.match(wrapper, /^---\nname: tdd\ndescription: \|/);
    assert.ok(!existsSync(`${wrapperPath}.scaffold-new`));
    for (const path of ['.claude/skills/tdd/SKILL.md', '.cursor/rules/tdd.mdc', '.agent/workflows/tdd.md'])
      assert.ok(existsSync(join(dest, path)), path);
    const manifest = readFileSync(join(dest, '.sync/hoisted'), 'utf8');
    for (const harness of ['claude', 'cursor', 'antigravity', 'codex'])
      assert.ok(manifest.includes(`tdd\t${harness}\tmain`));
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});

await test('Codex fetch generates an absent optional wrapper from a pinned source', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'codex-fetch-'));
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url === '/v-test/.claude/skills/RESOLVER.md')
      res.end(readFileSync('.claude/skills/RESOLVER.md'));
    else if (req.url === '/v-test/skills/tdd.md') res.end('pinned body\n');
    else { res.statusCode = 404; res.end(); }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await promisify(execFile)(process.execPath, [
      'tools/hoist-skill/run', '--fetch', '--names', 'tdd', '--harness', 'codex',
      '--ref', 'v-test', '--into', dest,
    ], { env: { ...process.env, HOIST_RAW_BASE: `http://127.0.0.1:${address.port}` } });
    assert.ok(requests.includes('/v-test/.agents/skills/tdd/SKILL.md'));
    assert.equal(readFileSync(join(dest, 'skills/tdd.md'), 'utf8'), 'pinned body\n');
    assert.match(readFileSync(join(dest, '.agents/skills/tdd/SKILL.md'), 'utf8'), /^---\nname: tdd/);
    assert.match(readFileSync(join(dest, '.sync/hoisted'), 'utf8'), /tdd\tcodex\tv-test/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dest, { recursive: true, force: true });
  }
});
