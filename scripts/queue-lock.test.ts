#!/usr/bin/env node
// Cross-process mutations must retain every record rather than clobbering a stale snapshot.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseQueue } from './queue-model.ts';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const CLI = fileURLToPath(new URL('./queue.ts', import.meta.url));
const PER_WORKER = 30;

async function worker(label: string): Promise<number> {
  for (let i = 1; i <= PER_WORKER; i++) {
    const result = spawnSync(process.execPath, [CLI, 'add', `${label}-${i}`], { stdio: 'ignore' });
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

async function hold(marker: string): Promise<number> {
  const { withLock } = await import('./queue-io.ts');
  withLock(() => {
    writeFileSync(marker, 'held');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  });
  return 0;
}

function spawnCli(file: string, args: string[], script = CLI): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, QUEUE_FILE: file }, stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', () => resolve(1));
    child.on('exit', code => resolve(code ?? 1));
  });
}

function run(file: string, ...args: string[]): number {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, QUEUE_FILE: file }, stdio: 'ignore',
  }).status ?? 1;
}

if (process.argv[2] === '--worker') process.exit(await worker(process.argv[3]));
if (process.argv[2] === '--hold') process.exit(await hold(process.argv[3]));

const dir = mkdtempSync(join(tmpdir(), 'queue-lock-'));
const file = join(dir, 'queue.md');
try {
  writeFileSync(file, '# Work Queue\n\n');
  const lockMarker = join(dir, 'lock-held');
  const holding = spawnCli(file, ['--hold', lockMarker], SELF);
  for (let attempt = 0; attempt < 50 && !existsSync(lockMarker); attempt++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  if (!existsSync(lockMarker) || !/^pid=\d+ acquiredAt=.+\n$/.test(readFileSync(`${file}.lock`, 'utf8'))) {
    throw new Error('lock metadata is missing');
  }
  if (await holding !== 0) throw new Error('lock holder failed');
  console.log('queue-lock: live lock records owner metadata PASS');
  const codes = await Promise.all([
    spawnCli(file, ['--worker', 'alpha'], SELF),
    spawnCli(file, ['--worker', 'beta'], SELF),
  ]);
  const tasks = parseQueue(readFileSync(file, 'utf8')).tasks;
  if (!codes.every(code => code === 0)) throw new Error(`workers failed: ${codes.join(',')}`);
  if (tasks.length !== PER_WORKER * 2) throw new Error(`kept ${tasks.length} of ${PER_WORKER * 2} records`);
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('duplicate task ids');
  console.log('queue-lock: concurrent CLI mutations retain every record PASS');

  const validationFile = join(dir, 'validation.md');
  writeFileSync(validationFile, '# Work Queue\n\n');
  const validation = `${process.execPath} ${JSON.stringify(CLI)} add from-validation`;
  if (run(validationFile, 'add', 'validated task', '--validate', validation) !== 0) {
    throw new Error('could not create validation task');
  }
  if (await spawnCli(validationFile, ['done', 'task-001']) !== 0) {
    throw new Error('validation task did not complete');
  }
  const afterValidation = parseQueue(readFileSync(validationFile, 'utf8')).tasks;
  if (afterValidation.length !== 1 || afterValidation[0].title !== 'from-validation') {
    throw new Error('validation did not release/reload the queue transaction');
  }
  console.log('queue-lock: validation releases and reloads the transaction PASS');

  const competingFile = join(dir, 'competing.md');
  const marker = join(dir, 'validate-started');
  const release = join(dir, 'validate-release');
  writeFileSync(competingFile, '# Work Queue\n\n');
  const delayedValidation = `${process.execPath} -e ${JSON.stringify(
    `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(marker)}, 'started'); const end = Date.now() + 5000; while (!fs.existsSync(${JSON.stringify(release)}) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); if (!fs.existsSync(${JSON.stringify(release)})) process.exit(1);`,
  )}`;
  if (run(competingFile, 'add', 'competing task', '--validate', delayedValidation) !== 0) {
    throw new Error('could not create competing validation task');
  }
  const completing = spawnCli(competingFile, ['done', 'task-001']);
  for (let attempt = 0; attempt < 50 && !existsSync(marker); attempt++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  if (!existsSync(marker)) throw new Error('validation did not start');
  if (run(competingFile, 'fail', 'task-001', 'competing transition') !== 0) {
    throw new Error('competing transition did not complete');
  }
  writeFileSync(release, 'continue');
  if (await completing === 0) throw new Error('completion overwrote a concurrent transition');
  const competing = parseQueue(readFileSync(competingFile, 'utf8')).tasks[0];
  if (competing.status !== 'pending' || competing.failures !== 1) {
    throw new Error('concurrent transition was not preserved');
  }
  console.log('queue-lock: validation refuses a changed task claim PASS');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
