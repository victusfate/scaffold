#!/usr/bin/env node
/** Unit tests for the project-extensible SAST target list (security/sast-targets.txt) of security-scan-tools.ts.
 *  Pure: no scanners needed (the end-to-end gate test in security-gate.test.ts covers the live Semgrep path). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { SAST_TARGETS_FILE, parseSastTargets, sastTargets, reportSemgrep, semgrepPath } from './security-scan-tools.ts';

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

function semgrepFixture(headErrors: unknown[], baseErrors: unknown[] = headErrors, results = false) {
  const dir = cfgDir(null);
  const head = join(dir, 'head');
  const base = join(dir, 'base');
  for (const tree of [head, base]) {
    mkdirSync(tree);
    writeFileSync(join(tree, 'ship.sh'), 'echo changed\n');
  }
  const c = { findings: [], coverage: [] } as Pick<import('./security-scan-core.ts').Ctx, 'findings' | 'coverage'>;
  const finding = { check_id: 'test.danger', path: 'ship.sh', start: { line: 1 },
    extra: { severity: 'ERROR', message: 'dangerous command' } };
  try {
    reportSemgrep(c, { tree: head, out: { results: results ? [finding] : [], errors: headErrors } },
      { tree: base, out: { results: [], errors: baseErrors } }, ['ship.sh']);
    return c;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

void test('existing PartialParsing is visible coverage, with normalized paths and changed spans', () => {
  const c = semgrepFixture([{ type: ['PartialParsing', []], spans: [{ file: './ship.sh', start: { line: 99 } }] }],
    [{ type: ['PartialParsing', []], path: 'ship.sh', spans: [{ file: 'ship.sh', start: { line: 1 } }] }]);
  assert.deepEqual(c.findings, []);
  assert.deepEqual(c.coverage?.map(g => [g.at, g.type]), [['ship.sh', 'PartialParsing']]);
});

void test('new error type, new unparseable file, and real findings still block', () => {
  for (const errors of [[], [{ type: 'Syntax error', path: 'ship.sh' }]]) {
    assert.equal(semgrepFixture([{ type: 'PartialParsing', path: 'ship.sh' }], errors).findings.length, 1);
  }
  const c = semgrepFixture([{ type: 'PartialParsing', path: 'ship.sh' }], undefined, true);
  assert.equal(c.findings.length, 1);
  assert.equal(c.findings[0].id, 'sast:danger@ship.sh:1');
  assert.equal(c.coverage?.length, 1);
  assert.equal(semgrepFixture([{ type: 'PartialParsing', path: 'new.sh' }], []).findings.length, 1);
});

void test('unknown, global, out-of-target and ambiguous errors cannot be baselined', () => {
  for (const error of [
    { type: 'FatalError', path: 'ship.sh' }, { type: 'RuleParseError', path: 'ship.sh' },
    { type: 'PartialParsing' }, { type: 'PartialParsing', path: '../ship.sh' },
    { type: 'PartialParsing', path: 'ship.sh', spans: [{ file: 'other.sh' }] },
    { type: 'PartialParsing!', path: 'ship.sh' }, { type: ['PartialParsing', {}], path: 'ship.sh' }, { type: {}, path: 'ship.sh' },
  ]) assert.equal(semgrepFixture([error]).findings.length, 2, JSON.stringify(error));
  for (const error of [null, 'bad', { type: 'PartialParsing', path: 1 }, { spans: {} }]) {
    assert.throws(() => semgrepFixture([error]), /semgrep.*error/);
  }
});

void test('absolute export paths normalize to the same repo-relative coverage identity', () => {
  const dir = cfgDir(null);
  const base = join(dir, 'base');
  const head = join(dir, 'head');
  const c = { findings: [], coverage: [] } as Pick<import('./security-scan-core.ts').Ctx, 'findings' | 'coverage'>;
  try {
    for (const tree of [base, head]) { mkdirSync(tree); writeFileSync(join(tree, 'ship.sh'), 'echo fixture\n'); }
    reportSemgrep(c, { tree: head, out: { results: [], errors: [{ type: 'Syntax error', path: join(head, 'ship.sh') }] } },
      { tree: base, out: { results: [], errors: [{ type: 'Syntax error', spans: [{ file: './ship.sh' }] }] } }, ['ship.sh']);
    assert.deepEqual(c.findings, []);
    assert.equal(c.coverage?.[0].at, 'ship.sh');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

void test('a failed non-parser merge-base scan cannot supply a trusted baseline', () => {
  const c = semgrepFixture([], [{ type: 'FatalError', path: 'ship.sh' }]);
  assert.equal(c.findings.length, 1);
});

void test('a parser coverage gap repaired in HEAD no longer appears in findings or coverage', () => {
  const c = semgrepFixture([], [{ type: 'PartialParsing', path: 'ship.sh' }]);
  assert.deepEqual(c.findings, []);
  assert.deepEqual(c.coverage, []);
});

void test('inherited coverage cannot hide unknown or malformed baseline errors with the same display id', () => {
  const valid = { type: 'PartialParsing', path: 'ship.sh' };
  for (const type of ['PartialParsing!', ['PartialParsing', {}]]) {
    const c = semgrepFixture([valid], [valid, { type, path: 'ship.sh' }]);
    assert.equal(c.findings.length, 1, JSON.stringify(type));
    assert.equal(c.coverage?.length, 1);
  }
});

void test('native error path separators normalize to Git paths without changing literal POSIX backslashes', () => {
  assert.equal(semgrepPath('C:\\export', '.\\scripts\\ship.sh', win32), 'scripts/ship.sh');
  assert.equal(semgrepPath('C:\\export', 'C:\\export\\scripts\\ship.sh', win32), 'scripts/ship.sh');
  assert.equal(semgrepPath('/export', './scripts/ship.sh', posix), 'scripts/ship.sh');
  assert.equal(semgrepPath('/export', 'scripts/a\\b.sh', posix), 'scripts/a\\b.sh');
});

void test('nested Git target paths retain inherited coverage', () => {
  const dir = cfgDir(null);
  const base = join(dir, 'base');
  const head = join(dir, 'head');
  const c = { findings: [], coverage: [] } as Pick<import('./security-scan-core.ts').Ctx, 'findings' | 'coverage'>;
  try {
    for (const tree of [base, head]) {
      mkdirSync(join(tree, 'scripts'), { recursive: true });
      writeFileSync(join(tree, 'scripts/ship.sh'), 'echo fixture\n');
    }
    reportSemgrep(c, { tree: head, out: { results: [], errors: [{ type: 'PartialParsing', path: join(head, 'scripts/ship.sh') }] } },
      { tree: base, out: { results: [], errors: [{ type: 'PartialParsing', path: './scripts/ship.sh' }] } }, ['scripts/ship.sh']);
    assert.deepEqual(c.findings, []);
    assert.equal(c.coverage?.[0].at, 'scripts/ship.sh');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
