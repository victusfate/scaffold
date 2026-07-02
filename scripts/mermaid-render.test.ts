#!/usr/bin/env node
// Tests for scripts/mermaid-render.ts — mermaid.live URL encoding + CLI smoke.

import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'mermaid-render.ts');
let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// Decode a mermaid.live #pako: URL back to its editor-state object.
function decode(url: string): { code: string; mermaid: { theme: string } } {
  const b64 = url.split('#pako:')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
  return JSON.parse(json) as { code: string; mermaid: { theme: string } };
}

const { mermaidLiveUrl, wrapMarkdown, titleFromPath, openerArgs, interactiveHtml } = await import('./mermaid-render.ts');

// OS default-viewer command per platform
{
  assert('macOS uses open', JSON.stringify(openerArgs('darwin', 'a.svg')) === JSON.stringify({ cmd: 'open', args: ['a.svg'] }));
  assert('Linux uses xdg-open', openerArgs('linux', 'a.svg').cmd === 'xdg-open');
  assert('Windows uses start', JSON.stringify(openerArgs('win32', 'a.svg').args) === JSON.stringify(['/c', 'start', '', 'a.svg']));
}

// title is derived from the file stem
{
  assert('titleFromPath title-cases the slug', titleFromPath('diagrams/product-photo-service.mmd') === 'Product Photo Service', titleFromPath('diagrams/product-photo-service.mmd'));
}

// wrapper embeds the source inside a mermaid fence
{
  const mmd = 'flowchart LR\n  A --> B';
  const md = wrapMarkdown(mmd, 'diagrams/demo-flow.mmd');
  assert('wrapper has an H1 title', md.startsWith('# Demo Flow'));
  assert('wrapper fences the mermaid', md.includes('```mermaid\n' + mmd + '\n```'), md);
  assert('wrapper names the .mmd source', md.includes('`demo-flow.mmd`'));
}

// round-trips the mermaid source through deflate/base64url
{
  const mmd = 'flowchart LR\n  A --> B';
  const state = decode(mermaidLiveUrl(mmd));
  assert('URL round-trips the source', state.code === mmd, JSON.stringify(state));
  assert('URL carries the theme', state.mermaid.theme === 'default');
}

// base64url alphabet only — no +, /, or = padding that breaks the fragment
{
  const frag = mermaidLiveUrl('sequenceDiagram\n  A->>B: hi').split('#pako:')[1];
  assert('URL fragment is base64url-safe', /^[A-Za-z0-9_-]+$/.test(frag), frag);
}

// deterministic — same input yields the same URL (idempotent)
{
  const mmd = 'erDiagram\n  USER ||--o{ ORDER : places';
  assert('URL is deterministic', mermaidLiveUrl(mmd) === mermaidLiveUrl(mmd));
}

// base host is selectable (self-hosted localhost editor) and shares encoding
{
  const mmd = 'flowchart LR\n  A --> B';
  const remote = mermaidLiveUrl(mmd);
  const localUrl = mermaidLiveUrl(mmd, 'default', 'http://localhost:8080');
  assert('default base is mermaid.live', remote.startsWith('https://mermaid.live/edit#pako:'));
  assert('local base targets localhost', localUrl.startsWith('http://localhost:8080/edit#pako:'));
  assert('same pako across hosts', remote.split('#pako:')[1] === localUrl.split('#pako:')[1]);
}

// interactive HTML viewer fills the template with the SVG + title
{
  const template = readFileSync(join(HERE, 'mermaid-viewer.template.html'), 'utf8');
  const svg = '<svg viewBox="0 0 100 50"><rect width="100" height="50"/></svg>';
  const html = interactiveHtml(svg, 'Demo Flow', template);
  assert('HTML inlines the SVG', html.includes(svg));
  assert('HTML carries the title', html.includes('<title>Demo Flow</title>'));
  assert('HTML has pan/zoom script', html.includes('addEventListener') && html.includes('wheel'));
  assert('HTML is self-contained (no external http refs)', !/(src|href)\s*=\s*["']https?:/i.test(html), html.slice(0, 200));
  assert('HTML strips any XML prolog', !interactiveHtml('<?xml version="1.0"?>\n' + svg, 'X', template).includes('<?xml'));
  assert('template placeholders are consumed', !html.includes('%%SVG%%') && !html.includes('%%TITLE%%'));
  assert('$ in SVG is not treated as a replacement pattern', interactiveHtml('<svg>$&$1 cost</svg>', 'T', template).includes('$&$1 cost'));
}

// CLI smoke: --no-render conflicts with --png (a render) and refuses
{
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-render-'));
  let stderr = '', exited = 0;
  try {
    const mmd = join(dir, 'demo.mmd');
    writeFileSync(mmd, 'flowchart TD\n  X --> Y\n');
    execFileSync('node', [SCRIPT, mmd, '--no-render', '--png'], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e: unknown) {
    const err = e as { status?: number; stderr?: Buffer };
    exited = err.status ?? 1;
    stderr = err.stderr?.toString() ?? '';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert('CLI --no-render --png exits non-zero', exited !== 0, String(exited));
  assert('CLI --no-render --png explains the conflict', stderr.includes('--png'), stderr);
}

// CLI smoke: --publish --no-render prints a live URL and renders nothing
{
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-render-'));
  try {
    const mmd = join(dir, 'demo.mmd');
    writeFileSync(mmd, 'flowchart TD\n  X --> Y\n');
    const out = execFileSync('node', [SCRIPT, mmd, '--publish', '--no-render'], { encoding: 'utf8' });
    assert('CLI --publish prints a live URL', out.includes('https://mermaid.live/edit#pako:'), out);
    assert('CLI --no-render skips render', !out.includes('rendered:'), out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// CLI smoke: default (no flags) emits nothing remote — no mermaid.live URL
// (render itself needs mmdc/Chromium, so assert via --no-render guard instead)
{
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-render-'));
  let stderr = '';
  let exited = 0;
  try {
    const mmd = join(dir, 'demo.mmd');
    writeFileSync(mmd, 'flowchart TD\n  X --> Y\n');
    // --no-render alone has no output to produce and must refuse, proving the
    // default path never reaches the publish/URL branch without --publish.
    execFileSync('node', [SCRIPT, mmd, '--no-render'], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e: unknown) {
    const err = e as { status?: number; stderr?: Buffer };
    exited = err.status ?? 1;
    stderr = err.stderr?.toString() ?? '';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert('CLI --no-render without --publish exits non-zero', exited !== 0, String(exited));
  assert('CLI --no-render without --publish explains why', stderr.includes('--publish'), stderr);
}

// CLI smoke: --wrap --no-render writes the .md wrapper and nothing else
{
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-render-'));
  try {
    const mmd = join(dir, 'demo-flow.mmd');
    writeFileSync(mmd, 'flowchart TD\n  X --> Y\n');
    const out = execFileSync('node', [SCRIPT, mmd, '--wrap', '--no-render'], { encoding: 'utf8' });
    assert('CLI --wrap reports the wrapper path', out.includes('wrapped:') && out.includes('demo-flow.md'), out);
    assert('CLI --wrap skips render', !out.includes('rendered:'), out);
    const md = readFileSync(join(dir, 'demo-flow.md'), 'utf8');
    assert('wrapper file fences the source', md.includes('```mermaid') && md.includes('X --> Y'), md);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// CLI smoke: missing input exits non-zero
{
  let exited = 0;
  try {
    execFileSync('node', [SCRIPT, join(tmpdir(), 'does-not-exist.mmd'), '--publish', '--no-render'], { stdio: 'ignore' });
  } catch (e: unknown) {
    exited = (e as { status?: number }).status ?? 1;
  }
  assert('CLI exits non-zero on missing input', exited !== 0, String(exited));
}

console.error(`\nmermaid-render: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
