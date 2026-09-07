import { createHash, randomUUID } from 'node:crypto';
// Private durable configuration and per-run progress for the external loop CLI.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const MAX_DURATION = 30 * 24 * HOUR;
const UNITS: Record<string, number> = { ms: 1, s: SECOND, m: MINUTE, min: MINUTE, h: HOUR };
export interface Config {
  cwd: string; unit: string; generation: string; argv: string[]; path: string;
  interval: number; timeout: number; expiresAt: number; maxFailures: number;
}
export interface Progress {
  runs: number; failures: number; running: boolean; startedAt?: number;
  finishedAt?: number; outcome?: string;
}
export const EMPTY: Progress = { runs: 0, failures: 0, running: false };

export function duration(value: string): number {
  const match = /^(\d+)(ms|s|m|min|h)$/.exec(value);
  const result = match ? Number(match[1]) * UNITS[match[2]] : NaN;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_DURATION) {
    throw new Error(`Invalid duration: ${value}; use 10min, 10m, 30s, or 8h (maximum 30 days)`);
  }
  return result;
}

export function location(cwd: string): { cwd: string; dir: string; unit: string } {
  cwd = realpathSync(cwd);
  const id = createHash('sha256').update(cwd).digest('hex');
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

export function initialize(dir: string): void {
  if (existsSync(dir)) {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.uid !== process.getuid?.()) throw new Error('Unsafe loop state directory');
    if (readdirSync(dir).length && !existsSync(join(dir, 'config.json'))) throw new Error('Refusing to overwrite unrelated state');
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function withControlLock<T>(dir: string, action: () => T): T {
  const lock = join(dir, 'control.lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('Loop control is busy; inspect control.lock if an earlier CLI crashed'); }
  try { return action(); } finally { rmSync(lock, { recursive: true }); }
}
