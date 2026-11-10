#!/usr/bin/env node
// A lock left by a holder that died mid-transaction (SIGKILL, a caller's `timeout`) is reclaimed;
// a lock held by a live process never is.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { holderIsDead, parseLockRecord } from './queue-io.ts';
import { humanEnv } from './queue-task-origin.ts';

const CLI = fileURLToPath(new URL('./queue.ts', import.meta.url));

function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(child.stdout); // the child has exited, so this PID is (almost certainly) free
}

// Unit: the record parser and the holder check.
assert.deepEqual(parseLockRecord('pid=42 acquiredAt=2026-11-10T09:39:30.933Z\n'), { pid: 42, acquiredAt: Date.parse('2026-11-10T09:39:30.933Z') });
assert.equal(parseLockRecord('garbage'), null, 'an unreadable record is never reclaimed');
assert.equal(holderIsDead({ pid: process.pid, acquiredAt: Date.now() }), false, 'a live holder is alive');
assert.equal(holderIsDead({ pid: deadPid(), acquiredAt: Date.now() }), true, 'an exited holder is dead');
if (existsSync('/proc/self/stat')) {
  assert.equal(holderIsDead({ pid: process.pid, acquiredAt: 0 }), true, 'a PID that started after the lock was taken is a reused PID');
}
console.log('queue-lock-reclaim: holder checks PASS');

// End to end: a stale lock from a dead holder no longer wedges the CLI (it used to wait 60 s, then fail).
const dir = mkdtempSync(join(tmpdir(), 'queue-lock-reclaim-'));
try {
  const file = join(dir, 'queue.md');
  writeFileSync(file, '# Work Queue\n\n');
  const lock = join(dir, 'queue.db.lock');
  writeFileSync(lock, `pid=${deadPid()} acquiredAt=${new Date().toISOString()}\n`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [CLI, 'add', 'after a dead holder'], { env: { ...humanEnv(), QUEUE_FILE: file }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 20_000, 'reclaimed promptly, not after the 60 s wait');
  assert.match(result.stderr, /reclaimed lock from dead holder/);
  assert.equal(existsSync(lock), false, 'the lock is released after the transaction');
  console.log('queue-lock-reclaim: dead holder reclaimed end to end PASS');
} finally { rmSync(dir, { recursive: true, force: true }); }
