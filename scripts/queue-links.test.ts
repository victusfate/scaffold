#!/usr/bin/env node
// A task links only a live working branch (empty = main): `queue links` reports links to branches
// that no longer exist, and `--fix` clears them without changing any task's status.
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, save } from './queue-io.ts';
import { addTask, setField, setTaskStatus, type Queue } from './queue-model.ts';
import { cmdLinks, danglingLinks } from './queue-links.ts';

const dir = mkdtempSync(join(tmpdir(), 'queue-links-'));
process.env.QUEUE_FILE = join(dir, 'queue.md');
try {
  let q: Queue = load();
  q = addTask(q, 'live'); q = addTask(q, 'gone'); q = addTask(q, 'on main'); q = addTask(q, 'finished');
  const [live, gone, onMain, finished] = q.tasks.map(t => t.id);
  q = setField(q, live, { branch: 'feat/live' });
  q = setField(q, gone, { branch: 'feat/merged-and-deleted' });
  q = setField(q, finished, { branch: 'feat/old' });
  q = setTaskStatus(q, gone, 'active');
  save(q);
  const branches = new Set(['main', 'feat/live']);

  // A done task is history. Checked in memory: consumers may require completion evidence before a
  // done task can be saved, which this fixture doesn't need to model.
  assert.deepEqual(danglingLinks(setTaskStatus(load(), finished, 'done'), branches), [{ id: gone, branch: 'feat/merged-and-deleted' }],
    'only an open task linking a missing branch is dangling (empty = main; done tasks are history)');
  assert.equal(cmdLinks(load(), false, branches), 1, 'report mode fails closed on a dangling link');
  assert.equal(load().tasks.find(t => t.id === gone)!.branch, 'feat/merged-and-deleted', 'report mode changes nothing');

  assert.equal(cmdLinks(load(), true, branches), 0);
  const after = load();
  assert.ok(!after.tasks.find(t => t.id === gone)!.branch, '--fix clears the dangling link');
  assert.equal(after.tasks.find(t => t.id === gone)!.status, 'active', '--fix keeps the task status');
  assert.equal(after.tasks.find(t => t.id === live)!.branch, 'feat/live', 'a live link is kept');
  assert.ok(!after.tasks.find(t => t.id === onMain)!.branch, 'an unlinked task stays on main');
  assert.equal(cmdLinks(after, false, branches), 0, 'clean after the fix');
  console.log('queue-links.test: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }
