// c4-structurizr — write a C4 model as a Structurizr workspace (`.dsl`).
// Why: Structurizr is the tool enterprises use to hold a C4 model, and its input is a text file, so no
// Java and no Structurizr install is needed to produce one. Every construct written here is from the
// language reference (docs.structurizr.com/dsl/language); nothing is rendered.
// The workspace is meant to be extended (`workspace extends <this file>`), not edited: it is regenerated.

import { componentsOf, containersOf, plain, SYSTEM_ID, type C4Element, type C4Model, type C4Relationship, type C4Shape } from './c4-model.ts';

const TAG: Record<C4Shape, string> = { database: 'Database', queue: 'Queue' };
const EXTERNAL = 'External';
// The C4 notation's usual colours, and a shape for each tag used above.
const STYLES = [
  ['Person', 'shape Person', 'background #08427b', 'color #ffffff'],
  ['Software System', 'background #1168bd', 'color #ffffff'],
  ['Container', 'background #438dd5', 'color #ffffff'],
  ['Component', 'background #85bbf0', 'color #000000'],
  [EXTERNAL, 'background #999999', 'color #ffffff'],
  [TAG.database, 'shape Cylinder'],
  [TAG.queue, 'shape Pipe'],
];

const quote = (text = ''): string => `"${plain(text)}"`;
// Arguments are positional, so an empty one in the middle is written as "" and trailing ones are left off.
function positional(values: (string | undefined)[]): string {
  const kept = [...values];
  while (kept.length && !kept.at(-1)) kept.pop();
  return kept.map(quote).join(' ');
}
const nest = (lines: string[]): string[] => lines.map(line => line && `    ${line}`);
const block = (head: string, body: string[]): string[] => body.length ? [`${head} {`, ...nest(body), '}'] : [head];

// Ungrouped elements first, then each group in the order it first appears.
function grouped(elements: C4Element[], render: (element: C4Element) => string[]): string[] {
  const groups = [...new Set(elements.flatMap(element => element.group ?? []))];
  return [...elements.filter(element => !element.group).flatMap(render),
    ...groups.flatMap(name => block(`group ${quote(name)}`, elements.filter(element => element.group === name).flatMap(render)))];
}

const declare = (element: C4Element, keyword: string, values: (string | undefined)[]): string =>
  `${element.id} = ${keyword} ${positional([element.name, ...values])}`;

function component(element: C4Element): string[] {
  const source = element.source ? block('properties', [`"source" ${quote(element.source)}`]) : [];
  return block(declare(element, 'component', [element.description, element.technology]), source);
}

const step = ({ from, to, description }: C4Relationship): string => `${from} -> ${to} ${quote(description)}`;

function modelLines(model: C4Model): string[] {
  const of = (kind: C4Element['kind']): C4Element[] => model.elements.filter(element => element.kind === kind);
  const container = (element: C4Element): string[] =>
    block(declare(element, 'container', [element.description, element.technology, element.shape && TAG[element.shape]]),
      grouped(componentsOf(model, element.id), component));
  return [
    ...of('person').map(element => declare(element, 'person', [element.description])),
    ...of('system').map(element => declare(element, 'softwareSystem', [element.description, EXTERNAL])),
    ...block(`${SYSTEM_ID} = softwareSystem ${positional([model.system.name, model.system.description])}`, grouped(containersOf(model), container)),
    '',
    ...model.relationships.map(step),
  ];
}

const view = (head: string, body: string[] = ['include *']): string[] => block(head, [...body, 'autoLayout lr']);

function viewLines(model: C4Model): string[] {
  const withComponents = containersOf(model).filter(element => componentsOf(model, element.id).length);
  return [
    ...view(`systemContext ${SYSTEM_ID} "context"`),
    ...view(`container ${SYSTEM_ID} "containers"`),
    ...withComponents.flatMap(element => view(`component ${element.id} "components_${element.id}"`)),
    ...model.dynamics.flatMap(dynamic => view(`dynamic ${SYSTEM_ID} "${dynamic.key}" ${quote(dynamic.title)}`, dynamic.steps.map(step))),
    ...block('styles', STYLES.flatMap(([tag, ...rules]) => block(`element "${tag}"`, rules))),
  ];
}

// The whole workspace: the model, then a context view, a container view, a component view for each
// container that has components, and one dynamic view per story.
export function renderStructurizr(model: C4Model): string {
  return [...block(`workspace ${positional([model.name, model.description])}`,
    ['', ...block('model', modelLines(model)), '', ...block('views', viewLines(model))]), ''].join('\n');
}
