#!/usr/bin/env node
// Tests for scripts/mind-meld-pages.ts — a validated mind-meld bundle as a GitHub markdown page.
// No Docker: the reference index plus a synthetic run shaped like a real recording.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { index } from './mind-meld.ts';
import type { MeldBundle, MeldRun } from './mind-meld-schema.ts';
import { bundleToSpec, renderPage } from './mind-meld-pages.ts';
import { loadTypeScript } from './typescript-runtime.ts';

const parses = { skip: (await loadTypeScript()) ? false : 'typescript is not installed' };

function recorded(): MeldBundle {
  const bundle = index();
  const flow: MeldRun = { key: 'k1', snapshotHash: bundle.snapshotHash, mode: 'flow', entry: 'combat', output: '7', events: [
    { id: 'e1', node: 'combat', parent: null, durationMs: 2, input: '{"hp":10,"damage":3}', output: '7', changes: [] },
    { id: 'e2', node: 'damage', parent: 'e1', durationMs: 1, input: '{"hp":10,"damage":3}', output: '7', changes: [{ key: 'hp', before: '10', after: '7' }] },
    { id: 'e3', node: 'save', parent: 'e1', durationMs: 1, input: '{"hp":7}', output: 'null', changes: [] },
  ] };
  const piece: MeldRun = { key: 'k2', snapshotHash: bundle.snapshotHash, mode: 'piece', entry: 'damage', output: '0', events: [
    { id: 'p1', node: 'damage', parent: null, durationMs: 1, input: '{"hp":10,"damage":30}', output: '0', changes: [] },
  ] };
  return { ...bundle, runs: [flow, piece] };
}

void test('layers become lanes and indexed functions become stages with their source span', parses, () => {
  const spec = bundleToSpec(recorded(), { sourcePrefix: '../' });
  assert.deepEqual(spec.lanes.map(l => l.id), ['entry', 'core']);
  assert.equal(spec.nodes.damage.role, 'Defined in scripts/mind-meld-example.ts:15-21.');
  assert.match(String(spec.lede), /snapshot [0-9a-f]+.*unknown until .*verify/);
  assert.deepEqual(Object.keys(spec.nodes), ['combat', 'damage', 'save'], 'entry point first');
});

void test('a run with nested calls becomes a flow; values stay in code spans', parses, () => {
  const spec = bundleToSpec(recorded(), { sourcePrefix: '../' });
  assert.equal(spec.flows?.length, 1);
  assert.deepEqual(spec.flows?.[0].steps.map(s => [s[0], s[1]]), [['combat', 'damage'], ['combat', 'save']]);
  assert.equal(spec.flows?.[0].steps[0][2], 'called with `{"hp":10,"damage":3}`');
});

void test('the page holds only indexed and recorded facts', parses, () => {
  const page = renderPage(recorded(), { sourcePrefix: '../' });
  assert.match(page, /\[scripts\/mind-meld-example\.ts:15-21\]\(<\.\.\/scripts\/mind-meld-example\.ts#L15-L21>\)/);
  assert.match(page, /Static calls \(possible, not observed\): damage, save/);
  assert.match(page, /flow k1: called with `\{"hp":10,"damage":3\}`, returned `7`\n {2}- `hp`: `10` → `7`/);
  assert.match(page, /piece k2: called with `\{"hp":10,"damage":30\}`, returned `0`/);
  assert.match(page, /```\nexport function damage/);
});

void test('an invalid bundle is rejected before rendering', parses, () => {
  const bad = recorded(); bad.runs[0].snapshotHash = 'other';
  assert.throws(() => renderPage(bad, { sourcePrefix: '../' }), /snapshot/);
});

void test('CLI: mind-meld.ts pages <bundle> [source-prefix] prints the page', parses, () => {
  const file = join(mkdtempSync(join(tmpdir(), 'meld-pages-')), 'bundle.json');
  writeFileSync(file, JSON.stringify(recorded()));
  const cli = (...args: string[]) => spawnSync(process.execPath, ['scripts/mind-meld.ts', 'pages', file, ...args], { encoding: 'utf8' });
  const page = cli('docs/../');
  assert.equal(page.status, 0, page.stderr);
  assert.match(page.stdout, /^# Mind meld: combat, damage/);
  assert.match(page.stdout, /\]\(<docs\/\.\.\/scripts\/mind-meld-example\.ts#L/);
  assert.match(cli().stdout, /\]\(<\.\.\/scripts\/mind-meld-example\.ts#L/, 'default prefix is ../');
});

void test('an index-only bundle says no runs were recorded and draws only static calls', parses, () => {
  const spec = bundleToSpec(index(), { sourcePrefix: '../' });
  assert.match(String(spec.lede), /^Indexed from this repo's source at snapshot [0-9a-f]+\. No runs were recorded/);
  assert.deepEqual(spec.flows?.map(f => f.name), ['Static calls (possible, not observed)']);
  assert.deepEqual(spec.flows?.[0].steps.map(s => [s[0], s[1]]).sort(), [['combat', 'damage'], ['combat', 'save']]);
});

void test('runs with no nested call, or an index with no edges, draw no invented arrows', parses, () => {
  const pieceOnly = recorded(); pieceOnly.runs = [pieceOnly.runs[1]];
  assert.doesNotMatch(renderPage(pieceOnly, { sourcePrefix: '../' }).split('```mermaid')[1].split('```')[0], /-->/);
  const noEdges = { ...index(), edges: [] };
  assert.doesNotMatch(renderPage(noEdges, { sourcePrefix: '../' }).split('```mermaid')[1].split('```')[0], /-->/);
});

void test('recorded values and excerpts are shown exactly; odd paths and layers still render', parses, () => {
  const bundle = recorded();
  bundle.runs[0].events[1].input = 'a`b``c';
  bundle.runs[0].events[1].output = 'x\ny';
  const page = renderPage(bundle, { sourcePrefix: '../' });
  assert.ok(page.includes('called with ```a`b``c```'), 'backticks kept with a longer delimiter');
  assert.ok(page.includes('returned `x\\ny`'), 'newline shown as \\n, not folded');
  const odd = index(); odd.nodes[0].layer = '';
  const spec = bundleToSpec(odd, { sourcePrefix: '../' });
  assert.ok(spec.lanes.some(l => l.name === '(no layer)'), 'empty layer gets a named lane');
  assert.match(renderPage(odd, { sourcePrefix: 'my dir/' }), /\]\(<my dir\/scripts\/mind-meld-example\.ts#L/);
});

void test('an index-only LLM block does not claim recorded runs', parses, () => {
  assert.equal(bundleToSpec(index(), { sourcePrefix: '../' }).ask?.context.includes('recorded runs'), false);
});
