#!/usr/bin/env node
// Tests for scripts/explorer-markdown.ts — an explorer spec rendered as a GitHub markdown page.

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from './explorer-markdown.ts';
import type { ExplorerSpec } from './explorer-spec.ts';

const SPEC: ExplorerSpec = {
  title: 'Feature chain',
  lede: 'From an idea to a reviewed PR.',
  detail: '../generated/feature-chain.svg',
  lanes: [{ id: 'plan', name: 'Plan' }, { id: 'build', name: 'Build' }],
  nodes: {
    design: { lane: 'plan', name: 'Design', role: 'Resolve intent with the owner.', link: 'co-plan.md',
      details: ['One question at a time.', { t: 'Writes design.md', more: ['Decisions and vocabulary.', ['commit', 'review']] }],
      qs: ['When is a design "done"?'] },
    tdd: { lane: 'build', name: 'TDD "slices"', role: 'Red, green, refactor.',
      risks: ['Tests written in bulk verify imagined behavior.'],
      deep: [{ h: 'Commits', table: { head: ['Step', 'Message'], rows: [['red', 'test: …'], ['green', 'feat: a | b']] } }] },
  },
  flows: [{ id: 'main', name: 'Main path', steps: [['design', 'tdd', 'Plan approved', 'plan.md']] }],
  glossary: { prd: { t: 'PRD', a: ['PRD'], d: 'Product requirements document.' } },
  ask: { context: 'The reader is learning the scaffold feature chain.' },
};

const md = renderMarkdown(SPEC);

void test('title, lede and an overview diagram in flow order', () => {
  assert.match(md, /^# Feature chain\n\nFrom an idea to a reviewed PR\./);
  assert.match(md, /```mermaid\nflowchart LR\n {2}n_design\["Design"\] --> n_tdd\["TDD #quot;slices#quot;"\]\n/);
});

void test('each node is a linked section with role, nested detail, risks and tables', () => {
  assert.match(md, /- \[Design\]\(#design\): Resolve intent with the owner\./);
  assert.match(md, /## Design\n\nResolve intent with the owner\.\n\nDetails: \[co-plan\.md\]\(co-plan\.md\)/);
  assert.match(md, /- Writes design\.md\n {2}- Decisions and vocabulary\.\n {4}- commit\n {4}- review/);
  assert.match(md, /\*\*Where it breaks\*\*\n\n- Tests written in bulk/);
  assert.match(md, /\| Step \| Message \|\n\|---\|---\|\n\| red \| test: … \|\n\| green \| feat: a \\\| b \|/);
});

void test('detailed diagram shown under its own heading, glossary, copyable LLM context', () => {
  assert.match(md, /## Detailed flow\n\n!\[Feature chain, detailed\]\(\.\.\/generated\/feature-chain\.svg\)\n/);
  assert.doesNotMatch(md, /<details>/);
  assert.match(md, /\*\*PRD\*\*: Product requirements document\./);
  const ask = /## Ask your LLM\n\n[^\n]+\n\n```text\n([\s\S]*?)```/.exec(md)?.[1] ?? '';
  assert.match(ask, /The reader is learning the scaffold feature chain\./);
  assert.match(ask, /Design: Resolve intent with the owner\./);
  assert.match(ask, /When is a design "done"\?/);
});

void test('a map-like spec (nodes off every flow) groups all nodes by lane and draws every flow', () => {
  const map: ExplorerSpec = {
    title: 'Map', lanes: [{ id: 'a', name: 'Run' }, { id: 'b', name: 'Build' }],
    nodes: { q: { lane: 'a', name: 'Queue', role: 'r' }, solo: { lane: 'a', name: 'Solo', role: 'r' }, f: { lane: 'b', name: 'Feature', role: 'r' }, x: { lane: 'b', name: 'Extra', role: 'r' } },
    flows: [{ id: 'one', name: 'One', steps: [['q', 'f', 'w', 'p']] }, { id: 'two', name: 'Two', steps: [['f', 'x', 'w', 'p'], ['q', 'f', 'w', 'p']] }],
  };
  assert.match(renderMarkdown(map), /```mermaid\nflowchart LR\n {2}subgraph l_a\["Run"\]\n {4}n_q\["Queue"\]\n {4}n_solo\["Solo"\]\n {2}end\n {2}subgraph l_b\["Build"\]\n {4}n_f\["Feature"\]\n {4}n_x\["Extra"\]\n {2}end\n {2}n_q --> n_f\n {2}n_f --> n_x\n/);
});

void test('navigation: a link back up, and deeper links named by their page title', () => {
  const page = renderMarkdown(SPEC, { up: { title: 'Scaffold at a glance', link: 'system-map.md' }, titles: { 'co-plan.md': 'Co-plan' } });
  assert.match(page, /^\[← Scaffold at a glance\]\(system-map\.md\)\n\n# Feature chain/);
  assert.match(page, /Details: \[Co-plan\]\(co-plan\.md\)/);
  assert.match(renderMarkdown({ ...SPEC, nodes: { d: { ...SPEC.nodes.design, link: '../../../skills/co-plan.md' } } }),
    /Details: \[\/co-plan skill\]\(\.\.\/\.\.\/\.\.\/skills\/co-plan\.md\)/);
});

void test('a node with no detail of its own links straight to its page and gets no section', () => {
  const page = renderMarkdown({ title: 'Map', lanes: [{ id: 'l', name: 'L' }],
    nodes: { o: { lane: 'l', name: 'Orchestration', role: 'One orchestrator per session.', link: 'orchestration.md' } } },
  { titles: { 'orchestration.md': 'Orchestration' } });
  assert.match(page, /- \[Orchestration\]\(orchestration\.md\): One orchestrator per session\./);
  assert.doesNotMatch(page, /## Orchestration/);
});

void test('a mermaid keyword as an id cannot break the overview', () => {
  const page = renderMarkdown({ title: 'K', lanes: [{ id: 'end', name: 'End' }],
    nodes: { end: { lane: 'end', name: 'End', role: 'r' }, start: { lane: 'end', name: 'Start', role: 'r' } },
    flows: [{ id: 'f', name: 'F', steps: [['end', 'start', 'w', 'p']] }] });
  assert.match(page, /n_end\["End"\] --> n_start\["Start"\]/);
});

void test('boxes are colored by lane with the shared diagram palette; map lanes get a neutral background', () => {
  assert.match(md, /classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937\n {2}classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937\n {2}class n_design lane0\n {2}class n_tdd lane1\n```/);
  const map = renderMarkdown({ title: 'M', lanes: [{ id: 'a', name: 'A' }],
    nodes: { x: { lane: 'a', name: 'X', role: 'r' }, y: { lane: 'a', name: 'Y', role: 'r' }, z: { lane: 'a', name: 'Z', role: 'r' } },
    flows: [{ id: 'f', name: 'F', steps: [['x', 'y', 'w', 'p']] }] });
  assert.match(map, /```text\nM\n/, 'offline block starts with the page, no blank line');
  assert.match(map, /style l_a fill:#f9fafb,stroke:#d1d5db,color:#374151/);
});

void test('with a page URL the LLM block stays short: context, URLs and questions only', () => {
  const page = renderMarkdown(SPEC, { source: { name: 'Scaffold', repo: 'https://github.com/o/r', page: 'https://github.com/o/r/blob/main/p.md' } });
  const ask = /```text\n([\s\S]*?)```/.exec(page.slice(page.indexOf('## Ask your LLM')))?.[1] ?? '';
  assert.equal(ask, 'The reader is learning the scaffold feature chain.\nRead this page:\nhttps://github.com/o/r/blob/main/p.md\nScaffold: https://github.com/o/r\n\nQuestions worth asking:\n- When is a design "done"?\n');
});

void test('every line of the LLM block fits in 80 characters, wrapped on words; URLs stay whole', () => {
  const long = 'The reader wants an overview of scaffold, a template that gives AI coding agents shared skills, rules and workflows, and how its skills fit together.';
  const page = renderMarkdown({ ...SPEC, ask: { context: long }, nodes: { d: { ...SPEC.nodes.design, qs: [long] } } },
    { source: { name: 'Scaffold', repo: 'https://github.com/o/r', page: 'https://github.com/o/r/blob/main/docs/diagrams/pages/a-very-long-page-name-for-wrapping.md' } });
  const ask = /```text\n([\s\S]*?)```/.exec(page.slice(page.indexOf('## Ask your LLM')))?.[1] ?? '';
  const lines = ask.trimEnd().split('\n');
  assert.ok(lines.filter(l => !l.includes('https://')).every(l => l.length <= 80), lines.join('\n'));
  assert.match(ask, /^The reader wants an overview of scaffold, a template that gives AI coding agents\nshared skills/);
  assert.match(ask, /\n- The reader wants an overview of scaffold, a template that gives AI coding\n {2}agents shared/);
  assert.match(ask, /Read this page:\nhttps:\/\/github\.com\/o\/r\/blob\/main\/docs\/diagrams\/pages\/a-very-long-page-name-for-wrapping\.md\n/);
});

void test('no flows means no arrows: boxes grouped by lane, nothing invented', () => {
  const page = renderMarkdown({ title: 'N', lanes: [{ id: 'a', name: 'A' }], nodes: { x: { lane: 'a', name: 'X', role: 'r' }, y: { lane: 'a', name: 'Y', role: 'r' } } });
  assert.doesNotMatch(page, /-->/);
  assert.match(page, /subgraph l_a\["A"\]\n {4}n_x\["X"\]\n {4}n_y\["Y"\]/);
});

void test('distinct ids that sanitize alike stay distinct boxes', () => {
  const page = renderMarkdown({ title: 'D', lanes: [{ id: 'l', name: 'L' }],
    nodes: { 'a.b': { lane: 'l', name: 'Dot', role: 'r' }, a_b: { lane: 'l', name: 'Under', role: 'r' } },
    flows: [{ id: 'f', name: 'F', steps: [['a.b', 'a_b', 'w', 'p']] }] });
  assert.match(page, /n_a_b\["Dot"\] --> n_a_b_2\["Under"\]/);
});

void test('a code sample containing a fence gets a longer fence', () => {
  const page = renderMarkdown({ title: 'C', lanes: [{ id: 'l', name: 'L' }],
    nodes: { a: { lane: 'l', name: 'A', role: 'r', details: [{ t: 'Code', more: [], code: '```js\nx\n```' }] } } });
  assert.match(page, /\n````\n```js\nx\n```\n````\n/);
});

void test('deterministic', () => assert.equal(renderMarkdown(SPEC), md));
