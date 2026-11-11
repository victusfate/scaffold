// topology.ts — the repo's agent topology: which orchestrator model runs the loop and which
// subagent slots it may fill. Read from `.agent/topology.json`, which is CONSUMER-OWNED (scaffold
// never ships or overwrites it, like `.agent/default-language.md`). Schema: lib/topology.schema.json;
// example: lib/topology.example.json.
//
// Deliberately no routing fields: the orchestrator decides which task suits which slot. Swapping
// resources means editing the file, never the scheduled loop prompt.
//
//   TOPOLOGY_FILE overrides the path (tests, alternate checkouts).
//   node scripts/topology.ts [path]    # validate and print the topology as JSON (exit 1 on error)

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Slot {
  /** Unique kebab-case id; also the queue task owner while the slot is busy. */
  id: string;
  /** Harness family: claude, codex, agy, pi, or any other name the repo's dispatcher understands. */
  harness: string;
  model: string;
  effort?: string;
}

export interface Topology {
  orchestrator: { model: string };
  tickMinutes: number;
  slots: Slot[];
}

export class TopologyError extends Error {}

// quality-ok: magic-number — the loop skill's documented default tick cadence
export const DEFAULT_TICK_MINUTES = 10;
export const TOPOLOGY_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.agent', 'topology.json');
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOP_KEYS = ['orchestrator', 'tick_minutes', 'slots'];
const SLOT_KEYS = ['id', 'harness', 'model', 'effort'];

/** No file: just the orchestrator, no slots. */
export function defaultTopology(): Topology {
  return { orchestrator: { model: 'default' }, tickMinutes: DEFAULT_TICK_MINUTES, slots: [] };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rejectUnknown(obj: Record<string, unknown>, allowed: string[], where: string): void {
  const extra = Object.keys(obj).find(k => !allowed.includes(k));
  if (extra) throw new TopologyError(`${where}: unknown key "${extra}"`);
}

function nonEmptyString(v: unknown, where: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new TopologyError(`${where} must be a non-empty string`);
  return v;
}

function parseSlot(raw: unknown, index: number): Slot {
  const where = `slots[${index}]`;
  if (!isObject(raw)) throw new TopologyError(`${where} must be an object`);
  rejectUnknown(raw, SLOT_KEYS, where);
  const id = nonEmptyString(raw.id, `${where}.id`);
  if (!KEBAB.test(id)) throw new TopologyError(`${where}.id "${id}" must be kebab-case`);
  const slot: Slot = {
    id, harness: nonEmptyString(raw.harness, `${where}.harness`), model: nonEmptyString(raw.model, `${where}.model`),
  };
  if (raw.effort !== undefined) slot.effort = nonEmptyString(raw.effort, `${where}.effort`);
  return slot;
}

function parseOrchestrator(raw: unknown): { model: string } {
  if (!isObject(raw)) throw new TopologyError('orchestrator must be an object');
  rejectUnknown(raw, ['model'], 'orchestrator');
  return { model: nonEmptyString(raw.model, 'orchestrator.model') };
}

function parseSlots(raw: unknown): Slot[] {
  if (!Array.isArray(raw)) throw new TopologyError('slots must be an array');
  const slots = raw.map(parseSlot);
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.id)) throw new TopologyError(`duplicate slot id "${s.id}"`);
    seen.add(s.id);
  }
  return slots;
}

/** Validate a parsed JSON value. Throws TopologyError naming the first problem. */
export function parseTopology(raw: unknown): Topology {
  if (!isObject(raw)) throw new TopologyError('topology must be a JSON object');
  rejectUnknown(raw, TOP_KEYS, 'topology');
  const orchestrator = parseOrchestrator(raw.orchestrator);
  const tick = raw.tick_minutes ?? DEFAULT_TICK_MINUTES;
  if (typeof tick !== 'number' || !Number.isFinite(tick) || tick <= 0) {
    throw new TopologyError('tick_minutes must be a positive number');
  }
  return { orchestrator, tickMinutes: tick, slots: parseSlots(raw.slots ?? []) };
}

/** Read and validate the topology file; a missing file is the default (orchestrator only). */
export function loadTopology(path: string = process.env.TOPOLOGY_FILE ?? TOPOLOGY_PATH): Topology {
  if (!existsSync(path)) return defaultTopology();
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new TopologyError(`${path}: invalid JSON (${(error as Error).message})`); }
  return parseTopology(raw);
}

function main(argv: string[]): void {
  try { process.stdout.write(`${JSON.stringify(loadTopology(argv[0]), null, 2)}\n`); }
  catch (error) {
    if (!(error instanceof TopologyError)) throw error;
    process.stderr.write(`topology: ${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
