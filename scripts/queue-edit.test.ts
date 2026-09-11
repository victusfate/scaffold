#!/usr/bin/env node
// Exercise persisted CLI edits: title/note edits must update queue.md.
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseQueue } from './queue-model.ts';

const dir = mkdtempSync(join(tmpdir(), 'queue-edit-'));
const file = join(dir, 'queue.md');
const cli = fileURLToPath(new URL('./queue.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, QUEUE_FILE: file }, encoding: 'utf8',
});
try {
  assert.equal(run('add', 'Old instructions').status, 0);
  assert.equal(run('set', 'task-001', 'title', 'Current instructions').status, 0);
  assert.equal(run('set', 'task-001', 'note', 'Evidence reviewed').status, 0);
  const saved = readFileSync(file, 'utf8');
  const task = parseQueue(saved).tasks[0];
  assert.equal(task.title, 'Current instructions');
  assert.equal(task.note, 'Evidence reviewed');
  assert.equal(task.status, 'pending');
  for (const [field, value] of [['title', ' '], ['typo', 'ignored']]) {
    assert.notEqual(run('set', 'task-001', field, value).status, 0);
    assert.equal(readFileSync(file, 'utf8'), saved);
  }
  assert.equal(run('add', 'Gate task').status, 0);
  const beforeGate = readFileSync(file, 'utf8');
  assert.equal(run('gate', 'task-002', '--dry-run').status, 0);
  assert.equal(readFileSync(file, 'utf8'), beforeGate);
  assert.equal(run('gate', 'task-002').status, 0);
  assert.deepEqual(parseQueue(readFileSync(file, 'utf8')).tasks[0].dependsOn, ['task-002']);
  const gated = readFileSync(file, 'utf8');
  assert.equal(run('ungate', 'task-002', '--dry-run').status, 0);
  assert.equal(readFileSync(file, 'utf8'), gated);
  assert.equal(run('ungate', 'task-002', '--keep-gate').status, 0);
  const ungated = parseQueue(readFileSync(file, 'utf8'));
  assert.deepEqual(ungated.tasks[0].dependsOn, []);
  assert.equal(ungated.tasks[1].status, 'pending');
  assert.equal(run('ungate', 'task-002').status, 0);
  assert.equal(parseQueue(readFileSync(file, 'utf8')).tasks[1].status, 'done');
  console.log('queue-edit: persisted edits, invalid edits, and gate lifecycle PASS');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
