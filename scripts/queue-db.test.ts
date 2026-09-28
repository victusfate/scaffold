#!/usr/bin/env node
// The SQLite store is the queue's source of truth: ids are a primary key, the
// counter never recycles, and queue.md is a rendered view of the store.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, save, dbFile } from './queue-io.ts';
import { addTask, removeTask, parseQueue, newTask } from './queue-model.ts';

const dir = mkdtempSync(join(tmpdir(), 'queue-db-'));
const file = join(dir, 'queue.md');
process.env.QUEUE_FILE = file;
try {
  // Slice 1 — round-trip through the store, view rendered on save.
  assert.equal(dbFile(), join(dir, 'queue.db'));
  let q = load();
  assert.equal(q.tasks.length, 0);
  q = addTask(addTask(q, 'first', { note: 'kept' }), 'second', { dependsOn: ['task-001'] });
  save(q);
  assert.ok(existsSync(dbFile()), 'store created');
  const loaded = load();
  assert.deepEqual(loaded.tasks, q.tasks);
  assert.deepEqual(parseQueue(readFileSync(file, 'utf8')).tasks, q.tasks, 'view mirrors the store');

  // A duplicate id is unrepresentable: the save throws and nothing changes.
  const before = readFileSync(file, 'utf8');
  const dup = { ...loaded, tasks: [...loaded.tasks, { ...newTask('task-001', 'impostor') }] };
  assert.throws(() => save(dup), /duplicate task id task-001/);
  assert.deepEqual(load().tasks, loaded.tasks, 'store unchanged after a rejected save');
  assert.equal(readFileSync(file, 'utf8'), before, 'view unchanged after a rejected save');

  // The counter is monotonic: a removed id is never handed out again. A stale
  // snapshot whose counter lags the store cannot recycle one either.
  save(removeTask(addTask(load(), 'third'), 'task-003'));
  const stale = { ...load(), config: { ...load().config, nextId: 1 } };
  assert.throws(() => save(addTask(stale, 'recycled')), /task-003 was already issued/);
  save(addTask(load(), 'fourth'));
  assert.deepEqual(load().tasks.map(t => t.id), ['task-001', 'task-002', 'task-004']);
  console.log('queue-db: store round-trip, primary key, monotonic ids PASS');
} finally {
  delete process.env.QUEUE_FILE;
  rmSync(dir, { recursive: true, force: true });
}

// Slice 2 — a pre-store view with duplicated ids (the consumer's task-1106…1112
// defect) migrates on first use: later duplicates are renumbered and reported.
const cli = fileURLToPath(new URL('./queue.ts', import.meta.url));
const migrateDir = mkdtempSync(join(tmpdir(), 'queue-db-migrate-'));
const view = join(migrateDir, 'queue.md');
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, QUEUE_FILE: view }, encoding: 'utf8',
});
try {
  writeFileSync(view, [
    '# Work Queue', '', '<!-- queue:config', 'nextId: 1108', '-->', '',
    '- [ ] task-1106 — alpha',
    '- [ ] task-1107 — beta',
    '- [x] task-1106 — gamma',
    '- [ ] task-1107 — delta',
    '  - deps: task-1106',
    '- [ ] epsilon', '',
  ].join('\n'));
  const listed = run('list');
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stderr, /task-1106 → task-1108 — gamma/);
  assert.match(listed.stderr, /task-1107 → task-1109 — delta/);
  assert.match(listed.stderr, /task-1109 deps: task-1106 named a duplicated id/);
  const migrated = parseQueue(readFileSync(view, 'utf8')).tasks;
  assert.deepEqual(migrated.map(t => `${t.id} ${t.title}`), [
    'task-1106 alpha', 'task-1107 beta', 'task-1108 gamma', 'task-1109 delta', 'task-1110 epsilon',
  ]);
  assert.equal(migrated[2].status, 'done', 'renumbering keeps each task intact');
  assert.match(readFileSync(join(migrateDir, 'log.md'), 'utf8'), /task-1106 → task-1108/);

  // `import` applies later hand edits through the same dedupe; --dry-run only reports.
  appendFileSync(view, '- [ ] task-1106 — zeta\n- [ ] task-0005 — recycled\n');
  const dry = run('import', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /task-1106 → task-1111 — zeta/);
  assert.match(dry.stdout, /task-0005 → task-1112 — recycled \(already issued\)/);
  assert.doesNotMatch(run('show', 'task-1111').stdout, /zeta/, 'dry run leaves the store alone');
  const imported = run('import');
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(run('show', 'task-1111').stdout, /zeta/);
  assert.match(run('show', 'task-1112').stdout, /recycled/);
  console.log('queue-db: migration and import renumber duplicate ids with a report PASS');
} finally {
  rmSync(migrateDir, { recursive: true, force: true });
}
