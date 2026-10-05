#!/usr/bin/env node
// Real cross-process SQLite contention at the console's GET entry points.
import { strict as check } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './queue-console.ts';

function assert(label: string, condition: boolean, detail = ''): void {
  check.ok(condition, detail ? label + ': ' + detail : label);
  console.log('  pass  ' + label);
}

const dir = mkdtempSync(join(tmpdir(), 'queue-console-contention-'));
const file = join(dir, 'queue.md');
writeFileSync(file, '- [ ] task-001 — first\n');
process.env.QUEUE_FILE = file;
const server = startServer(0);
try {
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  const base = 'http://127.0.0.1:' + port;
  // Keep independent refresh sockets out of the server's five-second idle pool.
  const initial = await fetch(base + '/api/queue', { headers: { connection: 'close' } });
  check.equal(initial.status, 200);
  await initial.json();
  // A CLI-side transaction can outlive SQLite's five-second busy timeout.
  // Refresh data routes while it holds the actual queue write lock.
  const writer = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withStore, readStore, writeStore } from ${JSON.stringify(new URL('./queue-db.ts', import.meta.url).href)};
    import { withLock, dbFile } from ${JSON.stringify(new URL('./queue-io.ts', import.meta.url).href)};
    import { addTask } from ${JSON.stringify(new URL('./queue-model.ts', import.meta.url).href)};
    import { appendFileSync } from 'node:fs';
    withLock(() => withStore(dbFile(), (db, fresh, defer) => {
      writeStore(db, addTask(readStore(db), 'Concurrent CLI write'));
      defer(() => appendFileSync(${JSON.stringify(join(dir, 'committed'))}, 'once'));
      process.stdout.write('locked\\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
    }));
  `], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let writerError = '';
  writer.stderr.on('data', chunk => { writerError += String(chunk); });
  const writerExit = new Promise<number | null>((resolve, reject) => {
    writer.once('error', reject);
    writer.once('exit', resolve);
  });
  await new Promise<void>((resolve, reject) => {
    writer.stdout.once('data', () => resolve());
    writer.once('error', reject);
    writer.once('exit', code => reject(new Error(`writer exited before locking: ${code} ${writerError}`)));
  });
  const refreshed = await Promise.all(['/api/queue', '/api/lanes']
    .map(route => fetch(`${base}${route}`, { headers: { connection: 'close' } })));
  assert('overlapping GET refreshes survive a CLI write beyond busy_timeout',
    refreshed.every(response => response.status === 200));
  const concurrentState = await refreshed[0].json() as { tasks: { title: string }[] };
  assert('GET observes the committed concurrent CLI task exactly once',
    concurrentState.tasks.filter(task => task.title === 'Concurrent CLI write').length === 1);
  assert('concurrent CLI write commits successfully', await writerExit === 0, writerError);
  assert('post-commit effect ran', readFileSync(join(dir, 'committed'), 'utf8') === 'once');
  assert('CLI sidecar lock released', !existsSync(join(dir, 'queue.db.lock')));

  // Persistent contention exhausts both attempts, but only this request fails.
  const blocker = spawn(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(${JSON.stringify(join(dir, 'queue.db'))});
    db.exec('BEGIN IMMEDIATE');
    process.stdout.write('locked\\n');
    setTimeout(() => db.close(), 12000);
  `], { stdio: ['ignore', 'pipe', 'ignore'] });
  const blockerExit = new Promise<number | null>((resolve, reject) => {
    blocker.once('exit', resolve);
    blocker.once('error', reject);
  });
  await new Promise<void>((resolve, reject) => {
    blocker.stdout.once('data', () => resolve());
    blocker.once('error', reject);
    blocker.once('exit', () => reject(new Error('blocker exited before locking')));
  });
  const blockedAt = Date.now();
  const blocked = await fetch(`${base}/api/queue`, { headers: { connection: 'close' } });
  const blockedBody = await blocked.json() as { error?: string };
  assert('persistent contention returns a visible error within the retry budget',
    blocked.status === 500 && /database is locked/.test(blockedBody.error ?? '')
    && Date.now() - blockedAt < 11500);
  assert('blocking transaction exits normally', await blockerExit === 0);
  assert('server recovers after exhausted SQLite contention',
    (await fetch(`${base}/api/queue`)).status === 200);
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  delete process.env.QUEUE_FILE;
  rmSync(dir, { recursive: true, force: true });
}
console.log('queue-console-concurrency: concurrent write, bounded contention and recovery PASS');
