#!/usr/bin/env node
// `queue check-view` flags a committed queue.md that no longer matches the store, and
// `queue set <id> accept <spec>` warns when the spec is missing or untracked (worker lanes
// branched from main cannot read it). Runs the CLI inside a throwaway git repo.
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'queue-view-'));
const file = join(dir, '.agent', 'queue', 'queue.md');
const cli = fileURLToPath(new URL('./queue.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  cwd: dir, env: { ...process.env, QUEUE_FILE: file }, encoding: 'utf8',
});
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
try {
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Queue Test');

  assert.equal(run('add', 'First task').status, 0);
  assert.notEqual(run('check-view').status, 0, 'an uncommitted view is reported');

  git('add', '.agent/queue/queue.md');
  git('commit', '-q', '-m', 'queue view');
  assert.equal(run('check-view').status, 0, 'a committed, current view passes');

  assert.equal(run('claim', 'task-001', '--worker', 'lane-a').status, 0);
  const stale = run('check-view');
  assert.notEqual(stale.status, 0, 'a claim that was never committed makes the view stale');
  assert.match(stale.stderr, /stale/);

  git('add', '.agent/queue/queue.md');
  git('commit', '-q', '-m', 'queue view after claim');
  assert.equal(run('check-view').status, 0, 'committing the re-render clears it');

  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'spec.md'), '# spec\n');
  const untracked = run('set', 'task-001', 'accept', 'docs/spec.md');
  assert.equal(untracked.status, 0);
  assert.match(untracked.stderr, /not committed/, 'an untracked spec warns');

  const missing = run('set', 'task-001', 'accept', 'docs/nope.md');
  assert.match(missing.stderr, /does not exist/, 'a missing spec warns');

  git('add', 'docs/spec.md');
  git('commit', '-q', '-m', 'spec');
  const tracked = run('set', 'task-001', 'accept', 'docs/spec.md');
  assert.doesNotMatch(tracked.stderr, /warning/, 'a committed spec does not warn');

  const prose = run('set', 'task-001', 'accept', 'metrics emitted on request');
  assert.doesNotMatch(prose.stderr, /warning/, 'plain acceptance text does not warn');
  console.log('queue-view: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
