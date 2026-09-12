#!/usr/bin/env node
// Isolation proof for per-repo consoles: two queue-console.ts processes with
// distinct QUEUE_FILEs on isolated ports must serve independent state — an op
// on A never touches B's file or API, concurrent mutations never contend,
// lane heartbeats never cross. In-process two-server testing is rejected on
// purpose: queueFile() resolves process.env.QUEUE_FILE per call, so two
// servers in one process would race on the shared env; child processes with
// per-child env are the honest harness.

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CONSOLE = join(HERE, 'queue-console.ts');
const CLI = join(HERE, 'queue.ts');
const LISTEN_RE = /http:\/\/localhost:(\d+)/;
const START_TIMEOUT_MS = 10_000;

interface ConsoleProc { proc: ChildProcess; port: number; file: string }

function startConsole(file: string): Promise<ConsoleProc> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CONSOLE, '--port', '0'], {
      env: { ...process.env, QUEUE_FILE: file },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`console for ${file} did not announce listening in ${START_TIMEOUT_MS}ms (got: ${out})`));
    }, START_TIMEOUT_MS);
    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
      const m = out.match(LISTEN_RE);
      if (m) { clearTimeout(timer); resolve({ proc, port: Number(m[1]), file }); }
    });
  });
}

const api = (c: ConsoleProc, path: string): string => `http://127.0.0.1:${c.port}${path}`;
const post = (c: ConsoleProc, body: unknown): Promise<Response> => fetch(api(c, '/api/op'), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const laneBeat = (c: ConsoleProc, id: string, step: string): void => {
  const r = spawnSync(process.execPath, [CLI, 'lane', 'beat', id, '--worker', 'isolation-probe', '--step', step], {
    env: { ...process.env, QUEUE_FILE: c.file }, encoding: 'utf8',
  });
  assert(`lane beat ${id} accepted on its own console`, r.status === 0, r.stderr.slice(0, 200));
};

const dirA = mkdtempSync(join(tmpdir(), 'queue-iso-a-'));
const dirB = mkdtempSync(join(tmpdir(), 'queue-iso-b-'));
const fileA = join(dirA, 'queue.md');
const fileB = join(dirB, 'queue.md');
// Same task ids in both files on purpose: per-file monotonic counters collide
// by design, so identical ids are the sharpest isolation probe.
writeFileSync(fileA, '- [ ] task-001 — Alpha sentinelWidget\n');
writeFileSync(fileB, '- [ ] task-001 — Beta sentinelGadget\n');

let a: ConsoleProc | null = null;
let b: ConsoleProc | null = null;
try {
  a = await startConsole(fileA);
  b = await startConsole(fileB);
  assert('consoles bind isolated ports', a.port !== b.port, `${a.port} vs ${b.port}`);

  // 1. state separation: each console serves only its own tasks.
  const stateA = await (await fetch(api(a, '/api/queue'))).json() as { tasks: { id: string; title: string }[] };
  const stateB = await (await fetch(api(b, '/api/queue'))).json() as { tasks: { id: string; title: string }[] };
  assert('console A serves only Alpha tasks',
    stateA.tasks.length === 1 && stateA.tasks[0].title === 'Alpha sentinelWidget');
  assert('console B serves only Beta tasks',
    stateB.tasks.length === 1 && stateB.tasks[0].title === 'Beta sentinelGadget');

  // 2. op containment: an add via A lands in A's file/API and nowhere near B.
  const added = await post(a, { op: 'add', title: 'Alpha secondSlice' });
  assert('add via A accepted', added.status === 200);
  assert('A file carries the new task', readFileSync(fileA, 'utf8').includes('Alpha secondSlice'));
  assert('B file untouched by A op', !readFileSync(fileB, 'utf8').includes('Alpha secondSlice'));
  const freshB = await (await fetch(api(b, '/api/queue'))).json() as { tasks: { title: string }[] };
  assert('B API hides A task', freshB.tasks.every(t => !t.title.includes('Alpha secondSlice')));

  // 3. concurrent mutation: both consoles write at once, neither lock fails.
  const [rA, rB] = await Promise.all([
    post(a, { op: 'add', title: 'Alpha racingWrite' }),
    post(b, { op: 'add', title: 'Beta racingWrite' }),
  ]);
  assert('concurrent add on A succeeds', rA.status === 200);
  assert('concurrent add on B succeeds', rB.status === 200);
  assert('racing writes land in their own files',
    readFileSync(fileA, 'utf8').includes('Alpha racingWrite')
    && readFileSync(fileB, 'utf8').includes('Beta racingWrite')
    && !readFileSync(fileA, 'utf8').includes('Beta racingWrite')
    && !readFileSync(fileB, 'utf8').includes('Alpha racingWrite'));

  // 4. lane separation: a heartbeat for A's task-001 shows only on A.
  laneBeat(a, 'task-001', 'probing isolation');
  const lanesA = await (await fetch(api(a, '/api/lanes'))).json() as { lanes: { id: string }[] };
  const lanesB = await (await fetch(api(b, '/api/lanes'))).json() as { lanes: { id: string }[] };
  assert('A lanes show the heartbeat', lanesA.lanes.some(l => l.id === 'task-001'));
  assert('B lanes hide A heartbeat', !lanesB.lanes.some(l => l.id === 'task-001'));
} catch (e) {
  assert('isolation run completes without harness error', false, (e as Error).message);
} finally {
  a?.proc.kill('SIGTERM');
  b?.proc.kill('SIGTERM');
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
}

console.error(`\nqueue-isolation.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
