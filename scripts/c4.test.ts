#!/usr/bin/env node
// Tests for the C4 output: the neutral model (c4-model.ts), its Structurizr and mermaid emitters, the
// explorer-spec converter and the render-c4 CLI.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idAllocator, validateC4, type C4Model } from './c4-model.ts';
import { renderStructurizr } from './c4-structurizr.ts';

// A small system with every element kind: a person, an external system, a grouped container, a database
// and a container holding one component.
const shop = (): C4Model => ({
  name: 'Shop', description: 'A "small" shop',
  system: { name: 'Shop system', description: 'Sells things' },
  elements: [
    { id: 'p_buyer', kind: 'person', name: 'Buyer', description: 'Buys things' },
    { id: 's_bank', kind: 'system', name: 'Bank', description: 'Takes payment' },
    { id: 'c_web', kind: 'container', name: 'Web app', description: 'Shows the catalogue', technology: 'TypeScript', group: 'Front' },
    { id: 'c_db', kind: 'container', name: 'Orders', shape: 'database' },
    { id: 'c_api', kind: 'container', name: 'API' },
    { id: 'm_cart', kind: 'component', parent: 'c_api', name: 'cart.ts', technology: 'TypeScript', group: 'cart-*', source: 'api/cart.ts' },
  ],
  relationships: [
    { from: 'p_buyer', to: 'c_web', description: 'Browses' },
    { from: 'c_web', to: 'c_api', description: 'Calls' },
    { from: 'c_api', to: 'c_db', description: 'Writes orders' },
    { from: 'c_api', to: 's_bank', description: 'Charges' },
  ],
  dynamics: [{ key: 'checkout', title: 'Checkout', steps: [
    { from: 'p_buyer', to: 'c_web', description: 'Clicks pay' },
    { from: 'c_web', to: 'c_api', description: 'Posts the order' },
  ] }],
});

void test('idAllocator prefixes by kind, keeps only identifier characters and never repeats', () => {
  const id = idAllocator();
  assert.equal(id('container', 'queue-db'), 'c_queue_db');
  assert.equal(id('container', 'queue_db'), 'c_queue_db_2');
  assert.equal(id('person', 'model'), 'p_model');
  assert.equal(id('component', 'scripts/a.b.ts'), 'm_scripts_a_b_ts');
});

void test('validateC4 accepts a complete model', () => {
  assert.deepEqual(validateC4(shop()), []);
});

void test('validateC4 names each problem', () => {
  const model = shop();
  model.elements.push({ id: 'c_web', kind: 'container', name: 'Again' }, { id: 'bad-id', kind: 'container', name: 'Bad' },
    { id: 'm_lost', kind: 'component', name: 'lost.ts', parent: 'p_buyer' });
  model.relationships.push({ from: 'c_web', to: 'c_nowhere', description: 'x' }, { from: 'c_db', to: 'c_db', description: 'self' });
  model.dynamics.push({ key: 'checkout', title: 'Twice', steps: [{ from: 'c_db', to: 'c_web', description: 'no such relationship' }] });
  const problems = validateC4(model).join('\n');
  for (const expected of ['duplicate id "c_web"', 'invalid id "bad-id"', '"m_lost" must sit in a container', 'unknown element "c_nowhere"',
    '"c_db" relates to itself', 'duplicate dynamic view "checkout"', 'no relationship c_db -> c_web']) {
    assert.match(problems, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

void test('validateC4 requires a container', () => {
  const model = shop();
  model.elements = model.elements.filter(element => element.kind === 'person');
  model.relationships = []; model.dynamics = [];
  assert.deepEqual(validateC4(model), ['the described system has no container']);
});

void test('renderStructurizr writes the model: people, external systems, grouped containers and components', () => {
  const dsl = renderStructurizr(shop());
  assert.match(dsl, /^workspace "Shop" "A 'small' shop" \{$/m);
  assert.match(dsl, /^ {8}p_buyer = person "Buyer" "Buys things"$/m);
  assert.match(dsl, /^ {8}s_bank = softwareSystem "Bank" "Takes payment" "External"$/m);
  assert.match(dsl, /^ {8}sys = softwareSystem "Shop system" "Sells things" \{$/m);
  assert.match(dsl, /^ {12}c_db = container "Orders" "" "" "Database"$/m);
  assert.match(dsl, /^ {12}group "Front" \{\n {16}c_web = container "Web app" "Shows the catalogue" "TypeScript"\n {12}\}$/m);
  assert.match(dsl, /^ {12}c_api = container "API" \{\n {16}group "cart-\*" \{\n {20}m_cart = component "cart\.ts" "" "TypeScript" \{\n {24}properties \{\n {28}"source" "api\/cart\.ts"\n/m);
  assert.match(dsl, /^ {8}c_api -> s_bank "Charges"$/m);
});

void test('renderStructurizr writes one view of each kind the model supports', () => {
  const dsl = renderStructurizr(shop());
  assert.match(dsl, /^ {8}systemContext sys "context" \{\n {12}include \*\n {12}autoLayout lr\n {8}\}$/m);
  assert.match(dsl, /^ {8}container sys "containers" \{$/m);
  assert.match(dsl, /^ {8}component c_api "components_c_api" \{$/m);
  assert.doesNotMatch(dsl, /component c_web /);
  assert.match(dsl, /^ {8}dynamic sys "checkout" "Checkout" \{\n {12}p_buyer -> c_web "Clicks pay"\n {12}c_web -> c_api "Posts the order"\n {12}autoLayout lr\n {8}\}$/m);
  assert.match(dsl, /element "Database" \{\n {16}shape Cylinder/);
});

void test('renderStructurizr balances its braces and is stable', () => {
  const dsl = renderStructurizr(shop());
  assert.equal(dsl.split('{').length, dsl.split('}').length);
  assert.equal(dsl, renderStructurizr(shop()));
});

// ── The C4 picture and native C4 (c4-mermaid.ts) ────────────────────────────────────────────────────
const { c4Views, renderC4Markdown } = await import('./c4-mermaid.ts');

void test('c4Views gives a container view, then one view per dynamic view', () => {
  assert.deepEqual(c4Views(shop()).map(view => view.title), ['Containers', 'Checkout']);
});

void test('the C4 picture is a flowchart in C4 notation: typed labels, a system boundary, groups and shapes', () => {
  const [{ picture }] = c4Views(shop());
  assert.match(picture, /^%%\{init: .*"themeCSS".*\}%%\nflowchart LR$/m);
  assert.match(picture, /^ {4}p_buyer\(\["Buyer<br\/>\[Person\]<br\/>Buys things"\]\)$/m);
  assert.match(picture, /^ {4}s_bank\["Bank<br\/>\[Software system\]<br\/>Takes payment"\]$/m);
  assert.match(picture, /^ {4}subgraph sys\["Shop system \[Software system\]"\]$/m);
  assert.match(picture, /^ {8}subgraph g_1\["Front"\]\n {12}c_web\["Web app<br\/>\[Container: TypeScript\]<br\/>Shows the catalogue"\]\n {8}end$/m);
  assert.match(picture, /^ {8}c_db\[\("Orders<br\/>\[Container\]"\)\]$/m);
  assert.match(picture, /^ {4}c_api -->\|"Charges<br\/>\u2800"\| s_bank$/m);
  assert.match(picture, /^ {4}style sys fill:none,/m);
  assert.match(picture, /^ {4}style g_1 fill:none,/m);
  assert.match(picture, /^ {4}class p_buyer person;$/m);
  assert.doesNotMatch(picture, /m_cart/);
});

void test('a relationship between components shows between their containers, once, and never inside one', () => {
  const model = shop();
  model.elements.push({ id: 'm_page', kind: 'component', parent: 'c_web', name: 'page.ts' }, { id: 'm_pay', kind: 'component', parent: 'c_api', name: 'pay.ts' });
  model.relationships = [{ from: 'm_page', to: 'm_cart', description: 'imports' }, { from: 'm_page', to: 'm_pay', description: 'imports' },
    { from: 'm_cart', to: 'm_pay', description: 'imports' }];
  model.dynamics = [];
  const [{ picture }] = c4Views(model);
  assert.equal(picture.match(/-->/g)?.length, 1);
  assert.match(picture, /c_web -->\|"imports<br\/>\u2800"\| c_api/);
});

void test('a dynamic view numbers its steps and shows only the elements that take part', () => {
  const { picture, native } = c4Views(shop())[1];
  assert.match(picture, /p_buyer -->\|"1\. Clicks pay<br\/>\u2800"\| c_web/);
  assert.match(picture, /c_web -->\|"2\. Posts the order<br\/>\u2800"\| c_api/);
  assert.doesNotMatch(picture, /c_db|s_bank/);
  assert.match(native, /^C4Dynamic$/m);
  assert.match(native, /^ {4}Rel\(c_web, c_api, "Posts the order"\)$/m);
});

void test('native C4 uses the element function for each kind and shape', () => {
  const [{ native }] = c4Views(shop());
  assert.match(native, /^C4Container$/m);
  assert.match(native, /^ {4}Person\(p_buyer, "Buyer", "Buys things"\)$/m);
  assert.match(native, /^ {4}System_Ext\(s_bank, "Bank", "Takes payment"\)$/m);
  assert.match(native, /^ {4}System_Boundary\(sys, "Shop system"\) \{$/m);
  assert.match(native, /^ {8}ContainerDb\(c_db, "Orders", "", ""\)$/m);
  assert.match(native, /^ {8}Container\(c_web, "Web app", "TypeScript", "Shows the catalogue"\)$/m);
});

void test('long descriptions wrap in the picture so boxes stay narrow', () => {
  const model = shop();
  model.elements[0].description = 'Buys things from the catalogue and pays for them by card at the end';
  const [{ picture }] = c4Views(model);
  assert.match(picture, /Buys things from the<br\/>catalogue and pays for<br\/>them by card at the<br\/>end/);
});

void test('renderC4Markdown is a page: the picture per view, the workspace link, native C4 folded away', () => {
  const page = renderC4Markdown(shop(), { workspace: 'shop.dsl', from: 'shop.explorer.json' });
  assert.match(page, /^# Shop: C4$/m);
  assert.match(page, /\[`shop\.dsl`\]\(shop\.dsl\)/);
  assert.match(page, /^## Containers\n\n```mermaid\n/m);
  assert.match(page, /^## Checkout\n\n```mermaid\n/m);
  assert.match(page, /<details>\n<summary>Mermaid's native C4 syntax<\/summary>/);
  assert.equal(page.match(/```mermaid/g)?.length, 4);
});

// ── From an explorer spec (c4-from-explorer.ts) ─────────────────────────────────────────────────────
const { explorerToC4 } = await import('./c4-from-explorer.ts');
const { validateSpec } = await import('./explorer-spec.ts');
type Spec = Parameters<typeof validateSpec>[0];

const shopSpec = (): Spec => ({
  title: 'Shop', lede: 'How an order is taken.',
  c4: { system: 'Shop system', description: 'Sells things' },
  lanes: [{ id: 'out', name: 'Outside' }, { id: 'front', name: 'Front' }, { id: 'back', name: 'Back end' }],
  nodes: {
    buyer: { lane: 'out', name: 'Buyer', role: 'Buys things.', c4: { as: 'person' } },
    bank: { lane: 'out', name: 'Bank', role: 'Takes payment.', c4: { as: 'external' } },
    web: { lane: 'front', name: 'Web app', role: 'Shows the catalogue.', c4: { technology: 'TypeScript' } },
    api: { lane: 'back', name: 'API', role: 'Takes orders.' },
    'order-db': { lane: 'back', name: 'Orders', role: 'Stores orders.', c4: { as: 'database', technology: 'SQLite' } },
    jobs: { lane: 'back', name: 'Jobs', role: 'Carries work to do later.', c4: { as: 'queue' } },
  },
  flows: [
    { id: 'checkout', name: 'Checkout', steps: [['buyer', 'web', 'Clicks pay', 'cart'], ['web', 'api', 'Posts the order', 'order'],
      ['api', 'api', 'Checks stock', 'order'], ['api', 'order-db', 'Writes the order', 'row'], ['api', 'bank', 'Charges', 'amount']] },
    { id: 'refund-flow', name: 'Refund', steps: [['web', 'api', 'Asks for a refund', 'order id'], ['api', 'jobs', 'Queues the refund', 'job']] },
  ],
});

void test('explorerToC4 turns nodes into elements by their c4.as, and lanes into groups of containers', () => {
  const { model, problems } = explorerToC4(shopSpec());
  assert.deepEqual(problems, []);
  assert.deepEqual(model!.system, { name: 'Shop system', description: 'Sells things' });
  assert.deepEqual(model!.elements, [
    { id: 'p_buyer', kind: 'person', name: 'Buyer', description: 'Buys things.' },
    { id: 's_bank', kind: 'system', name: 'Bank', description: 'Takes payment.' },
    { id: 'c_web', kind: 'container', name: 'Web app', description: 'Shows the catalogue.', technology: 'TypeScript', group: 'Front' },
    { id: 'c_api', kind: 'container', name: 'API', description: 'Takes orders.', group: 'Back end' },
    { id: 'c_order_db', kind: 'container', name: 'Orders', description: 'Stores orders.', technology: 'SQLite', shape: 'database', group: 'Back end' },
    { id: 'c_jobs', kind: 'container', name: 'Jobs', description: 'Carries work to do later.', shape: 'queue', group: 'Back end' },
  ]);
});

void test('explorerToC4 makes one relationship per pair (first wording), drops a step to itself, and keeps each flow as a dynamic view', () => {
  const { model } = explorerToC4(shopSpec());
  assert.deepEqual(model!.relationships.map(r => `${r.from} -> ${r.to}: ${r.description}`), [
    'p_buyer -> c_web: Clicks pay', 'c_web -> c_api: Posts the order', 'c_api -> c_order_db: Writes the order',
    'c_api -> s_bank: Charges', 'c_api -> c_jobs: Queues the refund']);
  assert.deepEqual(model!.dynamics.map(view => [view.key, view.title, view.steps.length]), [['v_checkout', 'Checkout', 4], ['v_refund_flow', 'Refund', 2]]);
  assert.equal(model!.dynamics[1].steps[0].description, 'Asks for a refund');
});

void test('explorerToC4 reports a spec that has not opted in, or has no container', () => {
  const plainSpec = shopSpec(); delete plainSpec.c4;
  assert.deepEqual(explorerToC4(plainSpec), { problems: ['the spec has no c4 field'] });
  const people = shopSpec();
  for (const node of Object.values(people.nodes)) node.c4 = { as: 'person' };
  assert.deepEqual(explorerToC4(people).problems, ['the described system has no container']);
});

void test('validateSpec checks the c4 fields and leaves a spec without them alone', () => {
  assert.deepEqual(validateSpec(shopSpec()), []);
  const bad = shopSpec();
  bad.c4 = { system: '' };
  (bad.nodes.web.c4 as { as: string }).as = 'service';
  (bad.nodes.api as { c4: unknown }).c4 = { technology: 5 };
  assert.deepEqual(validateSpec(bad), ['c4.system is required', 'nodes.web: unknown c4.as "service" (person, external, database, queue)', 'nodes.api: c4.technology must be text']);
});

void test('a spec converts to a workspace Structurizr can scope: every dynamic step has its relationship', () => {
  const { model } = explorerToC4(shopSpec());
  assert.deepEqual(validateC4(model!), []);
  assert.match(renderStructurizr(model!), /dynamic sys "v_refund_flow" "Refund" \{\n {12}c_web -> c_api "Asks for a refund"/);
});

// ── The CLI (render-c4.ts) ──────────────────────────────────────────────────────────────────────────
const { execFileSync } = await import('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const CLI = join(import.meta.dirname, 'render-c4.ts');

// Runs the CLI on a temp folder of specs; returns its exit code, its messages and the folder written.
function renderC4(specs: Record<string, unknown>, ...flags: string[]): { code: number; err: string; out: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'c4-'));
  mkdirSync(join(dir, 'specs'));
  for (const [slug, spec] of Object.entries(specs)) writeFileSync(join(dir, 'specs', `${slug}.explorer.json`), JSON.stringify(spec));
  return { dir, ...runC4(dir, ...flags) };
}
function runC4(dir: string, ...flags: string[]): { code: number; err: string; out: string } {
  try {
    const out = execFileSync('node', [CLI, '--specs', join(dir, 'specs'), '--out', join(dir, 'c4'), ...flags], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, err: '', out };
  } catch (error) {
    const failed = error as { status: number; stderr: string; stdout: string };
    return { code: failed.status, err: failed.stderr, out: failed.stdout };
  }
}

void test('render-c4 writes a workspace and a page for each spec that opted in, and nothing for the rest', () => {
  const flowOnly = shopSpec(); delete flowOnly.c4;
  const { code, out, dir } = renderC4({ shop: shopSpec(), 'flow-only': flowOnly });
  assert.equal(code, 0);
  assert.deepEqual(readdirSync(join(dir, 'c4')).sort(), ['shop.dsl', 'shop.md']);
  assert.match(out, /render-c4: 1 spec, 2 files in /);
  const dsl = readFileSync(join(dir, 'c4', 'shop.dsl'), 'utf8');
  assert.match(dsl, /^\/\/ Generated by scripts\/render-c4\.ts from \.\.\/specs\/shop\.explorer\.json\./);
  assert.match(dsl, /\nworkspace "Shop" /);
  assert.match(readFileSync(join(dir, 'c4', 'shop.md'), 'utf8'), /^<!-- Generated by scripts\/render-c4\.ts from \.\.\/specs\/shop\.explorer\.json\./);
  assert.match(readFileSync(join(dir, 'c4', 'shop.md'), 'utf8'), /Generated from \[`shop\.explorer\.json`\]\(\.\.\/specs\/shop\.explorer\.json\) by `scripts\/render-c4\.ts`/);
  rmSync(dir, { recursive: true });
});

void test('render-c4 --check writes nothing, passes when files are current and fails when one is stale or missing', () => {
  const { dir } = renderC4({ shop: shopSpec() });
  assert.equal(runC4(dir, '--check').code, 0);
  const edited = shopSpec(); edited.nodes.api.name = 'Order API';
  writeFileSync(join(dir, 'specs', 'shop.explorer.json'), JSON.stringify(edited));
  const stale = runC4(dir, '--check');
  assert.equal(stale.code, 1);
  assert.match(stale.err, /render-c4: shop\.dsl is stale: run npm run diagrams:c4/);
  assert.doesNotMatch(readFileSync(join(dir, 'c4', 'shop.dsl'), 'utf8'), /Order API/);
  rmSync(join(dir, 'c4', 'shop.md'));
  assert.match(runC4(dir, '--check').err, /shop\.md is stale/);
  rmSync(dir, { recursive: true });
});

void test('render-c4 fails with one line per problem and writes nothing for a spec it cannot convert', () => {
  const people = shopSpec();
  for (const node of Object.values(people.nodes)) node.c4 = { as: 'person' };
  const { code, err, dir } = renderC4({ people });
  assert.equal(code, 1);
  assert.match(err, /^render-c4: people: the described system has no container$/m);
  assert.deepEqual(readdirSync(dir), ['specs']);
  rmSync(dir, { recursive: true });
});

void test('an arrow label sits above its line: as many blank lines follow the text as the text has', () => {
  const model = shop();
  model.relationships[0].description = 'Browses the whole catalogue of things for sale';
  const [{ picture }] = c4Views(model);
  assert.match(picture, /p_buyer -->\|"Browses the whole<br\/>catalogue of things<br\/>for sale<br\/>\u2800<br\/>\u2800<br\/>\u2800"\| c_web/);
});

void test('two parts that talk both ways share one double-headed arrow that says who does what', () => {
  const model = shop();
  model.relationships.push({ from: 'c_api', to: 'c_web', description: 'Returns the receipt' });
  model.dynamics[0].steps.push({ from: 'c_api', to: 'c_web', description: 'Returns the receipt' });
  const [containers, checkout] = c4Views(model);
  assert.match(containers.picture, /c_web <-->\|"Web app: Calls<br\/>API: Returns the<br\/>receipt<br\/>\u2800<br\/>\u2800<br\/>\u2800"\| c_api/);
  assert.doesNotMatch(containers.picture, /c_api -->\|[^|]*\| c_web/);
  assert.match(checkout.picture, /c_web <-->\|"2\. Web app: Posts the<br\/>order<br\/>3\. API: Returns the<br\/>receipt<br\/>/);
  assert.match(checkout.native, /Rel\(c_api, c_web, "Returns the receipt"\)/);
});

// ── Found in review ─────────────────────────────────────────────────────────────────────────────────
void test('validateC4 rejects what Structurizr would: reserved view keys, components in a story, repeats', () => {
  const model = shop();
  model.elements.push({ id: 'C_WEB', kind: 'container', name: 'Other' }, { id: 'c_web2', kind: 'container', name: 'Web app', group: 'Front' },
    { id: 'c_blank', kind: 'container', name: ' ' });
  model.relationships.push({ from: 'c_api', to: 'm_cart', description: 'holds' }, { from: 'c_web', to: 'c_api', description: 'Calls' },
    { from: 'm_cart', to: 'c_db', description: 'reads' });
  model.dynamics.push({ key: 'containers', title: 'Taken', steps: [{ from: 'm_cart', to: 'c_db', description: 'reads' }] }, { key: 'empty', title: 'Empty', steps: [] });
  const problems = validateC4(model).join('\n');
  for (const expected of ['duplicate id "C_WEB"', 'two elements named "Web app" in the same place', '"c_blank" has no name',
    'c_api -> m_cart: a container and its own component cannot be related', 'relationship given twice: c_web -> c_api "Calls"',
    'invalid dynamic view key "containers"', '"m_cart" is a component; steps run between people, systems and containers', 'dynamic view "empty" has no steps']) {
    assert.ok(problems.includes(expected), `${expected}\n in \n${problems}`);
  }
});

void test('a flow id never collides with a view the workspace writes itself, or with another flow', () => {
  const spec = shopSpec();
  spec.flows = [{ id: 'context', name: 'A', steps: [['web', 'api', 'Calls', 'x']] }, { id: 'a-b', name: 'B', steps: [['web', 'api', 'Calls', 'x']] },
    { id: 'a_b', name: 'C', steps: [['web', 'api', 'Calls', 'x']] }, { id: '2fa', name: 'D', steps: [['web', 'api', 'Calls', 'x']] },
    { id: 'idle', name: 'E', steps: [['api', 'api', 'Thinks', 'x']] }];
  const { model, problems } = explorerToC4(spec);
  assert.deepEqual(problems, []);
  assert.deepEqual(model!.dynamics.map(view => view.key), ['v_context', 'v_a_b', 'v_a_b_2', 'v_2fa']);
});

void test('explorerToC4 reports a spec problem by name instead of converting it', () => {
  const spec = shopSpec();
  spec.flows![0].steps.push(['web', 'nowhere', 'Calls', 'x']);
  assert.deepEqual(explorerToC4(spec), { problems: ['flows.checkout.steps[5]: unknown node "nowhere"'] });
});

void test('text that would break a workspace string is made safe', () => {
  const model = shop();
  model.elements[2].name = 'Dir C:\\';
  model.elements[2].description = 'Reads ${HOME} and {braces}';
  const dsl = renderStructurizr(model);
  assert.match(dsl, /c_web = container "Dir C:\/" "Reads \$ \{HOME\} and \{braces\}" "TypeScript"/);
});

void test('text that mermaid would read as markup is kept readable in the picture', () => {
  const model = shop();
  model.elements[2].description = 'Serves <slug> pages; code #35;';
  assert.match(c4Views(model)[0].picture, /Serves ‹slug› pages;<br\/>code # 35;/);
});

void test('each step is drawn once: a third message between two parts keeps its own arrow', () => {
  const model = shop();
  const steps = [{ from: 'c_web', to: 'c_api', description: 'ask' }, { from: 'c_api', to: 'c_web', description: 'answer' },
    { from: 'c_api', to: 'c_web', description: 'answer again' }];
  model.relationships.push({ from: 'c_api', to: 'c_web', description: 'answer' });
  model.elements[2].name = 'Costs $$ & $1';
  model.dynamics = [{ key: 'talk', title: 'Talk', steps }];
  const { picture } = c4Views(model)[1];
  assert.equal(picture.match(/1\. /g)?.length, 1);
  assert.match(picture, /c_web <-->\|"1\. Costs \$\$ & \$1: ask<br\/>2\. API: answer<br\/>/);
  assert.match(picture, /c_api -->\|"3\. answer again<br\/>\u2800"\| c_web/);
});

void test('a story with no container taking part has no system boundary', () => {
  const model = shop();
  model.relationships.push({ from: 'p_buyer', to: 's_bank', description: 'Pays in person' });
  model.dynamics = [{ key: 'cash', title: 'Cash', steps: [{ from: 'p_buyer', to: 's_bank', description: 'Pays in person' }] }];
  const { picture, native } = c4Views(model)[1];
  assert.doesNotMatch(picture, /subgraph/);
  assert.doesNotMatch(native, /System_Boundary/);
});

void test('render-c4 removes files it wrote for a spec that no longer opts in, and --check reports them', () => {
  const { dir } = renderC4({ shop: shopSpec() });
  writeFileSync(join(dir, 'c4', 'notes.md'), '# mine\n');
  // Hand-written files that quote or copy a generated one are not this script's to remove.
  writeFileSync(join(dir, 'c4', 'README.md'), 'Each page says: Generated from x by `scripts/render-c4.ts`; edit that, not this page.\n');
  writeFileSync(join(dir, 'c4', 'variant.dsl'), `// my own copy\n${readFileSync(join(dir, 'c4', 'shop.dsl'), 'utf8')}`);
  mkdirSync(join(dir, 'c4', 'folder.md'));
  const optedOut = shopSpec(); delete optedOut.c4;
  writeFileSync(join(dir, 'specs', 'shop.explorer.json'), JSON.stringify(optedOut));
  const check = runC4(dir, '--check');
  assert.equal(check.code, 1);
  assert.match(check.err, /shop\.dsl is left over/);
  assert.match(check.err, /shop\.md is left over/);
  assert.equal(runC4(dir).code, 0);
  assert.deepEqual(readdirSync(join(dir, 'c4')).sort(), ['README.md', 'folder.md', 'notes.md', 'variant.dsl']);
  rmSync(dir, { recursive: true });
});

void test('render-c4 names a spec file it cannot read instead of crashing', () => {
  const { dir } = renderC4({});
  writeFileSync(join(dir, 'specs', 'broken.explorer.json'), '{ not json');
  const run = runC4(dir);
  assert.equal(run.code, 1);
  assert.match(run.err, /^render-c4: broken: /m);
  assert.doesNotMatch(run.err, /at JSON\.parse/);
  rmSync(dir, { recursive: true });
});

void test('render-c4 keeps the files of a spec that broke, and reports a bad flag or folder in one line', () => {
  const { dir } = renderC4({ shop: shopSpec() });
  const broken = shopSpec(); broken.flows![0].steps.push(['web', 'nowhere', 'Calls', 'x']);
  writeFileSync(join(dir, 'specs', 'shop.explorer.json'), JSON.stringify(broken));
  const check = runC4(dir, '--check');
  assert.match(check.err, /shop: flows\.checkout\.steps\[5\]: unknown node "nowhere"/);
  assert.doesNotMatch(check.err, /left over/);
  for (const flags of [['--bogus'], ['--specs', join(dir, 'specs', 'shop.explorer.json')], ['--specs', join(dir, 'nowhere')]]) {
    const run = runC4(dir, ...flags);
    assert.equal(run.code, 1);
    assert.match(run.err, /^render-c4: /);
    assert.doesNotMatch(run.err, /\n\s+at /);
  }
  rmSync(dir, { recursive: true });
});

void test('validateC4 wants a name for the system, and view keys that differ by more than case', () => {
  const model = shop();
  model.system.name = ' ';
  model.dynamics.push({ key: 'CHECKOUT', title: 'Again', steps: model.dynamics[0].steps });
  const problems = validateC4(model);
  assert.ok(problems.includes('the described system has no name'));
  assert.ok(problems.includes('duplicate dynamic view "CHECKOUT"'));
});
