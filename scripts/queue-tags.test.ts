#!/usr/bin/env node
// Task tags: set and add through the CLI, round-trip through the store and view, `list --tag` filters,
// and a store written before tags existed still loads (every task untagged).
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseQueue } from './queue-model.ts';

const dir = mkdtempSync(join(tmpdir(), 'queue-tags-'));
const file = join(dir, 'queue.md');
const cli = fileURLToPath(new URL('./queue.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, QUEUE_FILE: file }, encoding: 'utf8',
});
try {
  // add --tags and set <id> tags both persist, and the view mirrors them.
  assert.equal(run('add', 'Speed up the test gate', '--tags', 'group:speed, perf').status, 0);
  assert.equal(run('add', 'Camera flips while panning').status, 0);
  assert.equal(run('set', 'task-002', 'tags', 'owner-report').status, 0);
  const view = parseQueue(readFileSync(file, 'utf8')).tasks;
  assert.deepEqual(view.map(t => t.tags), [['group:speed', 'perf'], ['owner-report']]);

  // list --tag shows only matching tasks; the plain list shows tags as #labels.
  const speed = run('list', '--tag', 'group:speed').stdout;
  assert.match(speed, /Speed up the test gate/);
  assert.doesNotMatch(speed, /Camera flips/);
  assert.match(run('list').stdout, /#owner-report/);

  // Clearing tags removes them.
  assert.equal(run('set', 'task-002', 'tags', '').status, 0);
  assert.deepEqual(parseQueue(readFileSync(file, 'utf8')).tasks[1].tags, []);

  // A store from before tags existed: drop the column, then the CLI migrates it and keeps the tasks.
  const db = new DatabaseSync(join(dir, 'queue.db'));
  db.exec('ALTER TABLE tasks DROP COLUMN tags');
  db.close();
  const listed = run('list');
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /Speed up the test gate/);
  assert.match(listed.stdout, /Camera flips while panning/);
  assert.doesNotMatch(listed.stdout, /#/, 'migrated tasks start untagged');
  assert.equal(run('set', 'task-001', 'tags', 'group:speed').status, 0);
  assert.deepEqual(parseQueue(readFileSync(file, 'utf8')).tasks[0].tags, ['group:speed']);
  console.log('queue-tags: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
