// Real harmless detached-process lifecycle checks on every supported OS.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const cli = fileURLToPath(new URL('./agent-loop.ts', import.meta.url));
interface Status { runs: number; failures: number; running: boolean; armed: boolean; ended: boolean; output: string; reason: string; log: string; supervisor: string }
function cooperatingChild() {
  return [
    "const {spawnSync}=require('child_process'); const {writeFileSync}=require('fs');",
    "const [cli,cwd,receipt]=process.argv.slice(1);",
    "setTimeout(()=>{const inbox=JSON.parse(spawnSync(process.execPath,[cli,'inbox','--cwd',cwd],{encoding:'utf8'}).stdout);",
    "const id=inbox.pending[0]?.id; if(id){const ack=spawnSync(process.execPath,[cli,'ack','--cwd',cwd,'--id',id,'--outcome','applied'],{encoding:'utf8'}); writeFileSync(receipt,ack.stdout)}},300);",
    'setTimeout(()=>{},700);',
  ].join(' ');
}
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-portable-'));
  const env = { ...process.env, XDG_STATE_HOME: join(cwd, 'state') };
  const call = (args: string[], success = true): Status => {
    const result = spawnSync(process.execPath, [cli, args[0], '--cwd', cwd, ...args.slice(1)], { env, encoding: 'utf8', timeout: 15_000 });
    if (!success) { assert.notEqual(result.status, 0); return {} as Status; }
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as Status;
  };
  const callAsync = (args: string[]) => new Promise<Status>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, args[0], '--cwd', cwd, ...args.slice(1)], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(JSON.parse(stdout) as Status) : reject(new Error(stderr)));
  });
  const start = (script: string, options: string[] = [], args: string[] = []) => call(['start', '--interval', '50ms',
    ...(options.includes('--lifetime') ? [] : ['--lifetime', '20s']), ...options, '--', process.execPath, '-e', script, ...args]);
  const until = async (predicate: (value: Status) => boolean) => {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const value = call(['status']);
      if (predicate(value)) return value;
      await delay(50);
    }
    throw new Error(`Timed out: ${JSON.stringify(call(['status']))}`);
  };
  const cleanup = async () => {
    call(['stop', '--cancel']);
    await until(value => value.ended);
    rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  };
  return { cwd, call, callAsync, start, until, cleanup };
}

void test('external supervisor preserves argv, recurs, rejects duplicates and gracefully stops', async () => {
  const f = fixture();
  const argv = ['two words', "'quotes'", '$HOME; touch BAD', 'line\nbreak', '%i', ''];
  try {
    assert.equal(f.start('console.log(JSON.stringify(process.argv.slice(1))); setTimeout(()=>{},500)', [], argv).armed, true);
    f.call(['start', '--interval', '1s', '--', process.execPath], false);
    await f.until(value => value.runs >= 2 && value.running);
    assert.equal(f.call(['stop']).armed, false);
    const stopped = await f.until(value => value.ended);
    assert.equal(stopped.failures, 0);
    assert.ok(f.call(['logs']).output.includes(JSON.stringify(argv)));
    assert.equal(existsSync(join(f.cwd, 'BAD')), false);
    assert.equal(f.start('process.exit(1)', ['--max-failures', '1']).armed, true);
    assert.equal((await f.until(value => value.ended)).failures, 1);
  } finally { await f.cleanup(); }
});

void test('timeouts kill the active descendant tree and trip the failure limit', async () => {
  const f = fixture();
  try {
    f.start(`require('child_process').spawn(process.execPath, ['-e', "setInterval(()=>require('fs').appendFileSync('ticks','x'),30)"], {stdio:'inherit'}); setInterval(()=>{},100)`, ['--timeout', '400ms', '--max-failures', '1']);
    const ended = await f.until(value => value.ended);
    assert.equal(ended.failures, 1);
    const ticks = readFileSync(join(f.cwd, 'ticks'), 'utf8');
    await delay(200);
    assert.equal(readFileSync(join(f.cwd, 'ticks'), 'utf8'), ticks);
  } finally { await f.cleanup(); }
});

void test('explicit cancel stops the active command and permits restart', async () => {
  const f = fixture();
  try {
    f.start('setInterval(()=>{},100)');
    await f.until(value => value.running);
    f.call(['stop', '--cancel']);
    await f.until(value => value.ended);
    f.start('process.exit(1)', ['--max-failures', '1']);
    assert.equal((await f.until(value => value.ended)).runs, 1);
  } finally { await f.cleanup(); }
});

void test('steering is durable until an acknowledged outcome and rejects a stopped loop', async () => {
  const f = fixture();
  try {
    f.start('setInterval(()=>{},100)');
    await f.until(value => value.running);
    const messageFile = join(f.cwd, 'message.txt');
    writeFileSync(messageFile, 'file message');
    f.call(['steer', '--message', ' ', '--message-file', messageFile], false);
    f.call(['steer', '--message', ' '], false);
    const queued = f.call(['steer', '--message', 'preserve this\nmessage']) as unknown as { id: string; pending: number };
    assert.equal(queued.pending, 1);
    const first = f.call(['inbox']) as unknown as { pending: Array<{ id: string; message: string }> };
    assert.equal(first.pending.length, 1);
    assert.equal(first.pending[0].id, queued.id);
    assert.equal(first.pending[0].message, 'preserve this\nmessage');
    const repeated = f.call(['inbox']) as unknown as { pending: Array<{ id: string }> };
    assert.equal(repeated.pending.length, 1);
    assert.equal(repeated.pending[0].id, queued.id);
    const acknowledged = f.call(['ack', '--id', queued.id, '--outcome', 'deferred', '--note', 'waiting on render']) as unknown as { pending: number };
    assert.equal(acknowledged.pending, 0);
    assert.equal((f.call(['ack', '--id', queued.id, '--outcome', 'deferred', '--note', 'waiting on render']) as unknown as { pending: number }).pending, 0);
    f.call(['ack', '--id', queued.id, '--outcome', 'blocked', '--note', 'different'], false);
    f.call(['stop', '--cancel']);
    await f.until(value => value.ended);
    f.call(['steer', '--message', 'do not restart'], false);
  } finally { await f.cleanup(); }
});

void test('concurrent steering preserves every message and generation boundaries', async () => {
  const f = fixture();
  try {
    f.start('setInterval(()=>{},100)');
    await f.until(value => value.running);
    const queued = await Promise.all(['one', 'two', 'three'].map(message => f.callAsync(['steer', '--message', message])));
    const inbox = f.call(['inbox']) as unknown as { pending: Array<{ id: string; message: string }> };
    assert.deepEqual(inbox.pending.map(item => item.message).sort(), ['one', 'three', 'two']);
    assert.equal(new Set(queued.map(item => (item as unknown as { id: string }).id)).size, 3);
    f.call(['stop', '--cancel']);
    await f.until(value => value.ended);
    f.start('setInterval(()=>{},100)');
    await f.until(value => value.running);
    assert.deepEqual((f.call(['inbox']) as unknown as { pending: unknown[] }).pending, []);
    assert.equal((f.call(['inbox', '--all']) as unknown as { records: unknown[] }).records.length, 3);
  } finally { await f.cleanup(); }
});

void test('a cooperating child polls and acknowledges file-backed steering', async () => {
  const f = fixture();
  const messageFile = join(f.cwd, 'steering.txt');
  const receipt = join(f.cwd, 'receipt.json');
  writeFileSync(messageFile, 'change direction');
  try {
    f.start(cooperatingChild(), [], [cli, f.cwd, receipt]);
    await f.until(value => value.running);
    f.call(['steer', '--message-file', messageFile]);
    const deadline = Date.now() + 4_000;
    while (!existsSync(receipt) && Date.now() < deadline) await delay(50);
    assert.ok(existsSync(receipt));
    assert.equal((JSON.parse(readFileSync(receipt, 'utf8')) as { pending: number }).pending, 0);
  } finally { await f.cleanup(); }
});

void test('missing executable counts failures without a shell fallback', async () => {
  const f = fixture();
  try {
    f.call(['start', '--interval', '1ms', '--max-failures', '2', '--', join(f.cwd, 'missing-executable')]);
    const stopped = await f.until(value => value.ended);
    assert.equal(stopped.failures, 2);
    assert.equal(stopped.runs, 2);
  } finally { await f.cleanup(); }
});

void test('lifetime expires without starting another command', async () => {
  const f = fixture();
  try {
    f.start('setTimeout(()=>{},300)', ['--lifetime', '500ms']);
    const stopped = await f.until(value => value.ended);
    assert.equal(stopped.reason, 'lifetime expired');
    assert.equal(stopped.runs, 1);
  } finally { await f.cleanup(); }
});

void test('stale owned state cannot signal a reused PID or start a duplicate', async () => {
  const f = fixture();
  f.start('process.exit(1)', ['--max-failures', '1']);
  const stopped = await f.until(value => value.ended);
  const dir = dirname(stopped.log);
  mkdirSync(join(dir, 'supervisor.lock'));
  writeFileSync(join(dir, 'progress.json'), JSON.stringify({ ...stopped, pid: process.pid, heartbeat: 1, ended: false, running: true }));
  try {
    assert.equal(f.call(['status']).supervisor, 'stale');
    f.call(['stop', '--cancel'], false);
    f.call(['start', '--interval', '1s', '--', process.execPath], false);
  } finally { rmSync(f.cwd, { recursive: true, force: true }); }
});
