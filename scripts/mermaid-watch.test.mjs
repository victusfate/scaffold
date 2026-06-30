#!/usr/bin/env node
// Tests for scripts/mermaid-watch.mjs — preview page builder + server smoke.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'mermaid-watch.mjs');
let passed = 0, failed = 0;
const assert = (label, cond, detail = '') => {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
};

const { pageHtml } = await import('./mermaid-watch.mjs');

// page wires the live-reload + render pieces
{
  const html = pageHtml('diagrams/demo.mmd', 'dark');
  assert('page names the watched file', html.includes('diagrams/demo.mmd'));
  assert('page imports mermaid from CDN', html.includes('mermaid@11'));
  assert('page opens an SSE stream', html.includes("EventSource('/events')"));
  assert('page fetches /raw to render', html.includes("fetch('/raw'"));
  assert('page applies the theme', html.includes('"dark"'));
}

// server smoke: serves the page and the raw file, then a save pushes an event
{
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-watch-'));
  const file = join(dir, 'demo.mmd');
  writeFileSync(file, 'flowchart TD\n  X --> Y\n');
  const port = 8099;
  const srv = spawn('node', [SCRIPT, file, '--port', String(port)], { stdio: 'ignore' });
  try {
    await sleep(700);
    const home = await fetch(`http://localhost:${port}/`).then(r => r.text());
    assert('server serves the preview page', home.includes('<!DOCTYPE html>') && home.includes('demo.mmd'), home.slice(0, 60));
    const raw = await fetch(`http://localhost:${port}/raw`).then(r => r.text());
    assert('server serves the raw .mmd', raw.includes('X --> Y'), raw);

    // open an SSE stream, then change the file — expect a reload event
    const ac = new AbortController();
    const evRes = await fetch(`http://localhost:${port}/events`, { signal: ac.signal });
    const reader = evRes.body.getReader();
    await sleep(150);
    writeFileSync(file, 'flowchart TD\n  X --> Z\n');
    let got = '';
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !got.includes('reload')) {
      const { value, done } = await reader.read();
      if (done) break;
      got += Buffer.from(value).toString();
    }
    ac.abort();
    assert('save pushes a reload event', got.includes('reload'), JSON.stringify(got));
  } catch (e) {
    assert('server smoke ran', false, String(e));
  } finally {
    srv.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

console.error(`\nmermaid-watch: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
