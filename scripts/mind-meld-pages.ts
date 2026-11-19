// mind-meld-pages — a validated mind-meld bundle as one GitHub markdown page: the observed call path as
// an overview, then each indexed function with its source span, static calls and recorded calls.
// Why: the offline viewer needs a browser and the bundle file; a committed markdown page lets anyone read
// a repo's recorded walkthrough on GitHub and hand it to their own LLM. Facts only: every line comes from
// an indexed span or a recorded event, never narration (mind-meld: never synthesize a missing edge,
// value or run). Rendered by scripts/explorer-markdown.ts.

import { codeSpan, renderMarkdown, type PageContext } from './explorer-markdown.ts';
import { validateSpec, type Bullet, type ExplorerNode, type ExplorerSpec, type Flow, type FlowStep } from './explorer-spec.ts';
import { validateBundle, type MeldBundle, type MeldEvent, type MeldNode, type MeldRun } from './mind-meld-schema.ts';

export interface PageOptions {
  // How links on the page reach source files, e.g. '../' for a page one directory below the repo root.
  sourcePrefix: string;
  title?: string;
  context?: PageContext;
}

const STATIC_CALLS = 'Static calls (possible, not observed)';
const NO_LAYER = '(no layer)';

// A recorded value exactly as recorded, in a code span so it can't render as markdown or a hidden HTML
// tag. Line breaks and tabs are shown as \n and \t, since a code span can't hold a line break.
const value = (text: string): string => codeSpan(text.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t'));
const excerpt = (source: string, node: MeldNode): string => source.split('\n').slice(node.line - 1, node.endLine).join('\n');
const layerOf = (node: MeldNode): string => node.layer || NO_LAYER;

function recordedCalls(bundle: MeldBundle, nodeId: string): Bullet[] {
  return bundle.runs.flatMap(run => run.events.filter(e => e.node === nodeId).map((e): Bullet => ({
    t: `${run.mode} ${run.key}: called with ${value(e.input)}, returned ${value(e.output)}`,
    more: e.changes.map(c => `${value(c.key)}: ${value(c.before)} → ${value(c.after)}`),
  })));
}

function nodeOf(bundle: MeldBundle, node: MeldNode, sourcePrefix: string): ExplorerNode {
  const span = `${node.file}:${node.line}-${node.endLine}`;
  const calls = bundle.edges.filter(e => e.from === node.id).map(e => e.to);
  return {
    lane: layerOf(node),
    name: node.id,
    role: `Defined in ${span}.`,
    details: [
      // <...> keeps a path with spaces or parentheses one link target.
      `Source: [${span}](<${sourcePrefix}${node.file}#L${node.line}-L${node.endLine}>)`,
      ...(calls.length ? [`${STATIC_CALLS}: ${[...new Set(calls)].sort().join(', ')}`] : []),
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
  return steps.length ? [{ id: 'static', name: STATIC_CALLS, steps }] : [];
}

// Lanes in the order a reader meets them: along the first recorded path, then any other indexed layer.
function laneOrder(bundle: MeldBundle): string[] {
  const byId = new Map(bundle.nodes.map(n => [n.id, n]));
  const seen = bundle.runs.flatMap(r => r.events.map(e => layerOf(byId.get(e.node)!)));
  return [...new Set([...seen, ...bundle.nodes.map(layerOf)])];
}

function lede(bundle: MeldBundle): string {
  const origin = bundle.runs.length
    ? `Recorded from real runs of this repo's code at source snapshot ${bundle.snapshotHash}.`
    : `Indexed from this repo's source at snapshot ${bundle.snapshotHash}. No runs were recorded, so arrows are static calls that may happen, not observed ones.`;
  return `${origin} Whether that matches today's checkout is unknown until \`mind-meld.ts verify\` passes.`;
}

// With runs, arrows are only observed hops (static calls stay in each function's details); without
// runs, they are the indexed static calls, labelled as such.
export function bundleToSpec(bundle: MeldBundle, options: PageOptions): ExplorerSpec {
  validateBundle(bundle);
  const entries = [...new Set(bundle.runs.map(r => r.entry))];
  const lanes = laneOrder(bundle);
  const spec: ExplorerSpec = {
    title: options.title ?? `Mind meld: ${entries.join(', ') || 'index'}`,
    lede: lede(bundle),
    lanes: lanes.map(id => ({ id, name: id })),
    // Stages follow lane order so a reader meets the entry point first.
    nodes: Object.fromEntries(lanes.flatMap(lane => bundle.nodes.filter(n => layerOf(n) === lane))
      .map(n => [n.id, nodeOf(bundle, n, options.sourcePrefix)])),
    flows: bundle.runs.length ? bundle.runs.flatMap(flowOf) : staticFlow(bundle),
    ask: { context: bundle.runs.length
      ? `The reader is learning how ${entries.join(', ')} works in this repo from recorded runs (snapshot ${bundle.snapshotHash}).`
      : `The reader is learning how this repo's code is structured, from a static index (snapshot ${bundle.snapshotHash}).` },
  };
  const problems = validateSpec(spec);
  if (problems.length) throw new Error(`mind-meld pages: ${problems.join('; ')}`);
  return spec;
}

export const renderPage = (bundle: MeldBundle, options: PageOptions): string =>
  renderMarkdown(bundleToSpec(bundle, options), options.context);
