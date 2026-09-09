import { createHash, randomUUID } from 'node:crypto';
// Private durable configuration and per-run progress for the external loop CLI.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const SECOND = 1000;
const HEARTBEAT_STALE_MS = 5000;
const DURATION_HINT = 'use 10min, 10m, 30s, or 8h (maximum 30 days)';
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const MAX_DURATION = 30 * 24 * HOUR;
const CONTROL_RETRIES = 40;
const CONTROL_RETRY_MS = 25;
const UNITS: Record<string, number> = { ms: 1, s: SECOND, m: MINUTE, min: MINUTE, h: HOUR };
export interface Config {
  cwd: string; unit: string; generation: string; argv: string[];
  interval: number; timeout: number; expiresAt: number; maxFailures: number;
  requireResult: boolean;
}
export interface Progress {
  runs: number; failures: number; running: boolean; startedAt?: number;
  finishedAt?: number; outcome?: string; generation?: string; pid?: number;
  heartbeat?: number; ready?: boolean; ended?: boolean; reason?: string;
}
export type SteeringOutcome = 'applied' | 'deferred' | 'blocked';
export interface SteeringRecord {
  id: string; generation: string; receivedAt: number; message: string;
  acknowledgedAt?: number; outcome?: SteeringOutcome; note?: string;
}
interface Acknowledgement { generation: string; id: string; outcome: SteeringOutcome; note?: string }
interface Inbox { records: SteeringRecord[] }
export const EMPTY: Progress = { runs: 0, failures: 0, running: false };

export function duration(value: string): number {
  const match = /^(\d+)(ms|s|m|min|h)$/.exec(value);
  const result = match ? Number(match[1]) * UNITS[match[2]] : NaN;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_DURATION) {
    throw new Error(`Invalid duration: ${value}; ${DURATION_HINT}`);
  }
  return result;
}

export function location(cwd: string): { cwd: string; dir: string; unit: string } {
  cwd = realpathSync(cwd);
  if (!statSync(cwd).isDirectory()) throw new Error('cwd must be a directory');
  const identity = process.platform === 'win32' ? cwd.toLowerCase() : cwd;
  const id = createHash('sha256').update(identity).digest('hex');
  const root = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  if (!isAbsolute(root)) throw new Error('XDG_STATE_HOME must be absolute');
  return { cwd, dir: join(root, 'scaffold-agent-loop', id), unit: `scaffold-loop-${id}` };
}

export function readConfig(dir: string): Config {
  return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Config;
}

export function readProgress(dir: string): Progress {
  const path = join(dir, 'progress.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Progress : { ...EMPTY };
}

export function save(dir: string, name: string, value: unknown): void {
  const temp = join(dir, `${name}.${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, join(dir, name));
}

export function readInbox(dir: string): SteeringRecord[] {
  const path = join(dir, 'inbox.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Inbox).records : [];
}

export function pendingSteering(dir: string, generation: string): SteeringRecord[] {
  return readInbox(dir).filter(item => item.generation === generation && !item.outcome);
}

export function addSteering(dir: string, generation: string, message: string): SteeringRecord {
  const records = readInbox(dir);
  const record: SteeringRecord = { id: randomUUID(), generation, receivedAt: Date.now(), message };
  records.push(record);
  save(dir, 'inbox.json', { records });
  return record;
}

export function acknowledgeSteering(dir: string, acknowledgement: Acknowledgement): SteeringRecord {
  const records = readInbox(dir);
  const { generation, id, outcome, note } = acknowledgement;
  const record = records.find(item => item.generation === generation && item.id === id);
  if (!record) throw new Error('No steering message matches the active generation and id');
  if (record.outcome && (record.outcome !== outcome || record.note !== note)) {
    throw new Error('Steering message was already acknowledged with a different outcome');
  }
  if (!record.outcome) {
    record.acknowledgedAt = Date.now();
    record.outcome = outcome;
    record.note = note;
    save(dir, 'inbox.json', { records });
  }
  return record;
}

export function initialize(dir: string): void {
  if (existsSync(dir)) {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe loop state directory');
    if (readdirSync(dir).length && !existsSync(join(dir, 'config.json'))) throw new Error('Refusing to overwrite unrelated state');
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export async function withControlLock<T>(dir: string, action: () => T | Promise<T>): Promise<T> {
  const lock = join(dir, 'control.lock');
  for (let attempt = 0; attempt < CONTROL_RETRIES; attempt++) {
    try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt + 1 < CONTROL_RETRIES) {
        await delay(CONTROL_RETRY_MS);
        continue;
      }
      break;
    }
    try { return await action(); } finally { rmSync(lock, { recursive: true }); }
  }
  throw new Error('Loop control is busy; inspect control.lock if an earlier CLI crashed');
}

export function stopRequest(dir: string, generation: string): { cancel: boolean } | undefined {
  const path = join(dir, 'stopped.json');
  if (!existsSync(path)) return;
  const request = JSON.parse(readFileSync(path, 'utf8')) as { generation: string; cancel: boolean };
  if (request.generation === generation) return request;
}

export function alive(progress: Progress): boolean {
  if (!progress.pid || progress.ended || !progress.heartbeat || Date.now() - progress.heartbeat > HEARTBEAT_STALE_MS) return false;
  try { process.kill(progress.pid, 0); return true; } catch { return false; }
}
