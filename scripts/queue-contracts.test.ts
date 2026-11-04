#!/usr/bin/env node
// Executable contract pointers survive queue storage, CLI and console edits without a parallel classification.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { humanEnv } from './queue-task-origin.ts';
import { newTask, fieldPatch, parseQueue, serializeQueue, addTask, contractPaths } from './queue-model.ts';
import { taskOverrides, parse } from './queue-cli-args.ts';
import { withStore, writeStore, readStore } from './queue-db.ts';
import { applyOp } from './queue-console.ts';
const dir = mkdtempSync(join(tmpdir(), 'queue-contracts-'));
try {
  assert.deepEqual(newTask('task-001', 'legacy').contracts, []);
  assert.deepEqual(parseQueue('- [ ] legacy').tasks[0].contracts, []);
  const refs = ['src/schema.ts', 'test/save-compat.test.ts'];
  assert.deepEqual(fieldPatch('contracts', refs.join(', ')), { contracts: refs });
  assert.deepEqual(contractPaths([...refs, refs[0]]), refs);
  for (const bad of [['schema/a,b.ts'], [' schema/spaced.ts ']]) {
    assert.throws(() => contractPaths(bad), /contracts/, 'reject pointers Markdown cannot round-trip');
  }
  for (const bad of [undefined, 'schema.ts', [true], ['../outside.ts'], ['/etc/passwd'], ['Z:/x.ts'], ['a\\b.ts'], ['a\nb.ts']]) {
    assert.throws(() => contractPaths(bad), /contracts/);
  }
  assert.throws(() => parseQueue('- [ ] invalid\n  - contracts: ../bad.ts'), /contracts/);
  const q = addTask(parseQueue(''), 'schema change', taskOverrides(parse(['--contracts', refs.join(',')])));
  assert.deepEqual(q.tasks[0].contracts, refs);
  assert.deepEqual(parseQueue(serializeQueue(q)).tasks[0].contracts, refs);
  const file = join(dir, 'queue.db');
  withStore(file, db => writeStore(db, q));
  assert.deepEqual(withStore(file, readStore).tasks[0].contracts, refs);
  const old = new DatabaseSync(file);
  old.exec('ALTER TABLE tasks DROP COLUMN contracts');
  old.close();
  assert.deepEqual(withStore(file, readStore).tasks[0].contracts, [], 'legacy SQLite migration invents no contract');
  withStore(file, db => assert.throws(() => db.prepare("UPDATE tasks SET contracts = '{}' ").run(), /CHECK/));
  const cliFile = join(dir, 'cli.md');
  const cli = (...args: string[]) => spawnSync(process.execPath, [fileURLToPath(new URL('queue.ts', import.meta.url)), ...args], {
    env: { ...humanEnv(), QUEUE_FILE: cliFile }, encoding: 'utf8',
  });
  assert.equal(cli('add', 'Schema change', '--contracts', refs.join(',')).status, 0);
  assert.match(cli('show', 'task-001').stdout, /contracts: src\/schema.ts, test\/save-compat.test.ts/);
  const claim = cli('claim', 'task-001', '--worker', 'contracts-test');
  assert.equal(claim.status, 0, claim.stderr);
  assert.match(claim.stdout, /contracts: src\/schema.ts, test\/save-compat.test.ts/);
  assert.equal(cli('set', 'task-001', 'contracts', 'test/other.test.ts').status, 0);
  assert.match(cli('show', 'task-001').stdout, /contracts: test\/other.test.ts/);
  assert.notEqual(cli('set', 'task-001', 'contracts', '../bad.ts').status, 0);
  assert.match(cli('show', 'task-001').stdout, /contracts: test\/other.test.ts/);
  assert.match(readFileSync(cliFile, 'utf8'), /contracts: test\/other.test.ts/);
  const op = applyOp(q, { op: 'set', id: 'task-001', fields: { contracts: 'src/next-schema.ts' } });
  assert.ok(!('error' in op));
  assert.deepEqual(op.queue.tasks[0].contracts, ['src/next-schema.ts']);
  assert.ok('error' in applyOp(q, { op: 'set', id: 'task-001', fields: { contracts: '../bad.ts' } }));
  console.log('queue contracts: passed');
} finally { rmSync(dir, { recursive: true, force: true }); }
