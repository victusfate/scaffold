#!/usr/bin/env node
// Tests for scripts/render-diagrams.ts — the source stamp that lets npm test catch a stale SVG
// without rendering anything.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sourceHash, stampSvg, staleSvgs } from './render-diagrams.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>';

function dirs(): { src: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'render-diagrams-'));
  const src = join(root, 'src'), out = join(root, 'generated');
  mkdirSync(src); mkdirSync(out);
  return { src, out };
}

void test('a stamped SVG matching its source is current', () => {
  const { src, out } = dirs();
  writeFileSync(join(src, 'tdd.mmd'), 'flowchart LR\n  a --> b\n');
  writeFileSync(join(out, 'tdd.svg'), stampSvg(SVG, sourceHash('flowchart LR\n  a --> b\n')));
  assert.deepEqual(staleSvgs(src, out), []);
});

void test('an edited source, an unstamped SVG or a missing SVG is stale', () => {
  const { src, out } = dirs();
  writeFileSync(join(src, 'edited.mmd'), 'flowchart LR\n  a --> c\n');
  writeFileSync(join(out, 'edited.svg'), stampSvg(SVG, sourceHash('flowchart LR\n  a --> b\n')));
  writeFileSync(join(src, 'unstamped.mmd'), 'x');
  writeFileSync(join(out, 'unstamped.svg'), SVG);
  writeFileSync(join(src, 'missing.mmd'), 'x');
  assert.deepEqual(staleSvgs(src, out), [
    'generated/edited.svg is stale: run npm run diagrams -- edited',
    'generated/missing.svg is stale: run npm run diagrams -- missing',
    'generated/unstamped.svg is stale: run npm run diagrams -- unstamped',
  ]);
});

void test('stamping twice keeps one stamp', () => {
  const once = stampSvg(SVG, 'aaa');
  assert.equal(stampSvg(once, 'bbb'), stampSvg(SVG, 'bbb'));
});
