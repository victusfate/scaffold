#!/usr/bin/env node
// Tests for scripts/mermaid-watch.ts — the pure helpers (arg parsing +
// live-reload injection). The render-and-serve path needs mmdc/Chromium, so it
// is exercised in use, not in this fast unit test.

let passed = 0, failed = 0;
const assert = (label: string, cond: boolean, detail = ''): void => {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
};

const { parseArgs, injectReload } = await import('./mermaid-watch.ts');

// arg parsing: file, port, portable
{
  const a = parseArgs(['diagrams/demo.mmd']);
  assert('positional is the file', a.file === 'diagrams/demo.mmd');
  assert('port defaults to 8080', a.port === 8080, String(a.port));
  assert('SVG-text labels by default, like mermaid-render', a.portable === true);

  const b = parseArgs(['x.mmd', '--port', '9100', '--html-labels']);
  assert('parses --port', b.port === 9100, String(b.port));
  assert('--html-labels opts out', b.portable === false);
}

// live-reload injection is self-contained and placed before </body>
{
  const html = '<html><body><svg></svg></body></html>';
  const out = injectReload(html);
  assert('injects an SSE reload client', out.includes('EventSource("/events")') && out.includes('location.reload()'));
  assert('injects before </body>', out.indexOf('EventSource') < out.indexOf('</body>'));
  assert('reload snippet is self-contained (no external http)', !/(src|href)\s*=\s*["']https?:/i.test(out));
  assert('appends when no </body>', injectReload('<svg></svg>').includes('EventSource'));
}

console.error(`\nmermaid-watch: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
