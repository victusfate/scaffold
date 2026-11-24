// c4-model — a neutral description of one software system in C4 terms, and its validator.
// Why: two sources (an explorer spec, the mind-meld repo map) feed three outputs (a Structurizr workspace,
// a C4 picture, mermaid's native C4). Each converter writes this model and each emitter reads it, so the
// rules for identifiers and text, and the helpers both emitters need, live in one place.
// C4's words: a person uses the system; a container is a separately running part of it (not a Docker
// container); a component is a part inside one container; a `system` element here is always a system
// outside the one described.

import { identifier, uniqueId } from './identifier.ts';

export type C4Kind = 'person' | 'system' | 'container' | 'component';
export type C4Shape = 'database' | 'queue';

export type C4Element = {
  id: string;
  kind: C4Kind;
  name: string;
  description?: string;
  technology?: string;
  shape?: C4Shape;
  // A named cluster among its siblings; it carries no meaning beyond the name.
  group?: string;
  // The container a component sits in.
  parent?: string;
  // Repo-relative file the element was read from.
  source?: string;
};
export type C4Relationship = { from: string; to: string; description: string };
// A numbered story told with relationships the model already has, between people, systems and containers.
export type C4Dynamic = { key: string; title: string; steps: C4Relationship[] };

export type C4Model = {
  name: string;
  description?: string;
  // The system being described; containers belong to it.
  system: { name: string; description?: string };
  elements: C4Element[];
  relationships: C4Relationship[];
  dynamics: C4Dynamic[];
};

// The described system's identifier in every output.
export const SYSTEM_ID = 'sys';
// The C4 notation's usual colours, shared by both emitters.
export const C4_COLOURS = { person: '#08427b', system: '#1168bd', container: '#438dd5', component: '#85bbf0', external: '#999999' };

const ID_PREFIX = { person: 'p', system: 's', container: 'c', component: 'm', view: 'v' };
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
// View keys the Structurizr emitter writes itself; a dynamic view may not take one.
const RESERVED_VIEW = /^(context|containers|components_.*)$/;

// Hands out identifiers both Structurizr and mermaid accept (letters, digits, underscore). The prefix keeps
// a source id such as `model` or `views` from reading as a keyword, and a view key from matching one the
// emitter writes; a repeat gets a number.
export function idAllocator(): (kind: keyof typeof ID_PREFIX, raw: string) => string {
  const used = new Set<string>();
  return (kind, raw) => uniqueId(`${ID_PREFIX[kind]}_${identifier(raw)}`, used);
}

// Text as it may appear between double quotes. Structurizr and mermaid escape a double quote differently,
// so one rule serves both: it becomes a single quote, and a line break becomes a space.
export const plain = (text: string): string => text.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
export const nest = (lines: string[]): string[] => lines.map(line => line && `    ${line}`);

export const containersOf = (model: C4Model): C4Element[] => model.elements.filter(element => element.kind === 'container');
export const componentsOf = (model: C4Model, container: string): C4Element[] =>
  model.elements.filter(element => element.kind === 'component' && element.parent === container);

// Siblings split for drawing: the ungrouped ones, then each group in the order it first appears.
export function byGroup<T extends C4Element>(elements: T[]): { loose: T[]; groups: [string, T[]][] } {
  const names = [...new Set(elements.flatMap(element => element.group ?? []))];
  return { loose: elements.filter(element => !element.group), groups: names.map(name => [name, elements.filter(element => element.group === name)]) };
}

const pairKey = ({ from, to }: C4Relationship): string => `${from} -> ${to}`;
// One relationship per ordered pair: the first one given.
export function firstPerPair(relationships: C4Relationship[]): C4Relationship[] {
  const first = new Map<string, C4Relationship>();
  for (const relationship of relationships) if (!first.has(pairKey(relationship))) first.set(pairKey(relationship), relationship);
  return [...first.values()];
}

function idProblems(model: C4Model): string[] {
  const seen = new Set<string>([SYSTEM_ID]);
  return model.elements.flatMap(({ id, name }) => {
    const repeated = seen.has(id.toLowerCase());
    seen.add(id.toLowerCase());
    return [
      ...(IDENTIFIER.test(id) ? [] : [`invalid id "${id}"`]),
      ...(repeated ? [`duplicate id "${id}"`] : []),
      ...(plain(name) ? [] : [`"${id}" has no name`]),
    ];
  });
}

// Structurizr wants a name to be unique among its siblings: containers in the system, components in a
// container, and people and systems (the described one included) at the top.
function nameProblems(model: C4Model): string[] {
  const seen = new Set<string>([`top ${plain(model.system.name)}`]);
  return model.elements.flatMap(element => {
    const place = element.kind === 'component' ? element.parent : element.kind === 'container' ? SYSTEM_ID : 'top';
    const key = `${place} ${plain(element.name)}`, repeated = seen.has(key);
    seen.add(key);
    return repeated ? [`two elements named "${element.name}" in the same place`] : [];
  });
}

function placeProblems(model: C4Model): string[] {
  const containers = new Set(containersOf(model).map(element => element.id));
  const system = [...(plain(model.system.name) ? [] : ['the described system has no name']), ...(containers.size ? [] : ['the described system has no container'])];
  return [...system, ...model.elements.flatMap(element => {
    const placed = element.kind === 'component' ? containers.has(element.parent ?? '') : element.parent === undefined;
    if (placed) return [];
    return [element.kind === 'component' ? `"${element.id}" must sit in a container` : `"${element.id}" cannot have a parent`];
  })];
}

function endpointProblems(where: string, relationships: C4Relationship[], known: Map<string, C4Element>): string[] {
  return relationships.flatMap(({ from, to }) => [
    ...[from, to].filter(id => !known.has(id)).map(id => `${where}: unknown element "${id}"`),
    ...(from === to ? [`${where}: "${from}" relates to itself`] : []),
  ]);
}

function relationshipProblems(model: C4Model, known: Map<string, C4Element>): string[] {
  const seen = new Set<string>();
  return [...endpointProblems('relationships', model.relationships, known), ...model.relationships.flatMap(relationship => {
    const { from, to, description } = relationship, key = `${pairKey(relationship)} ${description}`, repeated = seen.has(key);
    seen.add(key);
    const withinFamily = known.get(from)?.parent === to || known.get(to)?.parent === from;
    return [...(repeated ? [`relationship given twice: ${pairKey(relationship)} "${description}"`] : []),
      ...(withinFamily ? [`${pairKey(relationship)}: a container and its own component cannot be related`] : [])];
  })];
}

function dynamicProblems(model: C4Model, known: Map<string, C4Element>): string[] {
  const keys = new Set<string>(), related = new Set(model.relationships.map(pairKey));
  return model.dynamics.flatMap(({ key, steps }) => {
    const where = `dynamic view "${key}"`, repeated = keys.has(key.toLowerCase());
    keys.add(key.toLowerCase());
    const components = [...new Set(steps.flatMap(({ from, to }) => [from, to]))].filter(id => known.get(id)?.kind === 'component');
    return [
      ...(IDENTIFIER.test(key) && !RESERVED_VIEW.test(key) ? [] : [`invalid dynamic view key "${key}"`]),
      ...(repeated ? [`duplicate ${where}`] : []),
      ...(steps.length ? [] : [`${where} has no steps`]),
      ...endpointProblems(where, steps, known),
      ...components.map(id => `${where}: "${id}" is a component; steps run between people, systems and containers`),
      ...steps.map(pairKey).filter(pair => !related.has(pair)).map(pair => `${where}: no relationship ${pair} in the model`),
    ];
  });
}

// Returns every problem found; an empty list means both emitters can write the model.
export function validateC4(model: C4Model): string[] {
  const known = new Map(model.elements.map(element => [element.id, element]));
  return [...placeProblems(model), ...idProblems(model), ...nameProblems(model), ...relationshipProblems(model, known), ...dynamicProblems(model, known)];
}
