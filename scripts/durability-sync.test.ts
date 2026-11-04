#!/usr/bin/env node
// Exercise the actual managed manifest in an empty consumer, not a mocked file list.
// Usage: node scripts/durability-sync.test.ts. All writes and git operations use temporary repos.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = [
  'scripts/check-import-boundaries.ts', 'scripts/import-boundary-edges.ts',
  'scripts/delivery-rigor.ts', 'scripts/delivery-rigor-cli.ts',
  'scripts/mind-meld.ts', 'scripts/mind-meld-schema.ts', 'scripts/mind-meld-sandbox.ts',
  'scripts/mind-meld-example.ts', 'scripts/mind-meld-viewer.ts', 'skills/mind-meld.md',
  '.agents/skills/mind-meld/SKILL.md', 'lib/linters/ts/.prettierrc.json',
];
const manifest = readFileSync(join(ROOT, '.github/scaffold-files.txt'), 'utf8').split('\n').filter(Boolean);
for (const file of REQUIRED) assert.ok(manifest.includes(file), `${file} must ship to consumers`);
assert.ok(!manifest.includes('.agent/boundaries.json'), 'consumer-owned boundary policy must not be overwritten');

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
  const synced = spawnSync('bash', [join(ROOT, 'bin/sync-from-scaffold.sh')], {
    cwd: consumer, env: { ...process.env, SCAFFOLD_URL: upstream }, encoding: 'utf8',
  });
  assert.equal(synced.status, 0, synced.stdout + synced.stderr);
  for (const file of REQUIRED) assert.ok(existsSync(join(consumer, file)), `synced ${file}`);
  assert.equal(readFileSync(join(consumer, '.agent/boundaries.json'), 'utf8'), policy);
  // The JS/TS indexer uses the consumer's installed TypeScript toolchain.
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
  console.log('durability-sync: actual manifest reaches a clean consumer and preserves its policy');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
