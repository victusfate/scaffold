#!/usr/bin/env node
// The SQLite store is the queue's source of truth: ids are a primary key, the
// counter never recycles, and queue.md is a rendered view of the store.
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  assert.ok(!existsSync(join(dir, '.gitignore')), 'an explicit QUEUE_FILE store writes no .gitignore');
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
  rmSync(view);
  const missing = run('import');
  assert.notEqual(missing.status, 0, 'importing a missing view must not wipe the store');
  assert.match(missing.stderr, /no view to import/);
  assert.match(run('show', 'task-1111').stdout, /zeta/, 'store intact');
  console.log('queue-db: migration and import renumber duplicate ids with a report PASS');
} finally {
  rmSync(migrateDir, { recursive: true, force: true });
}

// Slice 3 — the view is never silently overwritten after a hand edit, and several
// views (one per worktree) can share one store.
const guardDir = mkdtempSync(join(tmpdir(), 'queue-db-guard-'));
const store = join(guardDir, 'shared.db');
const viewA = join(guardDir, 'a', 'queue.md');
const viewB = join(guardDir, 'b', 'queue.md');
const runIn = (viewFile: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, QUEUE_FILE: viewFile, QUEUE_DB: store }, encoding: 'utf8',
});
try {
  assert.equal(runIn(viewA, 'add', 'from A').status, 0);
  // A view path the store has never rendered (a fresh checkout's git copy) is replaced.
  mkdirSync(dirname(viewB), { recursive: true });
  writeFileSync(viewB, '- [ ] task-001 — stale git copy\n');
  assert.equal(runIn(viewB, 'add', 'from B').status, 0);
  assert.deepEqual(parseQueue(readFileSync(viewB, 'utf8')).tasks.map(t => `${t.id} ${t.title}`),
    ['task-001 from A', 'task-002 from B'], 'one store, one id counter across views');
  // A's view is now stale but unedited, so A may re-render it.
  assert.equal(runIn(viewA, 'add', 'from A again').status, 0);
  assert.equal(parseQueue(readFileSync(viewA, 'utf8')).tasks.length, 3);

  const edited = readFileSync(viewA, 'utf8') + '- [ ] task-001 — merged-in duplicate\n';
  writeFileSync(viewA, edited);
  const refused = runIn(viewA, 'add', 'blocked');
  assert.notEqual(refused.status, 0, 'a save over a hand-edited view fails closed');
  assert.match(refused.stderr, /changed since the store last rendered.*import --dry-run.*queue\.ts render/s);
  assert.doesNotMatch(refused.stderr, /at .*queue-db\.ts/, 'an actionable message, not a stack trace');
  assert.equal(readFileSync(viewA, 'utf8'), edited, 'hand edit preserved');
  assert.equal(runIn(viewB, 'show', 'task-004').status, 1, 'refused save wrote nothing');

  assert.equal(runIn(viewA, 'render').status, 0);
  assert.doesNotMatch(readFileSync(viewA, 'utf8'), /merged-in duplicate/, 'render discards the edit');
  assert.equal(runIn(viewA, 'add', 'unblocked').status, 0);
  console.log('queue-db: hand-edited views fail closed; views share one store PASS');
} finally {
  rmSync(guardDir, { recursive: true, force: true });
}

// Review fixes — import must not silently drop or regress work from a stale view,
// renumbered already-issued ids carry their dependents along, and a `.db` view
// never aliases its own store.
const staleDir = mkdtempSync(join(tmpdir(), 'queue-db-stale-'));
const sv = join(staleDir, 'queue.md');
const rs = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, QUEUE_FILE: sv }, encoding: 'utf8',
});
try {
  rs('add', 'A'); rs('add', 'B');
  const stale = readFileSync(sv, 'utf8');
  rs('add', 'C');
  assert.equal(rs('claim', 'task-001', '--worker', 'w1').status, 0);
  writeFileSync(sv, stale); // e.g. `git checkout` restored an older committed view
  assert.notEqual(rs('add', 'D').status, 0);
  const dry = rs('import', '--dry-run');
  assert.match(dry.stdout, /task-003 — C \(removed\)/);
  assert.match(dry.stdout, /task-001 — A: active → pending/);
  const refused = rs('import');
  assert.notEqual(refused.status, 0, 'import refuses to drop or regress work without --force');
  assert.match(refused.stderr, /--force/);
  assert.match(rs('show', 'task-003').stdout, /C/, 'refused import changed nothing');
  assert.equal(rs('import', '--force').status, 0);
  assert.equal(rs('show', 'task-003').status, 1);
  assert.match(readFileSync(join(staleDir, 'log.md'), 'utf8'), /task-003 — C \(removed\)/);

  // A recycled id is unambiguous (the store no longer has it): its dependents follow the rename.
  writeFileSync(sv, '- [ ] task-003 — Merged prereq\n- [ ] task-009 — dependent\n  - deps: task-003\n');
  assert.equal(rs('import', '--force').status, 0);
  assert.match(rs('show', 'task-009').stdout, /deps: task-010/);
  assert.match(rs('show', 'task-010').stdout, /Merged prereq/);

  process.env.QUEUE_FILE = join(staleDir, 'odd.db');
  assert.equal(dbFile(), join(staleDir, 'odd.db.db'), 'a .db view gets a distinct store');
  delete process.env.QUEUE_FILE;
  console.log('queue-db: import reports and guards removals/regressions; recycled deps follow PASS');
} finally {
  rmSync(staleDir, { recursive: true, force: true });
}
