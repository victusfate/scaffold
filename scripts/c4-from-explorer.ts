// c4-from-explorer — read an explorer spec as a C4 model.
// Why: a spec already names a system's parts (nodes), who talks to whom (flow steps) and how the parts
// cluster (lanes). With `spec.c4` naming the system and `node.c4.as` marking what is not a container, that
// is a C4 container model, and each flow is a dynamic view. Nothing is inferred: an element is exactly
// what the spec says it is.

import { idAllocator, validateC4, type C4Element, type C4Kind, type C4Model, type C4Relationship } from './c4-model.ts';
import type { ExplorerNode, ExplorerSpec, FlowStep } from './explorer-spec.ts';

const KIND: Record<string, C4Kind> = { person: 'person', external: 'system' };
const kindOf = (node: ExplorerNode): C4Kind => KIND[node.c4?.as ?? ''] ?? 'container';

function element(id: string, node: ExplorerNode, lane: string | undefined): C4Element {
  const as = node.c4?.as, kind = kindOf(node);
  return {
    id, kind, name: node.name, description: node.role,
    ...(node.c4?.technology ? { technology: node.c4.technology } : {}),
    ...(as === 'database' || as === 'queue' ? { shape: as } : {}),
    // People and other systems sit outside the system, so only its containers are grouped by lane.
    ...(kind === 'container' && lane ? { group: lane } : {}),
  };
}

// The model, or why there is none. `problems` also lists anything the model's own validator finds.
export function explorerToC4(spec: ExplorerSpec): { model?: C4Model; problems: string[] } {
  if (!spec.c4) return { problems: ['the spec has no c4 field'] };
  const allocate = idAllocator(), ids = new Map<string, string>();
  const lanes = new Map(spec.lanes.map(lane => [lane.id, lane.name]));
  const elements = Object.entries(spec.nodes).map(([key, node]) => {
    ids.set(key, allocate(kindOf(node), key));
    return element(ids.get(key)!, node, lanes.get(node.lane));
  });
  // A step from a node to itself is left out: the Structurizr reference does not say one is allowed.
  const relationship = ([from, to, what]: FlowStep): C4Relationship[] =>
    from === to ? [] : [{ from: ids.get(from)!, to: ids.get(to)!, description: what }];
  const dynamics = (spec.flows ?? []).map(flow =>
    ({ key: flow.id.replace(/[^A-Za-z0-9_]/g, '_'), title: flow.name, steps: flow.steps.flatMap(relationship) }));
  const first = new Map<string, C4Relationship>();
  for (const step of dynamics.flatMap(view => view.steps)) if (!first.has(`${step.from} ${step.to}`)) first.set(`${step.from} ${step.to}`, step);
  const model: C4Model = {
    name: spec.title, description: spec.lede,
    system: { name: spec.c4.system, ...(spec.c4.description ? { description: spec.c4.description } : {}) },
    elements, relationships: [...first.values()], dynamics,
  };
  const problems = validateC4(model);
  return problems.length ? { problems } : { model, problems };
}
