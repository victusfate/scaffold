#!/usr/bin/env node
// Tests for scripts/render-explorer-pages.ts — build and check docs/diagrams/pages from explorer specs.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ackPages, buildPages } from './render-explorer-pages.ts';

function site(nodeLink: string, detail = '../generated/x.svg'): string {
  const root = mkdtempSync(join(tmpdir(), 'explorer-pages-'));
  mkdirSync(join(root, 'explorer')); mkdirSync(join(root, 'pages')); mkdirSync(join(root, 'generated'));
  writeFileSync(join(root, 'generated', 'x.svg'), '<svg/>');
  const spec = (title: string, link?: string) => JSON.stringify({ title, detail, lanes: [{ id: 'l', name: 'L' }],
    nodes: { a: { lane: 'l', name: 'A', role: 'Does a.', ...(link ? { link } : {}) } } });
  writeFileSync(join(root, 'explorer', 'map.explorer.json'), spec('Map', nodeLink));
  writeFileSync(join(root, 'explorer', 'x.explorer.json'), spec('X'));
  return root;
}

void test('writes one page per spec, then check passes', () => {
  const root = site('x.md');
  assert.deepEqual(buildPages(root, { check: false }), []);
  assert.match(readFileSync(join(root, 'pages', 'map.md'), 'utf8'), /^# Map/);
  assert.deepEqual(buildPages(root, { check: true }), []);
});

void test('check reports a stale page without writing', () => {
  const root = site('x.md');
  buildPages(root, { check: false });
  writeFileSync(join(root, 'pages', 'x.md'), 'edited by hand\n');
  assert.deepEqual(buildPages(root, { check: true }), ['pages/x.md is stale: run npm run diagrams']);
  assert.equal(readFileSync(join(root, 'pages', 'x.md'), 'utf8'), 'edited by hand\n');
});

void test('broken links and a missing detail image are problems', () => {
  const problems = buildPages(site('nope.md', '../generated/missing.svg'), { check: false });
  assert.ok(problems.some(p => p.includes('map: node a links to missing nope.md')), problems.join('\n'));
  assert.ok(problems.some(p => p.includes('detail image missing ../generated/missing.svg')), problems.join('\n'));
});

void test('a term defined differently on two pages is a problem', () => {
  const root = site('x.md');
  const withTerm = (title: string, d: string) => JSON.stringify({ title, lanes: [{ id: 'l', name: 'L' }],
    nodes: { a: { lane: 'l', name: 'A', role: 'Does a.' } }, glossary: { prd: { t: 'PRD', a: ['PRD'], d } } });
  writeFileSync(join(root, 'explorer', 'one.explorer.json'), withTerm('One', 'Product requirements document.'));
  writeFileSync(join(root, 'explorer', 'two.explorer.json'), withTerm('Two', 'Product requirements doc.'));
  assert.deepEqual(buildPages(root, { check: false }).filter(p => p.includes('PRD')),
    ['glossary: "PRD" is defined differently in one and two']);
});

void test('text GitHub would hide as an HTML tag is a problem; code spans are fine', () => {
  const root = site('x.md');
  const spec = (role: string) => JSON.stringify({ title: 'T', lanes: [{ id: 'l', name: 'L' }], nodes: { a: { lane: 'l', name: 'A', role } } });
  writeFileSync(join(root, 'explorer', 'bad.explorer.json'), spec('Writes docs/<slug>/design.md.'));
  writeFileSync(join(root, 'explorer', 'ok.explorer.json'), spec('Writes `docs/<slug>/design.md`.'));
  assert.deepEqual(buildPages(root, { check: false }).filter(p => p.includes('hidden')),
    ['bad: "<slug>" would be hidden by GitHub as an HTML tag; wrap it in backticks']);
});

void test('a stage named like a page heading, or two stages with one name, is a problem', () => {
  const root = site('x.md');
  writeFileSync(join(root, 'explorer', 'clash.explorer.json'), JSON.stringify({ title: 'C', lanes: [{ id: 'l', name: 'L' }],
    nodes: { a: { lane: 'l', name: 'Glossary', role: 'r' }, b: { lane: 'l', name: 'Fix', role: 'r' }, c: { lane: 'l', name: 'Fix', role: 'r' } } }));
  assert.deepEqual(buildPages(root, { check: false }).filter(p => p.startsWith('clash')).sort(),
    ['clash: two headings share the anchor #fix; rename the stage', 'clash: two headings share the anchor #glossary; rename the stage']);
});

void test('a page whose sources changed since review is flagged until acknowledged', () => {
  const root = site('x.md');
  writeFileSync(join(root, 'tdd.md'), 'v1');
  const spec = (reviewed: string) => JSON.stringify({ title: 'T', sources: ['tdd.md'], reviewed,
    lanes: [{ id: 'l', name: 'L' }], nodes: { a: { lane: 'l', name: 'A', role: 'r' } } }, null, 2);
  writeFileSync(join(root, 'explorer', 't.explorer.json'), spec('000000000000'));
  const options = { check: false, repoRoot: root };
  assert.deepEqual(buildPages(root, options).filter(p => p.startsWith('t:')),
    ['t: its sources changed since the page was last reviewed (tdd.md): review it, then run npm run diagrams:ack -- t']);
  assert.deepEqual(ackPages(root, ['t'], root), ['t']);
  assert.deepEqual(buildPages(root, options).filter(p => p.startsWith('t:')), []);
  writeFileSync(join(root, 'tdd.md'), 'v2');
  assert.equal(buildPages(root, options).filter(p => p.startsWith('t:')).length, 1);
});

void test('a listed source that does not exist is a problem', () => {
  const root = site('x.md');
  writeFileSync(join(root, 'explorer', 'g.explorer.json'), JSON.stringify({ title: 'G', sources: ['gone.md'], reviewed: 'x',
    lanes: [{ id: 'l', name: 'L' }], nodes: { a: { lane: 'l', name: 'A', role: 'r' } } }));
  assert.ok(buildPages(root, { check: false, repoRoot: root }).includes('g: source gone.md does not exist'));
});
