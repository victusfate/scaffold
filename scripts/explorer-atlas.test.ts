#!/usr/bin/env node
// Tests for scripts/explorer-atlas.ts, explorer-atlas-defs.ts and explorer-atlas-markdown.ts — placing a
// page's quotes and code excerpts in the repo, and failing when what they cite has changed.

import assert from 'node:assert/strict';
import test from 'node:test';
import { ackAtlas, blockHash, helpersOf, locateBlock, locateQuote, resolveAtlas, type AtlasData, type CodeRef, type ReadFile } from './explorer-atlas.ts';
import { definitionsIn, importedFiles } from './explorer-atlas-defs.ts';
import { renderAtlas } from './explorer-atlas-markdown.ts';

const LIB = ['// Adds one.', 'export function bump(n: number): number {', '  return n + 1;', '}', '', 'export const LIMIT = 3;', ''].join('\n');
const MAIN = ["import { bump, LIMIT } from './lib.ts';", '', 'const local = (n: number): number => n * 2;', '',
  'export function run(n: number): number {', '  if (n > LIMIT) return local(n);', '  return bump(n);', '}', ''].join('\n');
const files = (over: Record<string, string> = {}): ReadFile => path => ({ 'src/lib.ts': LIB, 'src/main.ts': MAIN, 'doc.md': 'Run the\nwhole suite first.\n', ...over })[path];

const RUN_BLOCK = ['export function run(n: number): number {', '  if (n > LIMIT) return local(n);', '  return bump(n);', '}'];
const runRef = (over: Partial<CodeRef> = {}): CodeRef => ({ node: 'a', file: 'src/main.ts', anchor: 'return bump(n);', before: 2, count: 4,
  hash: blockHash(RUN_BLOCK), title: 'run', explain: 'Runs.', kind: 'implements', ...over });
const atlasData = (over: Partial<AtlasData> = {}): AtlasData => ({
  checks: [{ node: 'a', origin: 'spec', kind: 'role', claim: 'Runs the suite.', verdict: 'confirmed', file: 'doc.md', quote: 'Run the whole suite first.' }],
  code: { refs: [runRef()] }, ...over });
const env = (read: ReadFile, notes = {}) => ({ read, notes, nodeIds: ['a'] });

void test('a quote is found on its line, across a line wrap, or not at all', () => {
  assert.equal(locateQuote('one\ntwo three\n', 'two three'), 2);
  assert.equal(locateQuote('Run the\nwhole suite first.\n', 'Run the whole suite first.'), 1);
  assert.equal(locateQuote('one\ntwo\n', 'four'), undefined);
  assert.equal(locateQuote('a b\n\nc d\n', 'b c'), 1);
});

void test('an excerpt follows its lines when they move and is lost when they change', () => {
  assert.equal(locateBlock(MAIN, runRef())?.from, 5);
  assert.equal(locateBlock(`// a new first line\n${MAIN}`, runRef())?.from, 6);
  assert.equal(locateBlock(MAIN.replace('n > LIMIT', 'n >= LIMIT'), runRef()), undefined);
});

void test('definitions are the top-level names, with the comment above and the whole body hashed', () => {
  const [bump, limit] = definitionsIn('src/lib.ts', LIB);
  assert.deepEqual([bump.name, bump.kind, bump.line, bump.to, bump.doc], ['bump', 'function', 2, 4, 'Adds one.']);
  assert.deepEqual([limit.name, limit.kind, limit.lines], ['LIMIT', 'const', ['export const LIMIT = 3;']]);
  const [shell] = definitionsIn('bin/tool', '#!/usr/bin/env bash\n# Says hi.\ngreet() {\n  echo hi\n}\n');
  assert.deepEqual([shell.name, shell.kind, shell.line, shell.to, shell.doc], ['greet', 'shell function', 3, 5, 'Says hi.']);
  const long = definitionsIn('a.ts', `export function big(): void {\n${'  step();\n'.repeat(30)}}\n`)[0];
  assert.equal(long.truncated, true);
  assert.notEqual(long.hash, blockHash(long.lines));
});

void test('a definition is taken whole: wrapped arrows, bracketless types, one-line shell functions', () => {
  const text = ['const twice = (n: number): number =>', '  n * 2;', 'type Shade =', "  | 'light'", "  | 'dark';", '/**', ' * Says so.', ' */', 'export const flag = true;', ''].join('\n');
  const [twice, shade, flag] = definitionsIn('a.ts', text);
  assert.deepEqual([twice.line, twice.to, shade.line, shade.to, flag.line, flag.to], [1, 2, 3, 5, 9, 9]);
  assert.equal(flag.doc, 'Says so.');
  const [alpha, beta] = definitionsIn('lib.sh', 'alpha() { echo 1; }\nbeta() {\n  echo 2\n}\n');
  assert.deepEqual([alpha.line, alpha.to, beta.line, beta.to], [1, 1, 2, 4]);
});

void test('a definition keeps its body past a wrapped signature, a template literal and a heredoc', () => {
  const wrapped = ['export function build(', '  first: string,', '): string {', '  return first;', '}', 'export const next = 1;'].join('\n');
  assert.deepEqual(definitionsIn('a.ts', wrapped).map(d => [d.name, d.line, d.to]), [['build', 1, 5], ['next', 6, 6]]);
  const template = ['const SCRIPT = `', 'function inner() {', '}', '`;', 'export const after = 2;'].join('\n');
  assert.deepEqual(definitionsIn('a.ts', template).map(d => [d.name, d.line, d.to]), [['SCRIPT', 1, 4], ['after', 5, 5]]);
  const heredoc = ['usage() {', '  cat <<EOF', 'Usage: tool', 'EOF', '}', 'other_fn() { :; }'].join('\n');
  assert.deepEqual(definitionsIn('lib.sh', heredoc).map(d => [d.name, d.line, d.to]), [['usage', 1, 5], ['other_fn', 6, 6]]);
  const doc = definitionsIn('a.ts', '// ── Helpers ──\n// True when left === right.\n// Used by the gate.\nexport const same = true;\n')[0].doc;
  assert.equal(doc, 'True when left === right. Used by the gate.');
});

void test('only script and shell files have definitions', () => {
  assert.deepEqual(definitionsIn('notes.md', 'run() is called first\n'), []);
  assert.deepEqual(definitionsIn('bin/readme', 'run() is called first\n'), []);
  assert.equal(definitionsIn('bin/tool', '#!/usr/bin/env bash\nrun_it() {\n  :\n}\n').length, 1);
  assert.equal(definitionsIn('a.mts', 'export const value = 1;\n').length, 1);
});

void test('imports resolve to repo files that exist', () => {
  assert.deepEqual(importedFiles('src/main.ts', MAIN, files()), ['src/lib.ts']);
  assert.deepEqual(importedFiles('src/main.ts', "import x from './gone.ts';", files()), []);
  assert.deepEqual(importedFiles('doc.md', 'source lib/util.sh\n', () => 'x'), []);
  const read: ReadFile = path => path === 'scripts/lib/util.sh' ? 'x' : undefined;
  assert.deepEqual(importedFiles('scripts/test-a.sh', 'source "$DIR/lib/util.sh"\n', read), ['scripts/lib/util.sh']);
});

void test('helpers are names the excerpt uses, defined outside it in its file or an import', () => {
  const helpers = helpersOf({ file: 'src/main.ts', from: 5, to: 8, lines: RUN_BLOCK }, files());
  assert.deepEqual(helpers.map(h => `${h.file}#${h.name}`), ['src/main.ts#local', 'src/lib.ts#bump', 'src/lib.ts#LIMIT']);
});

void test('a matching atlas resolves with line numbers and no problems', () => {
  const { atlas, problems } = resolveAtlas('x', atlasData(), env(files()));
  assert.deepEqual(problems, []);
  assert.equal(atlas?.checks[0].line, 1);
  assert.deepEqual([atlas?.refs[0].from, atlas?.refs[0].to, atlas?.refs[0].helpers.length], [5, 8, 3]);
});

void test('a quote that is gone, changed code, a changed helper and an unknown stage are problems', () => {
  const quoteGone = resolveAtlas('x', atlasData(), env(files({ 'doc.md': 'Run nothing.\n' }))).problems;
  assert.match(quoteGone[0], /^x: quote no longer in doc\.md: "Run the whole suite first\."/);
  const codeChanged = resolveAtlas('x', atlasData(), env(files({ 'src/main.ts': MAIN.replace('n > LIMIT', 'n >= LIMIT') }))).problems;
  assert.deepEqual(codeChanged, ['x: the code cited from src/main.ts ("run") changed: check its explanation in explorer/x.atlas.json, then run npm run diagrams:ack -- x']);
  const helperChanged = resolveAtlas('x', atlasData(), env(files(), { 'src/lib.ts#bump': { explain: 'Adds one.', hash: 'stale' } })).problems;
  assert.deepEqual(helperChanged, ['x: helper src/lib.ts#bump changed: check its explanation in explorer/helpers.atlas.json, then run npm run diagrams:ack -- x']);
  const unknown = resolveAtlas('x', atlasData({ code: { refs: [runRef({ node: 'zz' })] } }), env(files())).problems;
  assert.deepEqual(unknown, ['x: atlas names unknown stage "zz"']);
});

void test('acknowledging records the new hashes, and reports an excerpt whose anchor is gone', () => {
  const changed = files({ 'src/main.ts': MAIN.replace('n > LIMIT', 'n >= LIMIT'), 'src/lib.ts': LIB.replace('n + 1', 'n + 2') });
  const acked = ackAtlas(atlasData(), { 'src/lib.ts#bump': { explain: 'Adds one.', hash: 'stale' } }, changed);
  assert.deepEqual(acked.lost, []);
  assert.deepEqual(resolveAtlas('x', acked.data, env(changed, acked.notes)).problems, []);
  assert.equal(acked.notes['src/lib.ts#bump'].explain, 'Adds one.');
  const lost = ackAtlas(atlasData(), {}, files({ 'src/main.ts': 'export const nothing = 1;\n' }));
  assert.deepEqual(lost.lost, ['src/main.ts ("run")']);
});

void test('an anchor that finds several different blocks is never re-pointed by acknowledging', () => {
  const twice = MAIN.replace('n > LIMIT', 'n >= LIMIT') + 'export function other(n: number): number {\n  if (n) return 0;\n  return bump(n);\n}\n';
  assert.deepEqual(ackAtlas(atlasData(), {}, files({ 'src/main.ts': twice })).lost, ['src/main.ts ("run")']);
  const unchanged = MAIN + 'export function other(n: number): number {\n  if (n) return 0;\n  return bump(n);\n}\n';
  const acked = ackAtlas(atlasData(), {}, files({ 'src/main.ts': unchanged }));
  assert.deepEqual([acked.lost, acked.data.code?.refs[0].hash], [[], runRef().hash]);
});

void test('a malformed atlas is reported and resolves to nothing', () => {
  const bad = atlasData({ checks: [{ node: 'a', origin: 'spec', kind: 'role', claim: 'Unquoted.', verdict: 'confirmed' },
    { node: 'a', origin: 'spec', kind: 'role', claim: 'Odd.', verdict: 'maybe' as 'partial', file: 'doc.md', quote: 'Run' }],
    code: { refs: [runRef({ anchor: '}' }), runRef({ kind: 'uses' as 'tests' })] } });
  const { atlas, problems } = resolveAtlas('x', bad, env(files()));
  assert.deepEqual(problems, ['x: a confirmed claim needs a file and a quote: "Unquoted."', 'x: unknown verdict "maybe"',
    'x: "run" needs an anchor of 8+ characters that sits inside its block', 'x: unknown kind "uses" for "run"']);
  assert.equal(atlas, undefined);
  assert.deepEqual(resolveAtlas('x', {} as AtlasData, env(files())).problems, ['x: atlas needs a checks array']);
  const shapeless = { checks: [{}], missing: 'none', code: { refs: [{}] } } as unknown as AtlasData;
  assert.deepEqual(resolveAtlas('x', shapeless, env(files())).problems, ['x: missing, code.refs and code.promptOnly must be lists']);
  const empty = { checks: [{}], code: { refs: [{}] } } as unknown as AtlasData;
  assert.deepEqual(resolveAtlas('x', empty, env(files())).problems, ['x: every check needs a node and a claim', 'x: every code excerpt needs a node, a file, a title and an anchor']);
});

void test('the sections show code in a fence, fold confirmed claims and escape what GitHub would hide', () => {
  const data = atlasData({ summary: 'Docs live in docs/<slug>/.', checks: [
    { node: 'a', origin: 'spec', kind: 'role', claim: 'Uses `docs/<slug>/` paths.', verdict: 'partial', file: 'doc.md', quote: 'Run the whole suite first.', note: 'Only <some> of it.' },
    { node: 'a', origin: 'diagram', kind: 'box', claim: 'Runs the suite.', verdict: 'confirmed', file: 'doc.md', quote: 'Run the whole suite first.' }] });
  const { atlas } = resolveAtlas('x', data, env(files(), { 'src/lib.ts#bump': { explain: 'Returns n plus one.', hash: definitionsIn('src/lib.ts', LIB)[0].hash } }));
  assert.ok(atlas);
  const page = renderAtlas(atlas, { blob: 'https://example.test/blob/main', nodes: [{ id: 'a', name: 'Stage A' }] }).join('\n');
  assert.ok(page.includes('### Stage A: code\n\n#### run\n\n*Carries out the step.* Runs.\n\n```ts\nexport function run(n: number): number {'), page);
  assert.ok(page.includes('[`src/main.ts:5-8`](https://example.test/blob/main/src/main.ts#L5-L8)'));
  assert.ok(page.includes('<summary><code>bump</code> · function · src/lib.ts:2</summary>\n\nReturns n plus one.\n\nComment in the source: Adds one.'));
  assert.ok(page.includes('Docs live in docs/&lt;slug&gt;/.'));
  assert.ok(page.includes('- **Partly**: Uses `docs/<slug>/` paths.\n  > Run the whole suite first.\n  >\n  > [`doc.md:1`](https://example.test/blob/main/doc.md#L1)\n\n  Only &lt;some&gt; of it.'));
  assert.ok(page.includes('<summary>1 confirmed, with the supporting line</summary>\n\n- **Confirmed** (from the diagram): Runs the suite.'));
  assert.ok(page.includes('| Confirmed | Partly | Not found | Contradicted | In the source, not shown in the flow | Code excerpts |\n|---:|---:|---:|---:|---:|---:|\n| 1 | 1 | 0 | 0 | 0 | 1 |'));
});

void test('a stage with no code says so, and a note stands in when the agent recorded why', () => {
  const none = resolveAtlas('x', atlasData({ code: { refs: [] } }), env(files())).atlas;
  assert.ok(none);
  assert.ok(renderAtlas(none, { blob: 'b', nodes: [{ id: 'a', name: 'A' }] }).join('\n').includes('No code was found for this stage'));
  const noted = resolveAtlas('x', atlasData({ code: { refs: [], promptOnly: [{ node: 'a', what: 'The agent reads the plan <x> with a lone ` tick.' }] } }), env(files())).atlas;
  assert.ok(noted);
  assert.ok(renderAtlas(noted, { blob: 'b', nodes: [{ id: 'a', name: 'A' }] }).join('\n').includes('No code here: The agent reads the plan &lt;x&gt; with a lone ` tick.'));
});
