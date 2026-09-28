#!/usr/bin/env node
// The SQLite store is the queue's source of truth: ids are a primary key, the
// counter never recycles, and queue.md is a rendered view of the store.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
