/// <reference lib="dom" />
// Portable offline viewer. Data stays text; no paths, scripts or URLs from a bundle execute.
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { validateBundle, type MeldBundle, type MeldEvent, type MeldNode } from './mind-meld-schema.ts';

/** Kept self-contained because this function becomes the standalone browser payload. */
function viewer(bundle: MeldBundle): void {
  const RUN_HASH_LENGTH = 10;
  const GRAPH_LEFT = 20;
  const GRAPH_TOP = 30;
  const GRAPH_COLUMN_STEP = 240;
  const GRAPH_ROW_STEP = 80;
  const GRAPH_MIN_HEIGHT = 150;
  const GRAPH_MIN_WIDTH = 480;
  const GRAPH_NODE_WIDTH = 170;
  const GRAPH_NODE_HEIGHT = 40;
  const GRAPH_CORNER_RADIUS = 6;
  const GRAPH_LABEL_INSET = 12;
  const GRAPH_LABEL_BASELINE = 26;
  const element = (tag: string, text = '') => {
    const node = document.createElement(tag); node.textContent = text; return node;
  };
  const graph = document.getElementById('graph')!;
  const trace = document.getElementById('trace')!;
  const source = document.getElementById('source')!;
  const citation = document.getElementById('citation')!;
  const changes = document.getElementById('changes')!;
  const runChoice = document.getElementById('run') as HTMLSelectElement;
  const query = document.getElementById('state') as HTMLInputElement;
  let runIndex = 0;
  let eventIndex = 0;
  function showSource(node: MeldNode): void {
    citation.textContent = `${node.file}:${node.line}–${node.endLine}`;
    source.replaceChildren();
    bundle.sources[node.file].split('\n').forEach((line, i) => {
      const row = element(i + 1 >= node.line && i + 1 <= node.endLine ? 'mark' : 'span', `${i + 1}  ${line}\n`);
      source.append(row);
    });
  }
  function showEvent(event: MeldEvent): void {
    const node = bundle.nodes.find(n => n.id === event.node)!;
    showSource(node);
    document.getElementById('values')!.textContent = `Input: ${event.input}\nOutput: ${event.output}\nObserved duration: ${event.durationMs.toFixed(3)} ms`;
    document.getElementById('position')!.textContent = `Step ${eventIndex + 1} of ${bundle.runs[runIndex].events.length}: ${event.node}`;
  }
  function showChanges(): void {
    changes.replaceChildren();
    const events = bundle.runs[runIndex]?.events ?? [];
    for (const event of events) {
      for (const change of event.changes.filter(c => c.key.includes(query.value))) {
        changes.append(element('li', `${change.key}: ${change.before} → ${change.after} (${event.node}, event ${event.id})`));
      }
    }
  }
  function showRun(): void {
    const run = bundle.runs[runIndex];
    trace.replaceChildren();
    document.getElementById('edges')!.replaceChildren();
    if (!run) return;
    for (const [at, event] of run.events.entries()) {
      const row = element('li'); const button = element('button', `${event.node} · ${event.durationMs.toFixed(3)} ms`);
      button.addEventListener('click', () => { eventIndex = at; showEvent(event); }); row.append(button); trace.append(row);
      if (event.parent !== null) {
        const parent = run.events.find(e => e.id === event.parent)!;
        document.getElementById('edges')!.append(element('li', `${parent.node} → ${event.node} (observed events ${parent.id} → ${event.id})`));
      }
    }
    if (run.events.length) showEvent(run.events[eventIndex]);
    showChanges();
  }
  function drawGraph(): void {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const layers = [...new Set(bundle.nodes.map(n => n.layer))].sort((a, b) => a === 'entry' ? -1 : b === 'entry' ? 1 : a.localeCompare(b));
    const positions = new Map(bundle.nodes.map(node => {
      const peers = bundle.nodes.filter(n => n.layer === node.layer);
      return [node.id, { x: GRAPH_LEFT + layers.indexOf(node.layer) * GRAPH_COLUMN_STEP,
        y: GRAPH_TOP + peers.findIndex(n => n.id === node.id) * GRAPH_ROW_STEP }];
    }));
    const height = Math.max(GRAPH_MIN_HEIGHT, bundle.nodes.length * GRAPH_ROW_STEP);
    svg.setAttribute('viewBox', `0 0 ${Math.max(GRAPH_MIN_WIDTH, layers.length * GRAPH_COLUMN_STEP)} ${height}`);
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Static dependency graph; call-site details and interactive nodes follow below');
    const defs = document.createElementNS(ns, 'defs');
    const marker = document.createElementNS(ns, 'marker');
    for (const [key, value] of Object.entries({ id: 'call-arrow', viewBox: '0 0 10 10', refX: '10', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' })) marker.setAttribute(key, value);
    const arrow = document.createElementNS(ns, 'path'); arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); arrow.setAttribute('fill', '#287f85');
    marker.append(arrow); defs.append(marker); svg.append(defs);
    for (const edge of bundle.edges) {
      const from = positions.get(edge.from)!; const to = positions.get(edge.to)!;
      const line = document.createElementNS(ns, 'path');
      line.setAttribute('d', `M ${from.x + GRAPH_NODE_WIDTH} ${from.y + GRAPH_NODE_HEIGHT / 2} L ${to.x} ${to.y + GRAPH_NODE_HEIGHT / 2}`);
      line.setAttribute('marker-end', 'url(#call-arrow)'); line.setAttribute('stroke', '#287f85'); line.setAttribute('fill', 'none'); line.setAttribute('stroke-width', '2');
      svg.append(line);
    }
    for (const node of bundle.nodes) {
      const at = positions.get(node.id)!;
      const box = document.createElementNS(ns, 'rect');
      for (const [key, value] of Object.entries({ x: at.x, y: at.y, width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT, rx: GRAPH_CORNER_RADIUS })) box.setAttribute(key, String(value));
      box.setAttribute('fill', '#dcebea'); svg.append(box);
      const label = document.createElementNS(ns, 'text'); label.setAttribute('x', String(at.x + GRAPH_LABEL_INSET)); label.setAttribute('y', String(at.y + GRAPH_LABEL_BASELINE));
      label.textContent = node.id; svg.append(label);
    }
    document.getElementById('diagram')!.append(svg);
  }
  drawGraph();
  for (const layer of new Set(bundle.nodes.map(n => n.layer))) {
    const section = element('section'); section.append(element('h3', layer));
    const list = element('ul');
    for (const node of bundle.nodes.filter(n => n.layer === layer)) {
      const row = element('li'); const button = element('button', `${node.id}`);
      button.addEventListener('click', () => showSource(node)); row.append(button); list.append(row);
    }
    section.append(list); graph.append(section);
  }
  for (const edge of bundle.edges) {
    document.getElementById('static-edges')!.append(element('li', `${edge.from} → ${edge.to} (static call at ${edge.file}:${edge.line})`));
  }
  bundle.runs.forEach((run, at) => {
    const option = element('option', `${run.mode}: ${run.entry} · ${run.key.slice(0, RUN_HASH_LENGTH)}`) as HTMLOptionElement;
    option.value = String(at); runChoice.append(option);
  });
  runChoice.addEventListener('change', () => { runIndex = Number(runChoice.value); eventIndex = 0; showRun(); });
  query.addEventListener('input', showChanges);
  for (const [id, delta] of [['previous', -1], ['next', 1]] as const) {
    document.getElementById(id)!.addEventListener('click', () => {
      const events = bundle.runs[runIndex]?.events ?? [];
      if (!events.length) return;
      eventIndex = Math.min(events.length - 1, Math.max(0, eventIndex + delta)); showEvent(events[eventIndex]);
    });
  }
  if (bundle.nodes.length) showSource(bundle.nodes[0]);
  showRun();
}
const STYLE = `body{font:16px system-ui;margin:0;background:#f7f5ef;color:#18252c}header,main{padding:1.5rem;max-width:1200px;margin:auto}h1{margin:.3rem 0}button,select,input{font:inherit;padding:.55rem;margin:.2rem;border:1px solid #667680;border-radius:.3rem;background:white;color:inherit}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #007b83;outline-offset:2px}#graph,.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}section,aside{min-width:0}pre{overflow:auto;background:#17252c;color:#f5f3eb;padding:1rem;line-height:1.5;max-height:34rem}mark{background:#ffe29b;color:#17252c}#snapshot{overflow-wrap:anywhere}#diagram svg{width:100%;max-height:22rem}li{margin:.35rem 0}#position{font-weight:bold}label{display:block}small{color:#435760}`;
const hash = (text: string) => createHash('sha256').update(text).digest('base64');
export function renderViewer(bundle: MeldBundle): string {
  validateBundle(bundle);
  const data = JSON.stringify(bundle).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const script = stripTypeScriptTypes(`(${viewer.toString()})(${data});`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(STYLE)}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Mind Meld · recorded code tour</title><style>${STYLE}</style></head><body>
<header><h1>Mind Meld</h1><p>A learning IDE over recorded execution. Click a node or step to inspect its source.</p><small>Static arrows show possible calls from source. Observed arrows, values and changes come from recorded runs. Narration never supplies edges.</small></header>
<main><p id="snapshot">Source snapshot: ${bundle.snapshotHash}. Offline capture; current checkout freshness is unknown. Run the CLI verify command before relying on this tour.</p><section><h2>Structure map</h2><div id="diagram"></div><div id="graph"></div><h3>Static dependencies (possible calls)</h3><ul id="static-edges"></ul><h3>Observed call edges</h3><ul id="edges"></ul></section>
<div class="columns"><section><h2>Flow trace &amp; guided tour</h2><label>Recorded run <select id="run"></select></label>
<button id="previous" type="button">Previous step</button><button id="next" type="button">Next step</button><p id="position" aria-live="polite"></p><ol id="trace"></ol><pre id="values"></pre>
<h2>Data flow</h2><label>Follow state key <input id="state" placeholder="e.g. hp"></label><ol id="changes"></ol></section>
<aside><h2>Source</h2><p id="citation" aria-live="polite"></p><pre><code id="source"></code></pre></aside></div></main>
<script>${script}</script></body></html>`;
}
