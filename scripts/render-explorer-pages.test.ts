#!/usr/bin/env node
// Tests for scripts/render-explorer-pages.ts — build and check docs/diagrams/pages from explorer specs.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPages } from './render-explorer-pages.ts';

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

void test('check reports stale and missing pages without writing', () => {
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
