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
      deep: [{ h: 'Commits', table: { head: ['Step', 'Message'], rows: [['red', 'test: …'], ['green', 'feat: …']] } }] },
  },
  flows: [{ id: 'main', name: 'Main path', steps: [['design', 'tdd', 'Plan approved', 'plan.md']] }],
  glossary: { prd: { t: 'PRD', a: ['PRD'], d: 'Product requirements document.' } },
  ask: { context: 'The reader is learning the scaffold feature chain.' },
};

const md = renderMarkdown(SPEC);

void test('title, lede and an overview diagram in flow order', () => {
  assert.match(md, /^# Feature chain\n\nFrom an idea to a reviewed PR\./);
  assert.match(md, /```mermaid\nflowchart LR\n {2}design\["Design"\] --> tdd\["TDD #quot;slices#quot;"\]\n```/);
});

void test('each node is a linked section with role, nested detail, risks and tables', () => {
  assert.match(md, /- \[Design\]\(#design\): Resolve intent with the owner\./);
  assert.match(md, /## Design\n\nResolve intent with the owner\.\n\nGoes deeper: \[co-plan\.md\]\(co-plan\.md\)/);
  assert.match(md, /- Writes design\.md\n {2}- Decisions and vocabulary\.\n {4}- commit\n {4}- review/);
  assert.match(md, /\*\*Where it breaks\*\*\n\n- Tests written in bulk/);
  assert.match(md, /\| Step \| Message \|\n\|---\|---\|\n\| red \| test: … \|/);
});

void test('detailed diagram folded, glossary, copyable LLM context', () => {
  assert.match(md, /<details>\n<summary>Detailed flow<\/summary>\n\n!\[Feature chain, detailed\]\(\.\.\/generated\/feature-chain\.svg\)\n\n<\/details>/);
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
  assert.match(renderMarkdown(map), /```mermaid\nflowchart LR\n {2}subgraph a\["Run"\]\n {4}q\["Queue"\]\n {4}solo\["Solo"\]\n {2}end\n {2}subgraph b\["Build"\]\n {4}f\["Feature"\]\n {4}x\["Extra"\]\n {2}end\n {2}q --> f\n {2}f --> x\n```/);
});

void test('navigation: a link back up, and deeper links named by their page title', () => {
  const page = renderMarkdown(SPEC, { up: { title: 'Scaffold at a glance', link: 'system-map.md' }, titles: { 'co-plan.md': 'Co-plan' } });
  assert.match(page, /^\[← Scaffold at a glance\]\(system-map\.md\)\n\n# Feature chain/);
  assert.match(page, /Goes deeper: \[Co-plan\]\(co-plan\.md\)/);
  assert.match(renderMarkdown({ ...SPEC, nodes: { d: { ...SPEC.nodes.design, link: '../../../skills/co-plan.md' } } }),
    /Goes deeper: \[\/co-plan skill\]\(\.\.\/\.\.\/\.\.\/skills\/co-plan\.md\)/);
});

void test('a node with no detail of its own links straight to its page and gets no section', () => {
  const page = renderMarkdown({ title: 'Map', lanes: [{ id: 'l', name: 'L' }],
    nodes: { o: { lane: 'l', name: 'Orchestration', role: 'One orchestrator per session.', link: 'orchestration.md' } } },
  { titles: { 'orchestration.md': 'Orchestration' } });
  assert.match(page, /- \[Orchestration\]\(orchestration\.md\): One orchestrator per session\./);
  assert.doesNotMatch(page, /## Orchestration/);
});

void test('deterministic', () => assert.equal(renderMarkdown(SPEC), md));
