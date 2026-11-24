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

test('idAllocator prefixes by kind, keeps only identifier characters and never repeats', () => {
  const id = idAllocator();
  assert.equal(id('container', 'queue-db'), 'c_queue_db');
  assert.equal(id('container', 'queue_db'), 'c_queue_db_2');
  assert.equal(id('person', 'model'), 'p_model');
  assert.equal(id('component', 'scripts/a.b.ts'), 'm_scripts_a_b_ts');
});

test('validateC4 accepts a complete model', () => {
  assert.deepEqual(validateC4(shop()), []);
});

test('validateC4 names each problem', () => {
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

test('validateC4 requires a container', () => {
  const model = shop();
  model.elements = model.elements.filter(element => element.kind === 'person');
  model.relationships = []; model.dynamics = [];
  assert.deepEqual(validateC4(model), ['the described system has no container']);
});

test('renderStructurizr writes the model: people, external systems, grouped containers and components', () => {
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

test('renderStructurizr writes one view of each kind the model supports', () => {
  const dsl = renderStructurizr(shop());
  assert.match(dsl, /^ {8}systemContext sys "context" \{\n {12}include \*\n {12}autoLayout lr\n {8}\}$/m);
  assert.match(dsl, /^ {8}container sys "containers" \{$/m);
  assert.match(dsl, /^ {8}component c_api "components_c_api" \{$/m);
  assert.doesNotMatch(dsl, /component c_web /);
  assert.match(dsl, /^ {8}dynamic sys "checkout" "Checkout" \{\n {12}p_buyer -> c_web "Clicks pay"\n {12}c_web -> c_api "Posts the order"\n {12}autoLayout lr\n {8}\}$/m);
  assert.match(dsl, /element "Database" \{\n {16}shape Cylinder/);
});

test('renderStructurizr balances its braces and is stable', () => {
  const dsl = renderStructurizr(shop());
  assert.equal(dsl.split('{').length, dsl.split('}').length);
  assert.equal(dsl, renderStructurizr(shop()));
});
