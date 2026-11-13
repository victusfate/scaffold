#!/usr/bin/env node
// Tests for scripts/explorer-render.ts + explorer-spec.ts — spec validation,
// safe JSON embedding, flow → mermaid export, and a CLI smoke on the shipped
// example spec.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'explorer-render.ts');
const EXAMPLE = join(HERE, '..', 'skills', 'diagram', 'explorer-example.explorer.json');
let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const { validateSpec } = await import('./explorer-spec.ts');
const { renderHtml, flowToMermaid, outPaths, parseArgs } = await import('./explorer-render.ts');
const { jsonForScript } = await import('./json-script.ts');
type Spec = Parameters<typeof validateSpec>[0];
const example = (): Spec => JSON.parse(readFileSync(EXAMPLE, 'utf8')) as Spec;

// the shipped example is valid
{
  const errs = validateSpec(example());
  assert('example spec validates', errs.length === 0, errs.join('; '));
}

// dangling references are reported, not silently rendered
{
  const s = example();
  s.flows![0].steps[0][1] = 'nope';
  s.nodes.web.lane = 'ghost';
  s.timeline!.events[0].track = 9;
  s.timeline!.events[1].topics = ['missing'];
  s.glossary!.outbox.a.push('idempotent');
  s.start = { node: 'zzz' };
  const errs = validateSpec(s).join('\n');
  assert('flow step to unknown node', errs.includes('unknown node "nope"'), errs);
  assert('node in unknown lane', errs.includes('unknown lane "ghost"'), errs);
  assert('timeline track out of range', errs.includes('track 9 out of range'), errs);
  assert('timeline unknown topic', errs.includes('unknown topic "missing"'), errs);
  assert('glossary alias claimed twice', errs.includes('alias "idempotent" already belongs to idem'), errs);
  assert('start node unknown', errs.includes('start.node: unknown node "zzz"'), errs);
}

// required top-level fields short-circuit
{
  const errs = validateSpec({ title: '', lanes: [], nodes: {} } as unknown as Spec);
  assert('empty spec reports title, lanes and nodes', errs.length === 3, errs.join('; '));
}

// embedding: a "</script>" in content cannot close the JSON block
{
  const s = example();
  s.nodes.web.role = 'evil </script><script>alert(1)</script>';
  const json = jsonForScript(s);
  assert('no raw < in embedded JSON', !json.includes('<'));
  assert('embedded JSON round-trips', (JSON.parse(json) as Spec).nodes.web.role === s.nodes.web.role);
  const html = renderHtml(s, '<title>__TITLE__</title><script type="application/json">__SPEC__</script>');
  assert('only the template script closes', html.split('</script>').length === 2);
}

// title is HTML-escaped and $-patterns in content are not treated as replacement tokens
{
  const s = example();
  s.title = 'A & B <c> $& $1';
  const html = renderHtml(s, '<title>__TITLE__</title>__SPEC__');
  assert('title escaped', html.includes('<title>A &amp; B &lt;c&gt; $&amp; $1</title>'), html.slice(0, 80));
}

// flow → mermaid sequenceDiagram
{
  const s = example();
  s.flows![0].steps[0][2] = 'a; b # c';
  const mmd = flowToMermaid(s, s.flows![0]);
  assert('starts with sequenceDiagram', mmd.startsWith('sequenceDiagram\n'));
  assert('participants aliased to node names', mmd.includes('participant n_web as Web app'));
  assert('numbered messages', mmd.includes('n_web->>n_gateway: 1. '));
  assert('; and # escaped', mmd.includes('a#59; b #35; c'), mmd);
}

// paths + args
{
  assert('outPaths strips .explorer.json', outPaths('diagrams/x.explorer.json').html === 'diagrams/x.explorer.html');
  const a = parseArgs(['d.explorer.json', '--mmd', '--out', 'o.html']);
  assert('parseArgs', a.input === 'd.explorer.json' && a.mmd && a.out === 'o.html' && !a.check);
}

// CLI smoke: render example, export flows, reject an invalid spec
{
  const dir = mkdtempSync(join(tmpdir(), 'explorer-render-'));
  const spec = join(dir, 'demo.explorer.json');
  copyFileSync(EXAMPLE, spec);
  execFileSync('node', [SCRIPT, spec, '--mmd'], { stdio: 'pipe' });
  const html = readFileSync(join(dir, 'demo.explorer.html'), 'utf8');
  assert('CLI writes HTML with no placeholders left', !html.includes('__SPEC__') && !html.includes('__TITLE__'));
  assert('HTML loads no external script', !/<script[^>]+src=/i.test(html));
  assert('CLI writes one .mmd per flow', existsSync(join(dir, 'demo.checkout.mmd')) && existsSync(join(dir, 'demo.retry.mmd')));
  const bad = join(dir, 'bad.explorer.json');
  writeFileSync(bad, JSON.stringify({ title: 't', lanes: [{ id: 'a', name: 'A' }], nodes: { x: { lane: 'b', name: 'X', role: 'r' } } }));
  let code = 0, err = '';
  try { execFileSync('node', [SCRIPT, bad, '--check'], { stdio: 'pipe' }); }
  catch (e) { const x = e as { status: number; stderr: Buffer }; code = x.status; err = x.stderr.toString(); }
  assert('CLI --check exits 1 on invalid spec', code === 1 && err.includes('unknown lane "b"'), err);
  let unknown = 0;
  try { execFileSync('node', [SCRIPT, spec, '--outt', 'x.html'], { stdio: 'pipe' }); }
  catch (e) { unknown = (e as { status: number }).status; }
  assert('CLI rejects an unknown option', unknown === 1);
  rmSync(dir, { recursive: true, force: true });
}

console.error(`\nexplorer-render: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
