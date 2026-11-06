import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { hoist } from './hoist.ts';

const NOTICE = 'THIRD_PARTY_NOTICES.txt';
const BODY = `A short skill. Adapted from Matt Pocock ([MIT notice](../${NOTICE})).\n`;
const LICENSE = readFileSync(NOTICE, 'utf8');
const RESOLVER = readFileSync('.claude/skills/RESOLVER.md', 'utf8');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skill-notices-'));
  const source = join(root, 'source');
  const target = join(root, 'consumer');
  mkdirSync(join(source, '.claude/skills/tdd'), { recursive: true });
  mkdirSync(join(source, 'skills'));
  writeFileSync(join(source, '.claude/skills/RESOLVER.md'), RESOLVER);
  writeFileSync(join(source, '.claude/skills/tdd/SKILL.md'), '---\ndescription: TDD\n---\n\n@../../../skills/tdd.md\n');
  writeFileSync(join(source, 'skills/tdd.md'), BODY);
  writeFileSync(join(source, NOTICE), LICENSE);
  return { root, source, target };
}

await test('every harness export ships a separate notice without loading license text', async () => {
  const f = fixture();
  try {
    await hoist({ names: 'tdd', harness: 'all', into: f.target, srcRoot: f.source });
    assert.equal(readFileSync(join(f.target, NOTICE), 'utf8'), LICENSE);
    assert.equal(readFileSync(join(f.target, 'skills/tdd.md'), 'utf8'), BODY);
    for (const wrapper of ['.claude/skills/tdd/SKILL.md', '.agents/skills/tdd/SKILL.md',
      '.cursor/rules/tdd.mdc', '.agent/workflows/tdd.md', '.pi/skills/tdd/SKILL.md']) {
      const content = readFileSync(join(f.target, wrapper), 'utf8');
      assert.ok(!content.includes('Permission is hereby granted'), wrapper);
      assert.ok(!content.includes(`@${NOTICE}`), wrapper);
    }
    writeFileSync(join(f.target, NOTICE), 'consumer notices\n');
    await hoist({ names: 'tdd', harness: 'codex', into: f.target, srcRoot: f.source });
    assert.equal(readFileSync(join(f.target, NOTICE), 'utf8'), 'consumer notices\n');
    assert.equal(readFileSync(join(f.target, `${NOTICE}.scaffold-new`), 'utf8'), LICENSE);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('a referenced notice cannot disappear from a partial source mirror', async () => {
  const f = fixture();
  try {
    rmSync(join(f.source, NOTICE));
    await assert.rejects(hoist({ names: 'tdd', harness: 'claude', into: f.target, srcRoot: f.source }),
      /missing source THIRD_PARTY_NOTICES/);
    assert.ok(!existsSync(join(f.target, 'skills/tdd.md')));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('globalize and bulk install keep notices beside the standalone prompt', () => {
  const f = fixture();
  try {
    execFileSync('bash', [resolve('bin/globalize-skill.sh'), 'tdd', '--from', f.source, '--target', f.target]);
    assert.equal(readFileSync(join(f.target, 'tdd', NOTICE), 'utf8'), LICENSE);
    const prompt = readFileSync(join(f.target, 'tdd/SKILL.md'), 'utf8');
    assert.ok(prompt.includes(`[MIT notice](${NOTICE})`));
    assert.ok(existsSync(resolve(f.target, 'tdd', NOTICE)));
    assert.ok(!prompt.includes('Permission is hereby granted'));
    const bulk = join(f.root, 'bulk');
    execFileSync('bash', [resolve('bin/install-skills.sh'), bulk]);
    assert.equal(readFileSync(join(bulk, 'retro', NOTICE), 'utf8'), LICENSE);
    assert.ok(!readFileSync(join(bulk, 'retro/SKILL.md'), 'utf8').includes('Permission is hereby granted'));
    rmSync(join(f.source, NOTICE));
    assert.throws(() => execFileSync('bash', [resolve('bin/globalize-skill.sh'), 'tdd',
      '--from', f.source, '--target', join(f.root, 'missing')], { stdio: 'pipe' }), /missing required notice/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('fetch keeps notices separate, supports old pins, and refuses a missing referenced notice', async () => {
  const f = fixture();
  let sendNotice = true;
  let body = BODY;
  const server = createServer((req, res) => {
    const path = req.url?.replace(/^\/[^/]+\//, '');
    const content = path === '.claude/skills/RESOLVER.md' ? RESOLVER
      : path === 'skills/tdd.md' ? body
      : path === NOTICE && sendNotice ? LICENSE : null;
    res.writeHead(content === null ? 404 : 200);
    res.end(content ?? 'not found');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const run = (dest: string) => promisify(execFile)(process.execPath, ['tools/hoist-skill/run',
    '--fetch', '--names', 'tdd', '--harness', 'all', '--into', dest, '--ref', 'v1.0.0'], {
    env: { ...process.env, HOIST_RAW_BASE: `http://127.0.0.1:${address.port}` },
  });
  try {
    await run(f.target);
    assert.equal(readFileSync(join(f.target, NOTICE), 'utf8'), LICENSE);
    assert.equal(readFileSync(join(f.target, 'skills/tdd.md'), 'utf8'), BODY);
    sendNotice = false;
    await assert.rejects(run(join(f.root, 'missing')), /missing source THIRD_PARTY_NOTICES/);
    body = 'Old release without external notices.\n';
    const old = join(f.root, 'old');
    await run(old);
    assert.equal(readFileSync(join(old, 'skills/tdd.md'), 'utf8'), body);
    assert.ok(!existsSync(join(old, NOTICE)));
  } finally {
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    rmSync(f.root, { recursive: true, force: true });
  }
});
