#!/usr/bin/env node
// Architectural contribution is an executable task prompt choice; it never grants release authority.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { humanEnv } from './queue-task-origin.ts';
import { newTask, fieldPatch, parseQueue, serializeQueue, addTask, architectureGuidance } from './queue-model.ts';
import { taskOverrides, parse } from './queue-cli-args.ts';
import { withStore, writeStore, readStore } from './queue-db.ts';
import { applyOp, consoleState, startServer } from './queue-console.ts';
const dir = mkdtempSync(join(tmpdir(), 'queue-architecture-'));
const modes = ['builder-led', 'collaborative', 'model-led'] as const;
try {
  assert.equal(newTask('task-001', 'legacy').architecture, 'collaborative');
  assert.equal(parseQueue('- [ ] legacy').tasks[0].architecture, 'collaborative');
  const cli = (...args: string[]) => spawnSync(process.execPath, [fileURLToPath(new URL('queue.ts', import.meta.url)), ...args], {
    env: { ...humanEnv(), QUEUE_FILE: join(dir, 'cli.md') }, encoding: 'utf8',
  });
  for (const mode of modes) {
    const q = addTask(parseQueue(''), 'architecture choice', taskOverrides(parse(['--architecture', mode])));
    assert.deepEqual(fieldPatch('architecture', mode), { architecture: mode });
    assert.equal(parseQueue(serializeQueue(q)).tasks[0].architecture, mode);
    const file = join(dir, `${mode}.db`);
    withStore(file, db => writeStore(db, q));
    assert.equal(withStore(file, readStore).tasks[0].architecture, mode);
    assert.deepEqual(consoleState(q).architectureModes, modes);
    assert.equal(consoleState(q).defaultArchitecture, 'collaborative');
    assert.equal(consoleState(q).architectureGuidance[mode], architectureGuidance(mode));
    const op = applyOp(q, { op: 'set', id: 'task-001', fields: { architecture: mode } });
    assert.ok(!('error' in op));
    assert.equal(op.queue.tasks[0].architecture, mode);
    assert.equal(cli('add', `task ${mode}`, '--architecture', mode).status, 0);
    // The CLI is the stable rendering interface; consumers may split model and prompt modules.
    const id = 'task-001';
    assert.equal(cli('set', id, 'architecture', mode).status, 0);
    const claim = cli('claim', id, '--worker', 'architecture-test');
    assert.equal(claim.status, 0, claim.stderr);
    assert.match(claim.stdout, new RegExp(`architecture: ${mode}`));
    assert.ok(claim.stdout.includes(architectureGuidance(mode)));
    assert.match(claim.stdout, /validation, security and compatibility checks remain mandatory/);
    assert.match(claim.stdout, /release authority is unchanged/);
    assert.equal(cli('release', id, '--worker', 'architecture-test').status, 0);
  }
  assert.equal(cli('set', 'task-001', 'architecture', 'builder-led').status, 0);
  assert.match(architectureGuidance('builder-led'), /Follow the builder's supplied architecture/);
  assert.match(architectureGuidance('collaborative'), /Propose architectural tradeoffs/);
  assert.match(architectureGuidance('model-led'), /Own architectural investigation, decisions and checks/);
  assert.throws(() => fieldPatch('architecture', 'invented'), /architecture/);
  assert.throws(() => parseQueue('- [ ] bad\n  - architecture: invented'), /architecture/);
  assert.ok('error' in applyOp(parseQueue('- [ ] task-001 — existing'), { op: 'set', id: 'task-001', fields: { architecture: 'invented' } }));
  assert.notEqual(cli('set', 'task-001', 'architecture', 'invented').status, 0);
  assert.match(cli('show', 'task-001').stdout, /architecture: builder-led/);
  assert.equal(cli('set', 'task-001', 'architecture', 'model-led').status, 0);
  assert.match(readFileSync(join(dir, 'cli.md'), 'utf8'), /architecture: model-led/);
  const claim = cli('claim', 'task-001', '--worker', 'architecture-test');
  assert.equal(claim.status, 0);
  assert.match(claim.stdout, /architecture: model-led/);
  assert.match(claim.stdout, /Own architectural investigation, decisions and checks/);
  const template = readFileSync(fileURLToPath(new URL('queue-console.template.html', import.meta.url)), 'utf8');
  assert.match(template, /help.textContent = S.architectureGuidance\[select.value\]/);
  assert.match(template, /architectureOptions\(S.defaultArchitecture\)/);
  const file = join(dir, 'legacy.db');
  withStore(file, db => writeStore(db, addTask(parseQueue(''), 'legacy')));
  const legacy = new DatabaseSync(file);
  legacy.exec('ALTER TABLE tasks DROP COLUMN architecture');
  legacy.close();
  assert.equal(withStore(file, readStore).tasks[0].architecture, 'collaborative');
  withStore(file, db => assert.throws(() => db.prepare("UPDATE tasks SET architecture = 'invented'").run(), /CHECK/));
  const oldQueueFile = process.env.QUEUE_FILE;
  process.env.QUEUE_FILE = join(dir, 'cli.md');
  const server = startServer(0);
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    const state = await (await fetch(`${url}/api/queue`)).json() as ReturnType<typeof consoleState>;
    assert.deepEqual(state.architectureModes, modes);
    assert.equal(state.architectureGuidance['model-led'], architectureGuidance('model-led'));
    const result = await fetch(`${url}/api/op`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'set', id: 'task-001', fields: { architecture: 'builder-led' } }),
    });
    assert.equal(result.status, 200);
    assert.match(cli('show', 'task-001').stdout, /architecture: builder-led/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (oldQueueFile === undefined) delete process.env.QUEUE_FILE;
    else process.env.QUEUE_FILE = oldQueueFile;
  }
  console.log('queue architecture: passed');
} finally { rmSync(dir, { recursive: true, force: true }); }
