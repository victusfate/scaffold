// c4-from-explorer — read an explorer spec as a C4 model.
// Why: a spec already names a system's parts (nodes), who talks to whom (flow steps) and how the parts
// cluster (lanes). With `spec.c4` naming the system and `node.c4.as` marking what is not a container, that
// is a C4 container model, and each flow is a dynamic view. Nothing is inferred: an element is exactly
// what the spec says it is.

import { firstPerPair, idAllocator, validateC4, type C4Element, type C4Kind, type C4Model, type C4Relationship } from './c4-model.ts';
import { validateSpec, type C4Role, type ExplorerNode, type ExplorerSpec, type FlowStep } from './explorer-spec.ts';

// The roles that are not a container of the system. A database or a queue is a container with a shape.
const KIND_OF_ROLE: Partial<Record<C4Role, C4Kind>> = { person: 'person', external: 'system' };
const kindOf = (node: ExplorerNode): C4Kind => (node.c4?.as && KIND_OF_ROLE[node.c4.as]) ?? 'container';

function element(id: string, node: ExplorerNode, lane: string | undefined): C4Element {
  const role = node.c4?.as, kind = kindOf(node);
  return {
    id, kind, name: node.name, description: node.role,
    ...(node.c4?.technology ? { technology: node.c4.technology } : {}),
    ...(role === 'database' || role === 'queue' ? { shape: role } : {}),
    // People and other systems sit outside the system, so only its containers are grouped by lane.
    ...(kind === 'container' && lane ? { group: lane } : {}),
  };
}

// The model, or why there is none: the spec's own problems first, then anything the model's validator finds.
export function explorerToC4(spec: ExplorerSpec): { model?: C4Model; problems: string[] } {
  if (!spec.c4) return { problems: ['the spec has no c4 field'] };
  const invalid = validateSpec(spec);
  if (invalid.length) return { problems: invalid };
  const allocate = idAllocator(), ids = new Map<string, string>();
  const lanes = new Map(spec.lanes.map(lane => [lane.id, lane.name]));
  const elements = Object.entries(spec.nodes).map(([key, node]) => {
    const id = allocate(kindOf(node), key);
    ids.set(key, id);
    return element(id, node, lanes.get(node.lane));
  });
  // A step from a node to itself is left out: the Structurizr reference does not say one is allowed. A
  // flow left with no steps has nothing to show, so it is not a view.
  const relationship = ([from, to, what]: FlowStep): C4Relationship[] =>
    from === to ? [] : [{ from: ids.get(from)!, to: ids.get(to)!, description: what }];
  const dynamics = (spec.flows ?? []).map(flow => ({ key: allocate('view', flow.id), title: flow.name, steps: flow.steps.flatMap(relationship) }))
    .filter(view => view.steps.length);
  const model: C4Model = {
    // The spec's lede describes its page, so the workspace takes the system's own description.
    name: spec.title, description: spec.c4.description,
    system: { name: spec.c4.system, description: spec.c4.description },
    elements, relationships: firstPerPair(dynamics.flatMap(view => view.steps)), dynamics,
  };
  const problems = validateC4(model);
  return problems.length ? { problems } : { model, problems };
}
