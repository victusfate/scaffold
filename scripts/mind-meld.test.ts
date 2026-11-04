#!/usr/bin/env node
// Mind Meld acceptance checks. Usage: node --test scripts/mind-meld.test.ts
// Real sandbox probes: RUN_MIND_MELD_SANDBOX=1 node --test scripts/mind-meld.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { index, run_flow, run_piece, diff, cacheKey, verifySnapshot } from './mind-meld.ts';
import { validateBundle, sourceManifest, type MeldBundle } from './mind-meld-schema.ts';
import { runSandbox, sandboxArgs } from './mind-meld-sandbox.ts';
import { renderViewer } from './mind-meld-viewer.ts';
import { loadTypeScript } from './typescript-runtime.ts';

// index() parses source with the optional typescript package; consumers without it skip these.
const parses = { skip: (await loadTypeScript()) ? false : 'typescript is not installed' };
const live = { skip: process.env.RUN_MIND_MELD_SANDBOX !== '1' || parses.skip };
function temp<T>(work: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'meld-test-'));
  try { return work(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function invalid(mutate: (bundle: MeldBundle) => void): void {
  const graph = index(); mutate(graph); assert.throws(() => validateBundle(graph));
}
void test('index cites real declarations and static call expressions', parses, () => {
  const graph = index(); validateBundle(graph);
  assert.equal(graph.nodes.length, 3);
  assert.ok(graph.nodes.every(n => n.line > 0 && !Object.hasOwn(n, 'tier')));
  assert.deepEqual(graph.edges.map(e => [e.from, e.to]).sort(), [['combat', 'damage'], ['combat', 'save']]);
  assert.notEqual(cacheKey('flow', { hp: 10, damage: 2 }), cacheKey('flow', { hp: 10, damage: 3 }));
  assert.equal(cacheKey('flow', { hp: 10, damage: 2 }), cacheKey('flow', { damage: 2, hp: 10 }));
});
void test('freshness compares every source byte and refuses a changed checkout', parses, () => temp(root => {
  const graph = index();
  for (const [file, source] of Object.entries(graph.sources)) {
    const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, source);
  }
  verifySnapshot(graph, root);
  writeFileSync(join(root, graph.nodes[0].file), '// changed after recording');
  assert.throws(() => verifySnapshot(graph, root), /stale source snapshot/);
}));
void test('malformed graph, hashes, paths, spans, and dangling edges fail closed', parses, () => {
  invalid(b => { b.version = 2 as 1; });
  invalid(b => { b.nodes[1].id = b.nodes[0].id; });
  invalid(b => { b.nodes[0].line = -1; });
  invalid(b => { b.nodes[0].endLine = 999999; });
  invalid(b => { b.edges[0].to = 'invented'; });
  invalid(b => { b.sources[b.nodes[0].file] += '// tampered'; });
  invalid(b => { b.sourceHashes.extra = 'invented'; });
  invalid(b => { b.snapshotHash = 'invented'; });
  invalid(b => { b.sources['../outside'] = 'no'; });
});
void test('unknown targets, malformed inputs and fake policies never execute', () => {
  assert.throws(() => run_flow('unknown', {}), /only combat/);
  assert.throws(() => run_flow('combat', { hp: 1, damage: -1 }), /nonnegative/);
  assert.throws(() => run_flow('combat', { hp: 1, damage: 1, extra: true }), /only hp/);
  assert.throws(() => run_piece('damage', { hp: 1, damage: 1 }, { save: 'production' }), /memory/);
});
void test('offline viewer escapes injected source and allows only hashed scripts', parses, () => {
  const bundle = index();
  bundle.sources[bundle.nodes[0].file] += '\n</script><img src=x onerror=alert(1)>';
  Object.assign(bundle, sourceManifest(bundle.sources));
  const html = renderViewer(bundle);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes('snapshot')); assert.ok(html.includes('freshness is unknown'));
  assert.ok(html.includes('Static dependencies')); assert.ok(html.includes('Observed call edges'));
  assert.ok(!html.includes('innerHTML'));
  assert.ok(!html.includes(['<', 'script src='].join('')));
});
void test('sandbox arguments enforce read-only source, offline resources, unprivileged user', () => {
  const args = sandboxArgs(import.meta.filename, 'test-owned-child', []);
  for (const flag of ['--network=none', '--read-only', '--pull=never', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534']) assert.ok(args.includes(flag));
});
void test('real container flow, piece, cache and run comparison', live, () => {
  const a = run_flow('combat', { hp: 10, damage: 3 });
  const b = run_piece('damage', { hp: 10, damage: 30 }, { save: 'memory' });
  assert.equal(a.output, '7'); assert.equal(b.output, '0');
  assert.deepEqual(a.events.map(e => e.node), ['combat', 'damage', 'save']);
  assert.deepEqual(b.events.map(e => e.node), ['damage']);
  assert.deepEqual(a, run_flow('combat', { hp: 10, damage: 3 }));
  assert.notDeepEqual(diff(a, b).pathA, diff(a, b).pathB);
  assert.equal(a.events[1].changes[0].after, '7');
  const bundle = { ...index(), runs: [a] }; validateBundle(bundle);
  a.snapshotHash = 'wrong'; assert.throws(() => validateBundle(bundle), /another source snapshot/);
});
void test('real sandbox denies repository writes and external network, allows isolated save', live, () => temp(root => {
  const file = join(root, 'probe.ts');
  writeFileSync(file, `import {writeFileSync} from 'node:fs';\nimport {connect} from 'node:net';\ntry {writeFileSync('/app/example.ts','tamper'); throw new Error('writable source');} catch(e) {if (!['EROFS','EACCES'].includes(e.code)) throw e;}\nwriteFileSync('/work/save.json','isolated');\nconst socket = connect({host:'1.1.1.1',port:53});\nsocket.on('connect',()=>{throw new Error('network connected');});\nsocket.on('error',e=>{if(e.code!=='ENETUNREACH') throw e;console.log('isolated');});`);
  assert.equal(runSandbox(file, []).trim(), 'isolated');
}));
void test('real sandbox kills a timed-out computation', live, () => temp(root => {
  const file = join(root, 'loop.ts'); writeFileSync(file, 'while(true) {}');
  assert.throws(() => runSandbox(file, [], 1500), /sandbox failed/);
}));
