#!/usr/bin/env node
// Tests for scripts/mind-meld-map.ts — a static, language-aware map of a repo as drill-down pages.
// Fixture: a small repo with TypeScript, Python and Rust code, plus test files the map leaves out.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scanRepo, writeMap } from './mind-meld-map.ts';

const FILES: Record<string, string> = {
  'web/app.ts': "import { total } from './cart.ts';\nexport function main(): number {\n  return total([1, 2]);\n}\n",
  'web/cart.ts': 'export function total(items: number[]): number {\n  return items.reduce((a, b) => a + b, 0);\n}\nexport class Cart {}\n',
  'web/cart.test.ts': "import { total } from './cart.ts';\n",
  'svc/api.py': 'from svc.models import User\nimport svc.db\n\ndef handler():\n    return User()\n\nclass Api:\n    pass\n',
  'svc/models.py': 'from .db import connect\n\nclass User:\n    pass\n',
  'svc/db.py': 'def connect():\n    return None\n',
  'svc/test_api.py': 'import svc.api\n',
  'engine/src/lib.rs': 'mod physics;\n\npub fn step() {}\n\npub struct World;\n',
  'engine/src/physics.rs': 'use crate::World;\n\npub fn gravity(w: &World) {}\n',
  'jobs/lib/report.rb': "require_relative 'format'\n\nmodule Jobs\n  class Report\n    def run; end\n  end\nend\n",
  'jobs/lib/format.rb': 'def format_row(row)\n  row.join(",")\nend\n',
  'jobs/spec/report_spec.rb': "require_relative '../lib/report'\n",
  '.github/scripts/check.ts': 'export function check(): void {}\n',
  'README.md': '# fixture\n',
};

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'meld-map-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

const byFile = (facts: Awaited<ReturnType<typeof scanRepo>>) => Object.fromEntries(facts.map(f => [f.file, f]));

void test('TypeScript: exported definitions from the compiler, relative imports resolved; tests left out', async () => {
  const facts = byFile(await scanRepo(fixture()));
  assert.equal(facts['web/cart.test.ts'], undefined);
  assert.deepEqual(facts['web/cart.ts'].definitions, [{ name: 'total', kind: 'function', line: 1 }, { name: 'Cart', kind: 'class', line: 4 }]);
  assert.deepEqual(facts['web/app.ts'].imports, ['web/cart.ts']);
  assert.match(facts['web/app.ts'].method, /TypeScript compiler/);
});

void test('Python: top-level definitions from ast, absolute imports resolved; tests left out', async () => {
  const facts = byFile(await scanRepo(fixture()));
  assert.equal(facts['svc/test_api.py'], undefined);
  assert.deepEqual(facts['svc/api.py'].definitions, [{ name: 'handler', kind: 'function', line: 4 }, { name: 'Api', kind: 'class', line: 7 }]);
  assert.deepEqual(facts['svc/api.py'].imports.sort(), ['svc/db.py', 'svc/models.py']);
  assert.match(facts['svc/api.py'].method, /Python ast/);
  assert.deepEqual(facts['svc/models.py'].imports, ['svc/db.py'], 'relative import resolved');
});

void test('Rust: item lines by pattern, mod and use crate:: resolved by module rules', async () => {
  const facts = byFile(await scanRepo(fixture()));
  assert.deepEqual(facts['engine/src/lib.rs'].definitions, [
    { name: 'physics', kind: 'mod', line: 1 }, { name: 'step', kind: 'fn', line: 3 }, { name: 'World', kind: 'struct', line: 5 }]);
  assert.deepEqual(facts['engine/src/lib.rs'].imports, ['engine/src/physics.rs']);
  assert.deepEqual(facts['engine/src/physics.rs'].imports, ['engine/src/lib.rs']);
  assert.match(facts['engine/src/lib.rs'].method, /pattern/);
});

void test('Ruby: def/class/module lines by pattern, require_relative resolved; specs left out', async () => {
  const facts = byFile(await scanRepo(fixture()));
  assert.equal(facts['jobs/spec/report_spec.rb'], undefined);
  assert.deepEqual(facts['jobs/lib/report.rb'].definitions, [
    { name: 'Jobs', kind: 'module', line: 3 }, { name: 'Report', kind: 'class', line: 4 }, { name: 'run', kind: 'def', line: 5 }]);
  assert.deepEqual(facts['jobs/lib/report.rb'].imports, ['jobs/lib/format.rb']);
  assert.match(facts['jobs/lib/report.rb'].method, /pattern/);
});

void test('writeMap: a repo map linking to one page per area, with source links and import arrows', async () => {
  const root = fixture();
  const out = join(root, 'docs', 'map');
  const written = await writeMap(root, out);
  assert.deepEqual(written.sort(), ['engine.md', 'github.md', 'index.md', 'jobs.md', 'svc.md', 'web.md']);
  assert.match(readFileSync(join(out, 'index.md'), 'utf8'), /- \[\.github\]\(github\.md\)/);
  const index = readFileSync(join(out, 'index.md'), 'utf8');
  assert.match(index, /- \[svc\]\(svc\.md\): 3 modules \(Python\)/);
  const svc = readFileSync(join(out, 'svc.md'), 'utf8');
  assert.match(svc, /^\[← .*\]\(index\.md\)/);
  assert.match(svc, /n_svc_api_py\["api\.py"\] --> n_svc_models_py\["models\.py"\]/);
  assert.match(svc, /`handler` \(function\): \[line 4\]\(<\.\.\/\.\.\/svc\/api\.py#L4>\)/);
  assert.doesNotMatch(svc, /test_api/);
});

void test('any language: a repo adds its own adapter in .mind-meld/languages, no scaffold change', async () => {
  const root = fixture();
  mkdirSync(join(root, '.mind-meld', 'languages'), { recursive: true });
  writeFileSync(join(root, '.mind-meld', 'languages', 'elixir.ts'), `
const DEF = /^\\s*(defmodule|def|defp)\\s+([\\w.?!]+)/;
export default {
  name: 'Elixir',
  extensions: ['.ex', '.exs'],
  facts: (files, ctx) => files.map(file => ({
    file,
    definitions: ctx.read(file).split('\\n').flatMap((line, i) => {
      const m = DEF.exec(line);
      return m ? [{ name: m[2], kind: m[1], line: i + 1 }] : [];
    }),
    imports: [],
    method: 'pattern match on Elixir def lines',
  })),
};
`);
  mkdirSync(join(root, 'api', 'lib'), { recursive: true });
  writeFileSync(join(root, 'api', 'lib', 'router.ex'), 'defmodule Api.Router do\n  def route(conn), do: conn\nend\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  const facts = byFile(await scanRepo(root));
  assert.equal(facts['api/lib/router.ex'].language, 'Elixir');
  assert.deepEqual(facts['api/lib/router.ex'].definitions, [{ name: 'Api.Router', kind: 'defmodule', line: 1 }, { name: 'route', kind: 'def', line: 2 }]);
  assert.equal(facts['.mind-meld/languages/elixir.ts'], undefined, 'the adapter itself is not mapped');
});

void test('a malformed repo adapter is a clear error', async () => {
  const root = fixture();
  mkdirSync(join(root, '.mind-meld', 'languages'), { recursive: true });
  writeFileSync(join(root, '.mind-meld', 'languages', 'bad.ts'), 'export default { name: "Bad" };\n');
  await assert.rejects(scanRepo(root), /bad\.ts: default export needs name, extensions and facts\(\)/);
});

void test('CLI: mind-meld.ts map <repo> <out> writes the pages', () => {
  const root = fixture();
  const out = join(root, 'docs', 'map');
  const result = spawnSync(process.execPath, ['scripts/mind-meld.ts', 'map', root, out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /repo map: 6 pages/);
  assert.match(readFileSync(join(out, 'index.md'), 'utf8'), /^# Repo map/);
});

// ── Review regressions: each case below once drew a wrong arrow, lost a page or misreported a tool ──
function repoOf(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'meld-edge-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

void test('page names never collide: an area named index or root keeps its own page', async () => {
  const root = repoOf({ 'index/a.py': 'x = 1\n', 'root/b.py': 'y = 1\n', 'c.py': 'z = 1\n' });
  const written = await writeMap(root, join(root, 'out'));
  assert.equal(new Set(written).size, written.length, written.join(' '));
  assert.match(readFileSync(join(root, 'out', 'index.md'), 'utf8'), /^# Repo map/);
});

void test('Python: a package wins over a same-named module file', async () => {
  const facts = byFile(await scanRepo(repoOf({ 'pkg/__init__.py': '', 'pkg.py': '', 'app/run.py': 'from pkg import x\n' })));
  assert.deepEqual(facts['app/run.py'].imports, ['pkg/__init__.py']);
});

void test('Rust: no arrows for files outside a crate or uses that resolve to nothing; bin roots resolve like main.rs', async () => {
  const facts = byFile(await scanRepo(repoOf({
    'src/lib.rs': 'pub mod a;\npub struct World;\n', 'src/a.rs': 'use crate::World;\nuse crate::missing::Thing;\n',
    'build.rs': 'use crate::a;\n', 'src/bin/tool.rs': 'mod helper;\n', 'src/bin/helper.rs': 'pub fn h() {}\n',
    'src/b.rs': '/*\nuse crate::a;\n*/\npub fn b() {}\n' })));
  assert.deepEqual(facts['src/a.rs'].imports, ['src/lib.rs'], 'World is declared in lib.rs; missing::Thing resolves to nothing');
  assert.deepEqual(facts['build.rs'].imports, []);
  assert.deepEqual(facts['src/bin/tool.rs'].imports, ['src/bin/helper.rs']);
  assert.deepEqual(facts['src/b.rs'].imports, [], 'a use inside a block comment is not an import');
});

void test('Ruby: require does not guess a repo-root file', async () => {
  const facts = byFile(await scanRepo(repoOf({ 'json.rb': '', 'app/x.rb': "require 'json'\n" })));
  assert.deepEqual(facts['app/x.rb'].imports, []);
});

void test('repo adapters are held to the facts rule: unknown imports dropped, skipped or failed files stated', async () => {
  const root = repoOf({
    '.mind-meld/languages/go.ts': "export default { name: 'Go', extensions: ['.go'], facts: (files) => files.slice(1).map(file => ({ file, definitions: [], imports: ['nope/zz.go'], method: 'test' })) };\n",
    '.mind-meld/languages/zig.ts': "export default { name: 'Zig', extensions: ['.zig'], facts: () => { throw new Error('boom'); } };\n",
    'a/one.go': '', 'a/two.go': '', 'z/main.zig': '' });
  const facts = byFile(await scanRepo(root));
  assert.deepEqual(facts['a/two.go'].imports, []);
  assert.match(facts['a/one.go'].method, /not extracted: Go returned nothing/);
  assert.match(facts['z/main.zig'].method, /not extracted: Zig failed: boom/);
});

void test('a tracked file missing from the working tree, or a repo with no supported code, is handled plainly', async () => {
  const root = repoOf({ 'a/x.py': 'x = 1\n', 'a/gone.py': 'y = 1\n' });
  execFileSync('rm', [join(root, 'a', 'gone.py')]);
  assert.equal(byFile(await scanRepo(root))['a/gone.py'], undefined);
  await assert.rejects(writeMap(repoOf({ 'README.md': '# x\n' }), join(tmpdir(), 'meld-none')), /no source files in a supported language/);
});

void test('a big flat folder splits into automatic prefix clusters, each with its own page', async () => {
  const files: Record<string, string> = { 'tools/sub/deep.ts': 'export const d = 1;\n', 'tools/lonely.ts': 'export const l = 1;\n' };
  for (const name of ['db', 'lock', 'view', 'edit', 'links']) files[`tools/queue-${name}.ts`] = `export const ${name} = 1;\n`;
  for (const name of ['map', 'langs', 'pages']) files[`tools/mind-meld-${name}.ts`] = `import { ${name === 'map' ? 'db' : 'lock'} } from './queue-${name === 'map' ? 'db' : 'lock'}.ts';\nexport const m = 1;\n`;
  for (const name of ['render', 'spec', 'markdown']) files[`tools/explorer-${name}.ts`] = `export const e = 1;\n`;
  const root = repoOf(files);
  const written = await writeMap(root, join(root, 'out'));
  assert.ok(['tools.md', 'tools-queue.md', 'tools-mind-meld.md', 'tools-explorer.md', 'tools-sub.md', 'tools-other.md'].every(f => written.includes(f)), written.join(' '));
  const area = readFileSync(join(root, 'out', 'tools.md'), 'utf8');
  assert.match(area, /- \[queue-\*\]\(tools-queue\.md\): 5 modules/);
  assert.match(area, /- \[mind-meld-\*\]\(tools-mind-meld\.md\): 3 modules/);
  assert.match(area, /n_mind\w* --> n_queue/, 'cluster arrow from the real imports');
  const cluster = readFileSync(join(root, 'out', 'tools-queue.md'), 'utf8');
  assert.match(cluster, /^\[← tools\]\(tools\.md\)/);
  assert.match(cluster, /## queue-db\.ts/);
});

void test('a small area keeps one page of modules', async () => {
  const written = await writeMap(fixture(), join(mkdtempSync(join(tmpdir(), 'meld-small-')), 'out'));
  assert.equal(written.filter(f => f.startsWith('svc')).length, 1);
});

void test('CLI warns when the pages are written outside the repo (their source links would break on GitHub)', () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'meld-outside-'));
  const result = spawnSync(process.execPath, ['scripts/mind-meld.ts', 'map', root, outside], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /outside the repo/);
  const inside = spawnSync(process.execPath, ['scripts/mind-meld.ts', 'map', root, join(root, 'docs', 'map')], { encoding: 'utf8' });
  assert.doesNotMatch(inside.stderr, /outside the repo/);
});
