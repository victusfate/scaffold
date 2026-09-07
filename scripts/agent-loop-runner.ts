// The systemd-only entrypoint reconciles interrupted runs before launching work.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, appendFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, readProgress, save } from './agent-loop-state.ts';
import type { Config, Progress } from './agent-loop-state.ts';
import { control } from './agent-loop-systemd.ts';

function limitReason(config: Config, progress: Progress): string | undefined {
  if (progress.failures >= config.maxFailures) return 'failure limit';
  if (Date.now() >= config.expiresAt) return 'lifetime expired';
}

export async function run(dir: string, generation: string): Promise<void> {
  if (!process.env.INVOCATION_ID) throw new Error('timer-run is reserved for the systemd service');
  const config = readConfig(dir);
  if (config.generation !== generation) throw new Error('Stale loop generation');
  const progress = readProgress(dir);
  // A runner killed by systemd cannot record its exit. Reconcile that attempt
  // before considering another launch, including the failure-limit boundary.
  if (progress.running) {
    progress.failures++;
    progress.running = false;
    progress.outcome = 'previous run timed out or crashed';
    save(dir, 'progress.json', progress);
  }
  const reason = limitReason(config, progress);
  if (existsSync(join(dir, 'stopped.json')) || reason) {
    save(dir, 'stopped.json', { reason: reason || 'user stop' });
    control(['stop', `${config.unit}.timer`]);
    return;
  }
  progress.runs++;
  progress.invocation = process.env.INVOCATION_ID;
  progress.running = true;
  progress.startedAt = Date.now();
  save(dir, 'progress.json', progress);
  const log = join(dir, 'output.log');
  if (existsSync(log)) renameSync(log, join(dir, 'previous.log'));
  writeFileSync(log, `[${new Date().toISOString()}] run ${progress.runs}\n`, { mode: 0o600 });
  const fd = openSync(log, 'a', 0o600);
  const outcome = await execute(config, fd);
  closeSync(fd);
  progress.running = false;
  progress.finishedAt = Date.now();
  progress.outcome = outcome;
  progress.failures = outcome === 'exit 0' ? 0 : progress.failures + 1;
  save(dir, 'progress.json', progress);
  appendFileSync(log, `[${new Date().toISOString()}] ${outcome}\n`);
  const finishedReason = limitReason(config, progress);
  if (finishedReason) {
    save(dir, 'stopped.json', { reason: finishedReason });
    control(['stop', `${config.unit}.timer`]);
  }
}

export function finish(dir: string, generation: string): void {
  if (!process.env.INVOCATION_ID) throw new Error('timer-finish is reserved for the systemd service');
  const config = readConfig(dir);
  if (config.generation !== generation) throw new Error('Stale loop generation');
  const progress = readProgress(dir);
  // ExecStopPost also runs when the main process dies before JavaScript starts.
  // Invocation identity distinguishes that failure from a completed attempt.
  const neverStarted = progress.invocation !== process.env.INVOCATION_ID;
  if (process.env.SERVICE_RESULT !== 'success' && (neverStarted || progress.running)) {
    if (neverStarted) progress.runs++;
    progress.invocation = process.env.INVOCATION_ID;
    progress.running = false;
    progress.failures++;
    progress.finishedAt = Date.now();
    progress.outcome = `systemd ${process.env.SERVICE_RESULT || 'failure'}`;
    save(dir, 'progress.json', progress);
  }
  const reason = limitReason(config, progress);
  if (reason) {
    save(dir, 'stopped.json', { reason });
    control(['stop', `${config.unit}.timer`], true);
  }
}

function execute(config: ReturnType<typeof readConfig>, fd: number): Promise<string> {
  return new Promise(resolve => {
    const child = spawn(config.argv[0], config.argv.slice(1), {
      cwd: config.cwd, env: { ...process.env, PATH: config.path }, stdio: ['ignore', fd, fd],
    });
    child.once('error', error => resolve(`spawn error: ${error.message}`));
    child.once('close', (code, signal) => resolve(signal ? `signal ${signal}` : `exit ${code}`));
  });
}
