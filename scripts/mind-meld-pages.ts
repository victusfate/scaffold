// mind-meld-pages — a validated mind-meld bundle as one GitHub markdown page: the observed call path as
// an overview, then each indexed function with its source span, static calls and recorded calls.
// Why: the offline viewer needs a browser and the bundle file; a committed markdown page lets anyone read
// a repo's recorded walkthrough on GitHub and hand it to their own LLM. Facts only: every line comes from
// an indexed span or a recorded event, never narration (mind-meld: never synthesize a missing edge,
// value or run). Rendered by scripts/explorer-markdown.ts.

import { renderMarkdown, type PageContext } from './explorer-markdown.ts';
import type { Bullet, ExplorerNode, ExplorerSpec, Flow, FlowStep } from './explorer-spec.ts';
import { validateBundle, type MeldBundle, type MeldEvent, type MeldNode, type MeldRun } from './mind-meld-schema.ts';

export interface PageOptions {
  // How links on the page reach source files, e.g. '../' for a page one directory below the repo root.
  sourcePrefix: string;
  title?: string;
  context?: PageContext;
}

// A recorded value as a code span: payload text can't render as markdown or as a hidden HTML tag.
const value = (text: string): string => `\`${text.replace(/`/g, "'").replace(/\s+/g, ' ')}\``;
// A fenced excerpt must not contain a fence of its own.
const excerpt = (source: string, node: MeldNode): string =>
  source.split('\n').slice(node.line - 1, node.endLine).join('\n').replace(/```/g, "'''");

function recordedCalls(bundle: MeldBundle, nodeId: string): Bullet[] {
  return bundle.runs.flatMap(run => run.events.filter(e => e.node === nodeId).map((e): Bullet => ({
    t: `${run.mode} ${run.key}: called with ${value(e.input)}, returned ${value(e.output)}`,
    more: e.changes.map(c => `${value(c.key)}: ${value(c.before)} → ${value(c.after)}`),
  })));
}

function stage(bundle: MeldBundle, node: MeldNode, sourcePrefix: string): ExplorerNode {
  const span = `${node.file}:${node.line}-${node.endLine}`;
  const calls = bundle.edges.filter(e => e.from === node.id).map(e => e.to);
  return {
    lane: node.layer,
    name: node.id,
    role: `Defined in ${span}.`,
    details: [
      `Source: [${span}](${sourcePrefix}${node.file}#L${node.line}-L${node.endLine})`,
      ...(calls.length ? [`Static calls (possible, not observed): ${[...new Set(calls)].sort().join(', ')}`] : []),
      ...recordedCalls(bundle, node.id),
      { t: 'Source excerpt', more: [], code: excerpt(bundle.sources[node.file], node) },
    ],
  };
}

// A recorded hop is a call whose parent was recorded in the same run; a single-call run has none.
function flowOf(run: MeldRun): Flow[] {
  const byId = new Map<string, MeldEvent>(run.events.map(e => [e.id, e]));
  const steps = run.events.flatMap((e): FlowStep[] => {
    const parent = e.parent ? byId.get(e.parent) : undefined;
    return parent ? [[parent.node, e.node, `called with ${value(e.input)}`, `returned ${value(e.output)}`]] : [];
  });
  return steps.length ? [{ id: run.key, name: `${run.mode} ${run.entry} returned ${value(run.output)}`, steps }] : [];
}

// Without recorded runs the only true arrows are the indexed static calls, named as possible, not
// observed; nothing else may be drawn (an invented chain would be a claim the bundle never made).
function staticFlow(bundle: MeldBundle): Flow[] {
  const steps = bundle.edges.map((e): FlowStep => [e.from, e.to, `may call (static, ${e.file}:${e.line})`, 'not observed']);
  return steps.length ? [{ id: 'static', name: 'Static calls (possible, not observed)', steps }] : [];
}

// Lanes in the order a reader meets them: along the first recorded path, then any other indexed layer.
function laneOrder(bundle: MeldBundle): string[] {
  const nodeLayer = new Map(bundle.nodes.map(n => [n.id, n.layer]));
  const seen = bundle.runs.flatMap(r => r.events.map(e => nodeLayer.get(e.node) ?? ''));
  return [...new Set([...seen, ...bundle.nodes.map(n => n.layer)].filter(Boolean))];
}

export function bundleToSpec(bundle: MeldBundle, options: PageOptions): ExplorerSpec {
  validateBundle(bundle);
  const entries = [...new Set(bundle.runs.map(r => r.entry))];
  const lanes = laneOrder(bundle);
  return {
    title: options.title ?? `Mind meld: ${entries.join(', ') || 'index'}`,
    lede: `${bundle.runs.length
      ? `Recorded from real runs of this repo's code at source snapshot ${bundle.snapshotHash}.`
      : `Indexed from this repo's source at snapshot ${bundle.snapshotHash}. No runs were recorded, so arrows are static calls that may happen, not observed ones.`} Whether that matches today's checkout is unknown until \`mind-meld.ts verify\` passes.`,
    lanes: lanes.map(id => ({ id, name: id })),
    // Stages follow lane order so a reader meets the entry point first.
    nodes: Object.fromEntries(lanes.flatMap(lane => bundle.nodes.filter(n => n.layer === lane))
      .map(n => [n.id, stage(bundle, n, options.sourcePrefix)])),
    flows: bundle.runs.length ? bundle.runs.flatMap(flowOf) : staticFlow(bundle),
    ask: { context: `The reader is learning how ${entries.join(', ') || 'this code'} works in this repo from recorded runs (snapshot ${bundle.snapshotHash}).` },
  };
}

export const renderPage = (bundle: MeldBundle, options: PageOptions): string =>
  renderMarkdown(bundleToSpec(bundle, options), options.context);
