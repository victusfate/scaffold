// c4-model — a neutral description of one software system in C4 terms, and its validator.
// Why: two sources (an explorer spec, the mind-meld repo map) feed three outputs (a Structurizr workspace,
// a C4 picture, mermaid's native C4). Each converter writes this model and each emitter reads it, so the
// rules for identifiers and text live in one place.
// C4's words: a person uses the system; a container is a separately running part of it (not a Docker
// container); a component is a part inside one container; a `system` element here is always a system
// outside the one described.

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
// A numbered story told with relationships the model already has.
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

const PREFIX: Record<C4Kind, string> = { person: 'p', system: 's', container: 'c', component: 'm' };
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Hands out identifiers both Structurizr and mermaid accept (letters, digits, underscore). The kind prefix
// keeps a source id such as `model` or `views` from reading as a keyword; a repeat gets a number.
export function idAllocator(): (kind: C4Kind, raw: string) => string {
  const used = new Set<string>();
  return (kind, raw) => {
    const base = `${PREFIX[kind]}_${raw.replace(/[^A-Za-z0-9_]/g, '_')}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return id;
  };
}

// Text as it may appear between double quotes: neither output documents an escape for a double quote, so
// it becomes a single quote, and a line break becomes a space.
export const plain = (text: string): string => text.replace(/"/g, "'").replace(/\s+/g, ' ').trim();

export const containersOf = (model: C4Model): C4Element[] => model.elements.filter(element => element.kind === 'container');
export const componentsOf = (model: C4Model, container: string): C4Element[] =>
  model.elements.filter(element => element.kind === 'component' && element.parent === container);

function elementProblems(model: C4Model): string[] {
  const seen = new Set<string>([SYSTEM_ID]), containers = new Set(containersOf(model).map(element => element.id));
  return model.elements.flatMap(element => {
    const problems: string[] = [];
    if (!IDENTIFIER.test(element.id)) problems.push(`invalid id "${element.id}"`);
    if (seen.has(element.id)) problems.push(`duplicate id "${element.id}"`);
    seen.add(element.id);
    const placed = element.kind === 'component' ? containers.has(element.parent ?? '') : element.parent === undefined;
    if (!placed) problems.push(element.kind === 'component' ? `"${element.id}" must sit in a container` : `"${element.id}" cannot have a parent`);
    return problems;
  });
}

function relationshipProblems(where: string, relationships: C4Relationship[], known: Set<string>): string[] {
  return relationships.flatMap(({ from, to }) => [
    ...[from, to].filter(id => !known.has(id)).map(id => `${where}: unknown element "${id}"`),
    ...(from === to ? [`${where}: "${from}" relates to itself`] : []),
  ]);
}

function dynamicProblems(model: C4Model, known: Set<string>): string[] {
  const keys = new Set<string>(), related = new Set(model.relationships.map(({ from, to }) => `${from} -> ${to}`));
  return model.dynamics.flatMap(view => {
    const repeated = keys.has(view.key) ? [`duplicate dynamic view "${view.key}"`] : [];
    keys.add(view.key);
    const unrelated = view.steps.map(({ from, to }) => `${from} -> ${to}`).filter(pair => !related.has(pair))
      .map(pair => `dynamic view "${view.key}": no relationship ${pair} in the model`);
    return [...(IDENTIFIER.test(view.key) ? [] : [`invalid dynamic view key "${view.key}"`]), ...repeated,
      ...relationshipProblems(`dynamic view "${view.key}"`, view.steps, known), ...unrelated];
  });
}

// Returns every problem found; an empty list means both emitters can write the model.
export function validateC4(model: C4Model): string[] {
  if (!containersOf(model).length) return ['the described system has no container'];
  const known = new Set(model.elements.map(element => element.id));
  return [...elementProblems(model), ...relationshipProblems('relationships', model.relationships, known), ...dynamicProblems(model, known)];
}
