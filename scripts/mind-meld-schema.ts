// Versioned, offline Mind Meld exchange format. No source path is ever fetched by the viewer.
import { createHash } from 'node:crypto';
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_ARRAY_LENGTH = 10_000;
const MAX_SOURCE_COUNT = 1000;
const MAX_SOURCE_BYTES = 10_000_000;
export interface MeldNode { id: string; file: string; line: number; endLine: number; layer: string }
export interface MeldEvent { id: string; node: string; parent: string | null; durationMs: number; input: string; output: string; changes: { key: string; before: string; after: string }[] }
export interface MeldEdge { from: string; to: string; file: string; line: number; kind: 'call' }
export interface MeldRun { key: string; snapshotHash: string; mode: 'flow' | 'piece'; entry: string; output: string; events: MeldEvent[] }
export interface MeldBundle { version: 1; nodes: MeldNode[]; sources: Record<string, string>; sourceHashes: Record<string, string>; snapshotHash: string; edges: MeldEdge[]; runs: MeldRun[] }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object');
  return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) throw new Error('expected bounded string');
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_LENGTH) throw new Error('expected bounded array');
  return value as unknown[];
}
function positive(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('invalid source line');
}
function validateNodes(value: unknown, sources: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  for (const item of array(value)) {
    const n = record(item);
    text(n.id); text(n.file); text(n.layer); positive(n.line); positive(n.endLine);
    if (ids.has(n.id) || !Object.hasOwn(sources, n.file)) throw new Error('duplicate node or missing source');
    const source = sources[n.file]; text(source);
    if (n.endLine < n.line || n.endLine > source.split('\n').length) throw new Error('span outside source');
    ids.add(n.id);
  }
  return ids;
}
function validateParent(parent: unknown, ids: Set<string>): void {
  if (parent !== null && (typeof parent !== 'string' || !ids.has(parent))) throw new Error('parent must precede child');
}
function validateEvents(value: unknown, nodes: Set<string>): void {
  const ids = new Set<string>();
  for (const item of array(value)) {
    const e = record(item);
    text(e.id); text(e.node); text(e.input); text(e.output);
    if (ids.has(e.id) || !nodes.has(e.node)) throw new Error('duplicate event or missing node');
    validateParent(e.parent, ids);
    if (typeof e.durationMs !== 'number' || !Number.isFinite(e.durationMs) || e.durationMs < 0) throw new Error('invalid duration');
    for (const change of array(e.changes)) {
      const c = record(change); text(c.key); text(c.before); text(c.after);
    }
    ids.add(e.id);
  }
}
export const sourceHash = (source: string | Buffer): string => createHash('sha256').update(source).digest('hex');
export function sourceManifest(sources: Record<string, string>): { sourceHashes: Record<string, string>; snapshotHash: string } {
  const sourceHashes = Object.fromEntries(Object.keys(sources).sort().map(file => [file, sourceHash(sources[file])]));
  return { sourceHashes, snapshotHash: sourceHash(JSON.stringify(sourceHashes)) };
}
function validateManifest(b: Record<string, unknown>, sources: Record<string, unknown>): void {
  const hashes = record(b.sourceHashes);
  const checked: Record<string, string> = {};
  for (const file of Object.keys(sources).sort()) {
    if (!file || file.startsWith('/') || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..') || file.includes('\0')) throw new Error('invalid source path');
    const content = sources[file]; text(content);
    if (hashes[file] !== sourceHash(content)) throw new Error('source hash mismatch');
    checked[file] = String(hashes[file]);
  }
  if (Object.keys(hashes).length !== Object.keys(sources).length || b.snapshotHash !== sourceHash(JSON.stringify(checked))) throw new Error('snapshot hash mismatch');
}
function validateEdges(value: unknown, nodes: Set<string>, sources: Record<string, unknown>): void {
  for (const item of array(value)) {
    const e = record(item); text(e.from); text(e.to); text(e.file); positive(e.line);
    if (!nodes.has(e.from) || !nodes.has(e.to) || e.kind !== 'call') throw new Error('invalid static edge');
    const source = sources[e.file]; text(source);
    if (e.line > source.split('\n').length) throw new Error('edge outside source');
  }
}
function validateSources(sources: Record<string, unknown>): void {
  if (Object.keys(sources).length > MAX_SOURCE_COUNT) throw new Error('too many sources');
  let bytes = 0;
  for (const source of Object.values(sources)) { text(source); bytes += Buffer.byteLength(source); }
  if (bytes > MAX_SOURCE_BYTES) throw new Error('sources too large');
}
export function validateBundle(value: unknown): asserts value is MeldBundle {
  const b = record(value);
  if (b.version !== 1) throw new Error('unsupported Mind Meld version');
  const sources = record(b.sources);
  validateSources(sources);
  validateManifest(b, sources);
  const nodes = validateNodes(b.nodes, sources);
  validateEdges(b.edges, nodes, sources);
  const keys = new Set<string>();
  for (const item of array(b.runs)) {
    const r = record(item); text(r.key); text(r.entry); text(r.output);
    if (r.snapshotHash !== b.snapshotHash) throw new Error('run belongs to another source snapshot');
    if (keys.has(r.key) || !nodes.has(r.entry)) throw new Error('duplicate run or missing entry');
    if (r.mode !== 'flow' && r.mode !== 'piece') throw new Error('invalid run mode');
    validateEvents(r.events, nodes); keys.add(r.key);
  }
}
