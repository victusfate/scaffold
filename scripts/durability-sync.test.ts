#!/usr/bin/env node
// Exercise the actual managed manifest in an empty consumer, not a mocked file list.
// Usage: node scripts/durability-sync.test.ts. All writes and git operations use temporary repos.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from './typescript-runtime.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = [
  'scripts/check-import-boundaries.ts', 'scripts/import-boundary-edges.ts',
  'scripts/delivery-rigor.ts', 'scripts/delivery-rigor-cli.ts',
  'scripts/mind-meld.ts', 'scripts/mind-meld-schema.ts', 'scripts/mind-meld-sandbox.ts', 'scripts/typescript-runtime.ts',
  'scripts/mind-meld-example.ts', 'scripts/mind-meld-viewer.ts', 'skills/mind-meld.md',
  '.agents/skills/mind-meld/SKILL.md', 'lib/linters/ts/.prettierrc.json',
];
const listed = readFileSync(join(ROOT, '.github/scaffold-files.txt'), 'utf8').split('\n').filter(Boolean);
// Scaffold itself ships every listed file. A consumer keeps some local (.scaffold-keep) or never had them,
// so there the simulated upstream uses only the managed files that exist.
const inScaffold = (() => { try { return (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name?: unknown }).name === 'scaffold'; } catch { return false; } })();
const manifest = inScaffold ? listed : listed.filter(file => existsSync(join(ROOT, file)));
if (inScaffold) assert.deepEqual(listed.filter(file => !existsSync(join(ROOT, file))), [], 'every listed file exists in scaffold');
for (const file of REQUIRED) assert.ok(listed.includes(file), `${file} must ship to consumers`);
assert.ok(!listed.includes('.agent/boundaries.json'), 'consumer-owned boundary policy must not be overwritten');

const scratch = mkdtempSync(join(tmpdir(), 'durability-sync-'));
const upstream = join(scratch, 'upstream');
const consumer = join(scratch, 'consumer');
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function init(path: string): void {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'config', 'user.name', 'Sync acceptance');
  git(path, 'config', 'user.email', 'sync@example.invalid');
  git(path, 'config', 'commit.gpgsign', 'false');
}
try {
  init(upstream);
  for (const file of manifest) {
    mkdirSync(dirname(join(upstream, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(upstream, file));
  }
  git(upstream, 'add', '--', ...manifest);
  git(upstream, 'commit', '-qm', 'Snapshot actual managed files');
  init(consumer);
  mkdirSync(join(consumer, '.agent'));
  const policy = '{"version":1,"rules":[{"from":["core/**"],"deny":["ui/**"],"reason":"Core owns its behavior"}]}\n';
  writeFileSync(join(consumer, '.agent/boundaries.json'), policy);
  mkdirSync(join(consumer, 'core'));
  writeFileSync(join(consumer, 'core/state.ts'), 'export const initialState = { hp: 10 };\n');
  // Installing unrelated client plugins is outside this isolated consumer probe.
  writeFileSync(join(consumer, '.scaffold-keep'), 'bin/ensure-plugins.sh\n');
  git(consumer, 'add', '--', '.agent/boundaries.json', '.scaffold-keep', 'core/state.ts');
  git(consumer, 'commit', '-qm', 'Consumer-owned policy');
  const synced = spawnSync('bash', [join(ROOT, 'bin/bootstrap.sh'), '--run'], {
    cwd: consumer, env: { ...process.env, SCAFFOLD_URL: upstream }, encoding: 'utf8',
  });
  assert.equal(synced.status, 0, synced.stdout + synced.stderr);
  for (const file of REQUIRED) assert.ok(existsSync(join(consumer, file)), `synced ${file}`);
  assert.equal(readFileSync(join(consumer, '.agent/boundaries.json'), 'utf8'), policy);
  assert.ok(!existsSync(join(consumer, 'package.json')), 'sync must not require a root package');
  // An outer `node --test` sets NODE_TEST_CONTEXT for children, which would route this nested run's report to the
  // parent instead of stdout (consumers run their test files under `node --test`).
  const bareEnv: NodeJS.ProcessEnv = { ...process.env, SCAFFOLD_TYPESCRIPT_DIR: '' };
  delete bareEnv.NODE_TEST_CONTEXT;
  const bareTests = spawnSync(process.execPath, ['--test', 'scripts/check-import-boundaries.test.ts', 'scripts/mind-meld.test.ts'], {
    cwd: consumer, env: bareEnv, encoding: 'utf8',
  });
  assert.equal(bareTests.status, 0, bareTests.stdout + bareTests.stderr);
  assert.match(bareTests.stdout, /typescript is not installed/);
  for (const [tool, args] of [['mind-meld', ['index']], ['check-import-boundaries', []]] as const) {
    const unavailable = spawnSync(process.execPath, [join(consumer, `scripts/${tool}.ts`), ...args], {
      cwd: consumer, env: bareEnv, encoding: 'utf8',
    });
    assert.equal(unavailable.status, 1, unavailable.stdout + unavailable.stderr);
    assert.match(unavailable.stderr, /needs the typescript package/);
  }
  // The JS/TS indexer uses the consumer's installed TypeScript toolchain, which is optional: without it, mind
  // meld's index refuses with an install hint and the boundary checks are left to repos that have it.
  if (await loadTypeScript()) {
    symlinkSync(join(ROOT, 'node_modules'), join(consumer, 'node_modules'), 'dir');
    const result = spawnSync(process.execPath, [join(consumer, 'scripts/mind-meld.ts'), 'index'], {
      cwd: consumer, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((JSON.parse(result.stdout) as { version: number }).version, 1);
    const boundary = spawnSync(process.execPath, [join(consumer, 'scripts/check-import-boundaries.ts')], {
      cwd: consumer, encoding: 'utf8',
    });
    assert.equal(boundary.status, 0, boundary.stderr);
    mkdirSync(join(consumer, 'ui'));
    writeFileSync(join(consumer, 'ui/view.ts'), 'export const view = "experimental";\n');
    writeFileSync(join(consumer, 'core/state.ts'), 'export { view } from "../ui/view.ts";\n');
    const forbidden = spawnSync(process.execPath, [join(consumer, 'scripts/check-import-boundaries.ts')], {
      cwd: consumer, encoding: 'utf8',
    });
    assert.equal(forbidden.status, 1, forbidden.stderr);
    assert.match(forbidden.stdout, /forbidden import ui\/view\.ts/);
  } else {
    const result = spawnSync(process.execPath, [join(consumer, 'scripts/mind-meld.ts'), 'index'], { cwd: consumer, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /needs the typescript package/);
  }
  console.log('durability-sync: actual manifest reaches a clean consumer and preserves its policy');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
