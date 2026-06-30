#!/usr/bin/env node
// Tests for scripts/mermaid-render.ts — mermaid.live URL encoding + CLI smoke.

import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

const { mermaidLiveUrl } = await import('./mermaid-render.ts');

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

// CLI smoke: --url-only prints a live URL and renders nothing
{
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-render-'));
  try {
    const mmd = join(dir, 'demo.mmd');
    writeFileSync(mmd, 'flowchart TD\n  X --> Y\n');
    const out = execFileSync('node', [SCRIPT, mmd, '--url-only'], { encoding: 'utf8' });
    assert('CLI --url-only prints a live URL', out.includes('https://mermaid.live/edit#pako:'), out);
    assert('CLI --url-only skips render', !out.includes('rendered:'), out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// CLI smoke: missing input exits non-zero
{
  let exited = 0;
  try {
    execFileSync('node', [SCRIPT, join(tmpdir(), 'does-not-exist.mmd'), '--url-only'], { stdio: 'ignore' });
  } catch (e: unknown) {
    exited = (e as { status?: number }).status ?? 1;
  }
  assert('CLI exits non-zero on missing input', exited !== 0, String(exited));
}

console.error(`\nmermaid-render: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
