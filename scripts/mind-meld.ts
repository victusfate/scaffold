#!/usr/bin/env node
// Mind Meld reference adapter and offline viewer CLI.
// Usage: node scripts/mind-meld.ts index|flow|piece|demo [JSON inputs]
//        node scripts/mind-meld.ts diff run-a.json run-b.json
//        node scripts/mind-meld.ts view bundle.json > tour.html
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type ts from 'typescript';
import { loadTypeScript } from './typescript-runtime.ts';
import { runSandbox, MELD_IMAGE, MELD_LIMIT_MS } from './mind-meld-sandbox.ts';
import { validateBundle, sourceHash, sourceManifest, type MeldBundle, type MeldRun, type MeldNode, type MeldEdge } from './mind-meld-schema.ts';
import { renderViewer } from './mind-meld-viewer.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = 'scripts/mind-meld-example.ts';
const DEFAULT_INPUTS = { hp: 10, damage: 3 };
const LETHAL_INPUTS = { hp: 10, damage: 30 };
const IMPLEMENTATION = ['mind-meld.ts', 'mind-meld-schema.ts', 'mind-meld-sandbox.ts', 'mind-meld-example.ts', 'mind-meld-viewer.ts'];
const cache = new Map<string, MeldRun>();
const compiler = await loadTypeScript();   // optional: only index() parses source
function missingTypeScript(): never {
  throw new Error('mind meld index needs the typescript package: install it (npm i -D typescript) or set SCAFFOLD_TYPESCRIPT_DIR');
}
interface Inputs { hp: number; damage: number }
function inputs(value: unknown): Inputs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected {hp, damage}');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'damage,hp') throw new Error('expected only hp and damage');
  for (const n of [raw.hp, raw.damage]) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error('hp and damage must be nonnegative finite numbers');
  }
  return { hp: Number(raw.hp), damage: Number(raw.damage) };
}

/** Parse real declaration/call spans. Static edges are possibilities, never execution claims. */
export function index(): MeldBundle {
  const tsc = compiler ?? missingTypeScript();
  const sources = Object.fromEntries(IMPLEMENTATION.map(file => [`scripts/${file}`, readFileSync(join(ROOT, 'scripts', file), 'utf8')]));
  const ast = tsc.createSourceFile(EXAMPLE, sources[EXAMPLE], tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TS);
  const functions = ast.statements.filter(tsc.isFunctionDeclaration).filter(f => f.modifiers?.some(m => m.kind === tsc.SyntaxKind.ExportKeyword));
  const nodes: MeldNode[] = functions.map(f => ({
    id: f.name!.text, file: EXAMPLE,
    line: ast.getLineAndCharacterOfPosition(f.getStart(ast)).line + 1,
    endLine: ast.getLineAndCharacterOfPosition(f.getEnd()).line + 1,
    layer: f.name!.text === 'combat' ? 'entry' : 'core',
  }));
  const ids = new Set(nodes.map(n => n.id));
  const edges: MeldEdge[] = [];
  for (const f of functions) {
    function visit(node: ts.Node): void {
      if (tsc.isCallExpression(node) && tsc.isIdentifier(node.expression) && ids.has(node.expression.text)) {
        edges.push({ from: f.name!.text, to: node.expression.text, file: EXAMPLE,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind: 'call' });
      }
      tsc.forEachChild(node, visit);
    }
    visit(f);
  }
  return { version: 1, nodes, edges, sources, ...sourceManifest(sources), runs: [] };
}

/** Verify recorded source bytes against a checkout; offline HTML cannot perform this check. */
export function verifySnapshot(bundle: MeldBundle, root = ROOT): void {
  validateBundle(bundle);
  const base = realpathSync(root);
  for (const [file, hash] of Object.entries(bundle.sourceHashes)) {
    const path = realpathSync(resolve(base, file));
    if (!path.startsWith(base + sep) || sourceHash(readFileSync(path, 'utf8')) !== hash) throw new Error(`stale source snapshot: ${file}`);
  }
}

/** Includes every execution dependency, runtime/image, inputs, fake policy and schema. */
export function cacheKey(mode: 'flow' | 'piece', value: unknown, snapshot = index()): string {
  const snapshotHash = snapshot.snapshotHash;
  return createHash('sha256').update(JSON.stringify({ version: 1, snapshotHash, compiler: compiler?.version ?? null, image: MELD_IMAGE, mode, inputs: inputs(value), fakes: { save: 'memory' } })).digest('hex');
}
function run(mode: 'flow' | 'piece', value: unknown): MeldRun {
  const normalized = inputs(value);
  const snapshot = index();
  const key = cacheKey(mode, normalized, snapshot);
  const hit = cache.get(key);
  if (hit) return structuredClone(hit);
  const raw = JSON.parse(runSandbox(join(ROOT, EXAMPLE), [mode, JSON.stringify(normalized)], MELD_LIMIT_MS, snapshot.sourceHashes[EXAMPLE])) as Record<string, unknown>;
  const result = { ...raw, key, snapshotHash: snapshot.snapshotHash, mode, entry: mode === 'flow' ? 'combat' : 'damage' } as MeldRun;
  if (index().snapshotHash !== snapshot.snapshotHash) throw new Error('source changed during execution');
  validateBundle({ ...snapshot, runs: [result] });
  cache.set(key, structuredClone(result));
  return result;
}
export function run_flow(entry: string, value: unknown): MeldRun {
  if (entry !== 'combat') throw new Error('reference flow supports only combat');
  return run('flow', value);
}
export function run_piece(target: string, value: unknown, fakes: { save: string }): MeldRun {
  if (target !== 'damage' || Object.keys(fakes).join(',') !== 'save' || fakes.save !== 'memory') throw new Error('reference piece supports damage with save: memory');
  return run('piece', value);
}
export function diff(a: MeldRun, b: MeldRun): { pathA: string[]; pathB: string[]; outputA: string; outputB: string; changesA: unknown[]; changesB: unknown[] } {
  return { pathA: a.events.map(e => e.node), pathB: b.events.map(e => e.node), outputA: a.output, outputB: b.output,
    changesA: a.events.flatMap(e => e.changes), changesB: b.events.flatMap(e => e.changes) };
}
function jsonFile(file: string | undefined): unknown {
  if (!file) throw new Error('missing JSON file');
  if (statSync(file).size > 10_000_000) throw new Error('bundle too large');
  const text = readFileSync(file, 'utf8');
  if (text.length > 10_000_000) throw new Error('bundle too large');
  return JSON.parse(text) as unknown;
}
function fileCommand(command: string, arg: string | undefined, other: string | undefined): boolean {
  if (!['view', 'verify', 'diff'].includes(command)) return false;
  const bundle = jsonFile(arg); validateBundle(bundle);
  if (command === 'view') console.log(renderViewer(bundle));
  else if (command === 'verify') {
    verifySnapshot(bundle, other); console.log(`source snapshot verified: ${bundle.snapshotHash}`);
  } else {
    const b = jsonFile(other); validateBundle(b);
    if (bundle.runs.length !== 1 || b.runs.length !== 1) throw new Error('diff expects one run per bundle');
    console.log(JSON.stringify(diff(bundle.runs[0], b.runs[0]), null, 2));
  }
  return true;
}
function createBundle(command: string, arg: string | undefined): MeldBundle {
  const bundle = index();
  if (command === 'flow') bundle.runs.push(run_flow('combat', JSON.parse(arg ?? JSON.stringify(DEFAULT_INPUTS))));
  else if (command === 'piece') bundle.runs.push(run_piece('damage', JSON.parse(arg ?? JSON.stringify(DEFAULT_INPUTS)), { save: 'memory' }));
  else if (command === 'demo' && !arg) {
    bundle.runs.push(run_flow('combat', DEFAULT_INPUTS), run_flow('combat', LETHAL_INPUTS), run_piece('damage', DEFAULT_INPUTS, { save: 'memory' }));
  } else if (command !== 'index' || arg) throw new Error('usage: mind-meld.ts index|flow|piece|demo|diff|view|verify');
  return bundle;
}
function main(args: string[]): void {
  const [command, arg, other] = args;
  if (!command || args.length > (['diff', 'verify'].includes(command) ? 3 : 2)) throw new Error('invalid arguments');
  if (fileCommand(command, arg, other)) return;
  const bundle = createBundle(command, arg);
  validateBundle(bundle); console.log(JSON.stringify(bundle, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
