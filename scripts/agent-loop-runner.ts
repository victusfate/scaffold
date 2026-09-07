// An independent Node process owns recurrence and holds the checkout lease.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execute } from './agent-loop-process.ts';
import { EMPTY, readConfig, save, stopRequest } from './agent-loop-state.ts';
import type { Progress } from './agent-loop-state.ts';

const HEARTBEAT_MS = 250;
export async function supervise(dir: string, generation: string): Promise<void> {
  const config = readConfig(dir);
  if (config.generation !== generation || !existsSync(join(dir, 'supervisor.lock'))) throw new Error('Unowned supervisor request');
  writeFileSync(join(dir, 'supervisor.lock', 'owner.json'), JSON.stringify({ generation, pid: process.pid }), { flag: 'wx', mode: 0o600 });
  const progress: Progress = { ...EMPTY, generation, pid: process.pid, ready: true, heartbeat: Date.now() };
  const publish = () => { progress.heartbeat = Date.now(); save(dir, 'progress.json', progress); };
  const cancel = () => save(dir, 'stopped.json', { generation, cancel: true });
  process.on('SIGTERM', cancel);
  process.on('SIGINT', cancel);
  publish();
  const heartbeat = setInterval(publish, HEARTBEAT_MS);
  let next = Date.now() + HEARTBEAT_MS;
  try {
    while (!stopRequest(dir, generation) && Date.now() < config.expiresAt && progress.failures < config.maxFailures) {
      if (Date.now() < next) { await delay(Math.min(HEARTBEAT_MS, next - Date.now())); continue; }
      progress.running = true;
      progress.startedAt = Date.now();
      progress.runs++;
      publish();
      progress.outcome = await execute(config, dir);
      progress.finishedAt = Date.now();
      progress.running = false;
      progress.failures = progress.outcome === 'exit 0' ? 0 : progress.failures + 1;
      publish();
      next = Date.now() + config.interval;
    }
    progress.reason = stopRequest(dir, generation) ? 'stopped' : progress.failures >= config.maxFailures ? 'failure limit' : 'lifetime expired';
  } catch (error) {
    progress.reason = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    clearInterval(heartbeat);
    progress.ended = true;
    publish();
    // A termination error may leave an orphan: retain the lease in that case.
    if (!progress.running) rmSync(join(dir, 'supervisor.lock'), { recursive: true });
  }
}
