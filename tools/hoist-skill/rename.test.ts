import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { hoist } from './hoist.ts';
import { readManifest } from './manifest.ts';

function fixture(entries = 'grill-with-docs\tcodex\tmain\n') {
  const root = mkdtempSync(join(tmpdir(), 'skill-rename-'));
  mkdirSync(join(root, '.sync'));
  const manifest = join(root, '.sync/hoisted');
  writeFileSync(manifest, `# Keep this header\n${entries}`);
  return { root, manifest };
}

await test('main replay migrates the old name once and preserves manifest comments', async () => {
  const f = fixture();
  try {
    await hoist({ fromManifest: f.manifest, into: f.root });
    assert.deepEqual(readManifest(f.manifest), [{ name: 'co-plan', harness: 'codex', ref: 'main' }]);
    assert.ok(readFileSync(f.manifest, 'utf8').startsWith('# Keep this header\n'));
    assert.ok(existsSync(join(f.root, '.agents/skills/co-plan/SKILL.md')));
    await hoist({ fromManifest: f.manifest, into: f.root });
    assert.equal(readManifest(f.manifest).length, 1);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('an existing replacement registration wins and does not create a duplicate', async () => {
  const f = fixture('co-plan\tcodex\tmain\ngrill-with-docs\tcodex\tmain\n');
  try {
    await hoist({ fromManifest: f.manifest, into: f.root });
    assert.deepEqual(readManifest(f.manifest), [{ name: 'co-plan', harness: 'codex', ref: 'main' }]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('plan resolves the current name without changing the manifest or destination', async () => {
  const f = fixture();
  const before = readFileSync(f.manifest, 'utf8');
  try {
    const plan = await hoist({ fromManifest: f.manifest, into: f.root, plan: true });
    assert.ok('sources' in plan && plan.sources.some(s => s.path === 'skills/co-plan.md'));
    assert.equal(readFileSync(f.manifest, 'utf8'), before);
    assert.ok(!existsSync(join(f.root, 'skills')));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('historical pins need an explicit migration and never silently fetch the new path', async () => {
  const f = fixture('grill-with-docs\tcodex\tv1.0.0\n');
  const before = readFileSync(f.manifest, 'utf8');
  try {
    await assert.rejects(hoist({ fromManifest: f.manifest, into: f.root }),
      /pinned to v1\.0\.0[\s\S]*--names co-plan[\s\S]*--ref main/);
    assert.equal(readFileSync(f.manifest, 'utf8'), before);
    assert.ok(!existsSync(join(f.root, 'skills')));
    const plan = await hoist({ fromManifest: f.manifest, into: f.root, ref: 'main', refExplicit: true, plan: true });
    assert.ok('sources' in plan && plan.sources.some(s => s.path === 'skills/co-plan.md' && s.ref === 'main'));
    assert.equal(readFileSync(f.manifest, 'utf8'), before);
    await hoist({ fromManifest: f.manifest, into: f.root, ref: 'main', refExplicit: true });
    assert.deepEqual(readManifest(f.manifest), [{ name: 'co-plan', harness: 'codex', ref: 'main' }]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('explicitly re-hoisting co-plan retires a legacy pinned registration', async () => {
  const f = fixture('grill-with-docs\tcodex\tv1.0.0\n');
  try {
    await hoist({ names: 'co-plan', harness: 'codex', into: f.root, ref: 'main', refExplicit: true });
    assert.deepEqual(readManifest(f.manifest), [{ name: 'co-plan', harness: 'codex', ref: 'main' }]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('an old registry keeps the old name and historical source path', async () => {
  const f = fixture('grill-with-docs\tcodex\tv1.0.0\n');
  const source = join(f.root, 'old-source');
  try {
    mkdirSync(join(source, '.claude/skills'), { recursive: true });
    writeFileSync(join(source, '.claude/skills/RESOLVER.md'),
      readFileSync('.claude/skills/RESOLVER.md', 'utf8').replaceAll('co-plan', 'grill-with-docs'));
    const plan = await hoist({ fromManifest: f.manifest, into: f.root, srcRoot: source, plan: true });
    assert.ok('sources' in plan && plan.sources.some(s => s.path === 'skills/grill-with-docs.md' && s.ref === 'v1.0.0'));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

await test('consumer sync migrates main manifests and still reports the old Pi wrapper', () => {
  const f = fixture();
  try {
    execFileSync('git', ['init', '--quiet', f.root]);
    writeFileSync(join(f.root, '.sync/policy.yaml'), 'files:\n  copy:\n    - THIRD_PARTY_NOTICES.txt\nskills:\n  manifest: .sync/hoisted\n');
    const oldPi = '.pi/skills/grill-with-docs/SKILL.md';
    mkdirSync(join(f.root, '.pi/skills/grill-with-docs'), { recursive: true });
    writeFileSync(join(f.root, oldPi), 'old skill\n');
    const args = ['tools/sync/run.ts', '--into', f.root, `--scaffold-root=${resolve('.')}`];
    const before = readFileSync(f.manifest, 'utf8');
    const dry = execFileSync(process.execPath, [...args, '--check'], { encoding: 'utf8' });
    assert.match(dry, /would-replay/);
    assert.equal(readFileSync(f.manifest, 'utf8'), before);
    const result = execFileSync(process.execPath, args, { encoding: 'utf8' });
    assert.match(result, /\.pi\/skills\/grill-with-docs\/SKILL\.md\s+→\s+\.pi\/skills\/co-plan\/SKILL\.md/);
    assert.deepEqual(readManifest(f.manifest), [{ name: 'co-plan', harness: 'codex', ref: 'main' }]);
    assert.ok(existsSync(join(f.root, '.agents/skills/co-plan/SKILL.md')));
    assert.ok(existsSync(join(f.root, oldPi)));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
