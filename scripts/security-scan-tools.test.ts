#!/usr/bin/env node
/** Unit tests for the project-extensible SAST target list (security/sast-targets.txt) of security-scan-tools.ts.
 *  Pure: no scanners needed (the end-to-end gate test in security-gate.test.ts covers the live Semgrep path). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SAST_TARGETS_FILE, parseSastTargets, sastTargets } from './security-scan-tools.ts';

/** A gate dir holding `list` as its security/sast-targets.txt (or none when `list` is null). */
function cfgDir(list: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'sast-targets-'));
  if (list !== null) {
    mkdirSync(join(dir, 'security'), { recursive: true });
    writeFileSync(join(dir, SAST_TARGETS_FILE), list);
  }
  return dir;
}

void test('without a list only the built-in languages are SAST targets', () => {
  const dir = cfgDir(null);
  const isTarget = sastTargets(dir);
  for (const p of ['a.py', 'src/b.rs', 'c.ts', 'deep/d.yaml']) assert.ok(isTarget(p), p);
  for (const p of ['game/e.gd', 'Dockerfile', 'README.md']) assert.ok(!isTarget(p), p);
  rmSync(dir, { recursive: true, force: true });
});

void test('listed extensions and file names are added; built-ins stay', () => {
  const dir = cfgDir('# engine scripts\n.gd\n.TPL   # case-insensitive\n\nDockerfile\n');
  const isTarget = sastTargets(dir);
  for (const p of ['game/e.gd', 'x.tpl', 'X.Tpl', 'Dockerfile', 'svc/Dockerfile', 'a.py']) assert.ok(isTarget(p), p);
  for (const p of ['gd', 'x.gdx', 'Dockerfile.bak', 'dockerfile', '.gd/readme', 'README.md']) assert.ok(!isTarget(p), p);
  rmSync(dir, { recursive: true, force: true });
});

void test('a dotfile is not mistaken for an extension', () => {
  const isTarget = sastTargets(cfgDir('.env\n'));
  assert.ok(isTarget('cfg/app.env'));
  assert.ok(!isTarget('.env'), 'a bare dotfile name has no extension; list it without the dot to match it');
  assert.ok(sastTargets(cfgDir('.env\n'))('x.env'));
});

void test('a malformed line fails closed, naming the line', () => {
  for (const bad of ['*.gd', '.(gd|py)', '../x', 'a b', '.', 'src/x.gd', '.gd$', '\\.gd', '.tar.gz']) {
    assert.throws(() => parseSastTargets(`.ok\n${bad}\n`), new RegExp(`${SAST_TARGETS_FILE.replace('.', '\\.')}:2`), bad);
  }
});

void test('tokens are literal, never regex', () => {
  const { exts, names } = parseSastTargets('.c++\nMake-file\nDockerfile.dev\n');
  assert.deepEqual([...exts], ['.c++']);
  assert.deepEqual([...names], ['Make-file', 'Dockerfile.dev']);
  assert.ok(sastTargets(cfgDir('Dockerfile.dev\n'))('svc/Dockerfile.dev'), 'a dotted file name matches exactly');
});
