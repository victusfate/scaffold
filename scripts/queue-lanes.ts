// queue-lanes.ts — per-lane heartbeat sidecars for the live board.
//
// Workers/drivers write these; the console server only READS them (design.md
// D2/D3 of docs/queue-live-board/). A lane file is liveness metadata — never
// process authority (skills/queue.md session isolation holds).
//
//   .agent/queue/lanes/<task-id>.json
//     { id, worker, model, step, state, startedAt, updatedAt, tail }
//   .agent/queue/lanes/<task-id>.stop   — cooperative stop request (flag file)

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { queueFile, now } from './queue-io.ts';

export interface LaneState {
  id: string;
  worker: string | null;
  model: string | null;
  step: string | null;
  state: string;
  startedAt: string | null;
  updatedAt: string;
  tail: string | null;
}

export interface LanePatch {
  worker?: string; model?: string; step?: string; state?: string; tail?: string;
}

export function laneDir(): string { return join(dirname(queueFile()), 'lanes'); }
function lanePath(id: string): string { return join(laneDir(), `${id}.json`); }
function stopPath(id: string): string { return join(laneDir(), `${id}.stop`); }

function blank(id: string): LaneState {
  return {
    id, worker: null, model: null, step: null, state: 'running',
    startedAt: null, updatedAt: now(), tail: null,
  };
}

function readOne(path: string): LaneState | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LaneState>;
    if (typeof raw.id !== 'string') return null;
    return { ...blank(raw.id), ...raw, id: raw.id, updatedAt: String(raw.updatedAt ?? now()) };
  } catch { return null; }
}

/**
 * Record a heartbeat for a lane: merge the patch over the existing sidecar
 * (or a blank), stamp updatedAt. First beat also stamps startedAt.
 */
export function beatLane(id: string, patch: LanePatch = {}): LaneState {
  mkdirSync(laneDir(), { recursive: true });
  const prev = existsSync(lanePath(id)) ? readOne(lanePath(id)) : null;
  const base = prev ?? { ...blank(id), startedAt: now() };
  const next: LaneState = {
    ...base,
    worker: patch.worker ?? base.worker,
    model: patch.model ?? base.model,
    step: patch.step ?? base.step,
    state: patch.state ?? base.state,
    tail: patch.tail ?? base.tail,
    updatedAt: now(),
  };
  writeFileSync(lanePath(id), JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** Every well-formed lane sidecar; malformed files are skipped, never fatal. */
export function readLanes(): LaneState[] {
  if (!existsSync(laneDir())) return [];
  const out: LaneState[] = [];
  for (const f of readdirSync(laneDir())) {
    if (!f.endsWith('.json')) continue;
    const lane = readOne(join(laneDir(), f));
    if (lane) out.push(lane);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** A lane is stale when its heartbeat aged past the lease — grey it, never reap it. */
export function laneStale(lane: LaneState, nowIso: string, leaseMinutes: number): boolean {
  return Date.parse(nowIso) - Date.parse(lane.updatedAt) >= leaseMinutes * 60_000;
}

export function clearLane(id: string): void {
  rmSync(lanePath(id), { force: true });
  clearStopRequest(id);
}

/** Cooperative stop: the owning driver honors the flag at its next safe point. */
export function requestStop(id: string): void {
  mkdirSync(laneDir(), { recursive: true });
  writeFileSync(stopPath(id), `stop requested at ${now()}\n`);
}

export function stopRequested(id: string): boolean {
  return existsSync(stopPath(id));
}

export function clearStopRequest(id: string): void {
  rmSync(stopPath(id), { force: true });
}
