// explorer-spec — the typed source of truth for an explorer page
// (`diagrams/<slug>.explorer.json`) and its validator.
// Why: the explorer page (lanes, traced flows, drill-down inspector, inline
// glossary, timeline, topic pages, context-aware Q&A) is rendered by one generic
// template; every page-specific fact lives in this JSON. Validating references
// here (a flow step naming a missing node, a topic linking a missing topic)
// catches the mistakes a model makes when writing the spec, before render.

export type Bullet = string | { t: string; more: (string | string[])[]; code?: string };
export type DeepSection = { h: string; list?: string[]; table?: { head: string[]; rows: string[][] } };

export type Term = { t: string; a: string[]; d: string };

export type ExplorerNode = {
  lane: string;
  name: string;
  role: string;
  details?: Bullet[];
  risks?: Bullet[];
  deep?: DeepSection[];
  qs?: string[];
};

// One step: [from node, to node, what happens, payload/data carried].
export type FlowStep = [string, string, string, string];
export type Flow = { id: string; name: string; intro?: string; steps: FlowStep[] };

export type TimelineEvent = {
  when: string;          // sortable label: "2016", "2024-Q3", "T+0s", "Sprint 4"
  track: number;         // index into timeline.tracks
  title: string;
  what: string;
  why?: string;
  topics?: string[];     // topic ids
  nodes?: string[];      // node ids
};

export type Topic = {
  id: string;
  group?: string;
  title: string;
  summary: string;
  points?: string[];
  notes?: { label: string; text: string }[];
  nodes?: string[];
};

export type ExplorerSpec = {
  title: string;
  eyebrow?: string;
  lede?: string;
  lanes: { id: string; name: string; sub?: string }[];
  nodes: Record<string, ExplorerNode>;
  flows?: Flow[];
  glossary?: Record<string, Term>;
  timeline?: { intro?: string; tracks: string[]; events: TimelineEvent[] };
  topics?: Topic[];
  // Q&A framing sent with every question, ahead of the selected-node context.
  ask?: { context: string; style?: string };
  start?: { node?: string; flow?: string };
};

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

type Known = { ids: Set<string>; kind: string };
// Every id a reference can point at, built once per validation.
type Refs = { nodes: Known; topics: Known; flows: Known };
const known = (ids: string[], kind: string): Known => ({ ids: new Set(ids), kind });

function checkIds(where: string, ids: string[] | undefined, target: Known, errs: string[]): void {
  for (const id of ids ?? []) if (!target.ids.has(id)) errs.push(`${where}: unknown ${target.kind} "${id}"`);
}

function checkNodes(s: ExplorerSpec, errs: string[]): void {
  const lanes = new Set(s.lanes.map(l => l.id));
  for (const [id, n] of Object.entries(s.nodes)) {
    if (!isStr(n.name) || !isStr(n.role)) errs.push(`nodes.${id}: name and role are required`);
    if (!lanes.has(n.lane)) errs.push(`nodes.${id}: unknown lane "${n.lane}"`);
  }
  for (const l of s.lanes) if (!Object.values(s.nodes).some(n => n.lane === l.id)) errs.push(`lanes.${l.id}: has no nodes`);
}

function checkFlows(s: ExplorerSpec, refs: Refs, errs: string[]): void {
  const seen = new Set<string>();
  for (const f of s.flows ?? []) {
    if (seen.has(f.id)) errs.push(`flows.${f.id}: duplicate id`);
    seen.add(f.id);
    if (!f.steps?.length) errs.push(`flows.${f.id}: needs at least one step`);
    (f.steps ?? []).forEach((st, i) => {
      if (!Array.isArray(st) || st.length !== 4) { errs.push(`flows.${f.id}.steps[${i}]: must be [from, to, what, payload]`); return; }
      checkIds(`flows.${f.id}.steps[${i}]`, [st[0], st[1]], refs.nodes, errs);
    });
  }
}

const termComplete = (g: Term): boolean => isStr(g.t) && isStr(g.d) && Array.isArray(g.a) && g.a.length > 0;

function checkGlossary(s: ExplorerSpec, errs: string[]): void {
  const owner = new Map<string, string>();
  for (const [k, g] of Object.entries(s.glossary ?? {})) {
    if (!termComplete(g)) { errs.push(`glossary.${k}: t, d and a non-empty a[] are required`); continue; }
    for (const a of g.a) {
      const prev = owner.get(a);
      if (prev && prev !== k) errs.push(`glossary.${k}: alias "${a}" already belongs to ${prev}`);
      owner.set(a, k);
    }
  }
}

function checkTopics(s: ExplorerSpec, refs: Refs, errs: string[]): void {
  for (const t of s.topics ?? []) checkIds(`topics.${t.id}`, t.nodes, refs.nodes, errs);
}

function checkTimeline(s: ExplorerSpec, refs: Refs, errs: string[]): void {
  const tl = s.timeline;
  if (!tl) return;
  if (!tl.tracks?.length) errs.push('timeline: needs at least one track');
  tl.events.forEach((e, i) => {
    const at = `timeline.events[${i}]`;
    if (!Number.isInteger(e.track) || e.track < 0 || e.track >= tl.tracks.length) errs.push(`${at}: track ${e.track} out of range`);
    checkIds(at, e.topics, refs.topics, errs);
    checkIds(at, e.nodes, refs.nodes, errs);
  });
}

function checkStart(s: ExplorerSpec, refs: Refs, errs: string[]): void {
  checkIds('start.node', s.start?.node ? [s.start.node] : [], refs.nodes, errs);
  checkIds('start.flow', s.start?.flow ? [s.start.flow] : [], refs.flows, errs);
}

function checkRequired(s: ExplorerSpec): string[] {
  const errs: string[] = [];
  if (!isStr(s.title)) errs.push('title is required');
  if (!s.lanes?.length) errs.push('lanes: at least one lane is required');
  if (!s.nodes || !Object.keys(s.nodes).length) errs.push('nodes: at least one node is required');
  return errs;
}

// Returns every problem found; an empty list means the spec renders cleanly.
export function validateSpec(s: ExplorerSpec): string[] {
  const errs = checkRequired(s);
  if (errs.length) return errs;
  const refs: Refs = {
    nodes: known(Object.keys(s.nodes), 'node'),
    topics: known((s.topics ?? []).map(t => t.id), 'topic'),
    flows: known((s.flows ?? []).map(f => f.id), 'flow'),
  };
  checkNodes(s, errs);
  checkFlows(s, refs, errs);
  checkGlossary(s, errs);
  checkTopics(s, refs, errs);
  checkTimeline(s, refs, errs);
  checkStart(s, refs, errs);
  return errs;
}
