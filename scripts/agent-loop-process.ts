// Execute argv without a shell; cancellation acts only on our live child tree.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from './agent-loop-state.ts';
import { stopRequest } from './agent-loop-state.ts';

const POLL_MS = 100;
const KILL_GRACE_MS = 500;
const TASKKILL_TIMEOUT_MS = 5000;
const RESULT_FILE = 'run-result.json';
type Directive = { status: 'continue' | 'complete' | 'blocked'; summary?: string };
export interface ExecutionResult { outcome: string; directive?: Directive }

function readDirective(path: string): Directive | undefined {
  if (!existsSync(path)) return;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Directive;
    if (!['continue', 'complete', 'blocked'].includes(value.status)) return;
    if (value.summary !== undefined && typeof value.summary !== 'string') return;
    return value;
  } catch { return; }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // taskkill cannot retain ownership after the root exits. Commands must join
    // their workers before exiting; independently detached jobs are not supervised.
    if (child.exitCode !== null || child.signalCode !== null) return;
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, encoding: 'utf8', timeout: TASKKILL_TIMEOUT_MS,
    });
    if (result.status !== 0 && child.exitCode === null) throw new Error(`taskkill failed: ${result.error?.message || result.stderr}`);
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    try { process.kill(-child.pid!, name); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  signal('SIGTERM');
  await delay(KILL_GRACE_MS);
  signal('SIGKILL');
}

export async function execute(config: Config, dir: string): Promise<ExecutionResult> {
  const log = join(dir, 'output.log');
  const resultPath = join(dir, RESULT_FILE);
  rmSync(resultPath, { force: true });
  if (existsSync(log)) renameSync(log, join(dir, 'previous.log'));
  const fd = openSync(log, 'w', 0o600);
  const child = spawn(config.argv[0], config.argv.slice(1), {
    cwd: config.cwd, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32', windowsHide: true,
    env: { ...process.env, SCAFFOLD_AGENT_LOOP_RESULT: resultPath },
  });
  let done = false;
  let outcome = '';
  child.once('error', error => { done = true; outcome = `spawn error: ${error.message}`; });
  child.once('exit', (code, signal) => { done = true; outcome = signal ? `signal ${signal}` : `exit ${code}`; });
  const deadline = Date.now() + config.timeout;
  try {
    while (!done) {
      const cancelled = stopRequest(dir, config.generation)?.cancel;
      if (cancelled || Date.now() >= deadline) {
        await terminate(child);
        return { outcome: cancelled ? 'cancelled' : 'timeout' };
      }
      await delay(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
    }
    if (child.pid && process.platform !== 'win32') await terminate(child);
    if (outcome !== 'exit 0' || !config.requireResult) return { outcome };
    const directive = readDirective(resultPath);
    return directive ? { outcome, directive } : { outcome: 'missing or invalid required result' };
  } finally { closeSync(fd); }
}
