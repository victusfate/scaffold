// c4-mermaid — draw a C4 model with mermaid, two ways, and lay both out as a markdown page.
// Why: GitHub renders mermaid, so a C4 view can sit in the repo with no tooling. The picture is a
// flowchart in C4 notation (a system boundary, a typed label on every box) because mermaid lays
// flowcharts out automatically. Mermaid's own C4 syntax is written beside it for tools that read it, but
// its layout is not automatic: on a real system labels overlap and lines cross boxes.
// Components are not drawn: a container view of a repo is readable, a view of every file is not. The
// Structurizr workspace carries them.

import { plain, SYSTEM_ID, type C4Element, type C4Model, type C4Relationship } from './c4-model.ts';

// One view, drawn both ways.
export type C4View = { title: string; picture: string; native: string };

// quality-ok: magic-number — characters per line of a description or arrow label: about the width mermaid wraps SVG text at, so the lines break here and not mid-phrase
const WRAP = 22;
const BREAK = '<br/>';
// Layout for the picture. Text is wrapped here, so mermaid's own wrap is set wider than any line; ranks sit
// far enough apart for an arrow label; and an arrow label has no background box, so it reads as text beside
// its line in light and dark themes alike.
const INIT = `%%{init: {"flowchart": {"wrappingWidth": 400, "nodeSpacing": 45, "rankSpacing": 90}, "themeCSS": ".edgeLabel rect, .edgeLabel .labelBkg { fill: none !important; background: none !important; } .edgeLabel p, .edgeLabel span { background: none !important; }"}}%%`;
// A boundary is an outline, not a filled box, so it stays quiet around what it holds.
const BOUNDARY = 'fill:none,stroke:#8a8f98,stroke-width:1px,stroke-dasharray:6 4';
const GROUP = 'fill:none,stroke:#b4b9c2,stroke-width:1px';
const CLASS_OF = { person: 'person', system: 'external', container: 'container', component: 'container' } as const;
const CLASS_DEF = {
  person: 'fill:#08427b,stroke:#052e56,color:#ffffff',
  external: 'fill:#999999,stroke:#6b6b6b,color:#ffffff',
  container: 'fill:#438dd5,stroke:#2e6295,color:#ffffff',
};
const NATIVE = { database: 'ContainerDb', queue: 'ContainerQueue' };

function wrap(text: string): string {
  const lines: string[] = [];
  for (const word of plain(text).split(' ')) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= WRAP) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.join(BREAK);
}

// A line that takes up height and shows nothing: the braille blank. An empty line collapses, a space is
// trimmed, and mermaid prints a no-break space as the text `&nbsp;` in SVG labels.
const BLANK = '\u2800';

// An arrow's label, lifted above its line: mermaid centres a label on the line, so as many blank lines
// follow the text as the text has, which puts the line just under the words.
function above(texts: string[]): string {
  const lines = texts.flatMap(text => wrap(text).split(BREAK));
  return [...lines, ...lines.map(() => BLANK)].join(BREAK);
}

// The arrows as drawn. Two parts that talk in both directions get one double-headed arrow whose label
// says who does what: drawn as two arrows, mermaid lays one label under a box.
function drawnArrows(arrows: C4Relationship[], nameOf: Map<string, string>): string[] {
  const merged = new Set<C4Relationship>();
  return arrows.flatMap(arrow => {
    if (merged.has(arrow)) return [];
    const back = arrows.find(other => !merged.has(other) && other.from === arrow.to && other.to === arrow.from);
    if (!back) return [`${arrow.from} -->|"${above([arrow.description])}"| ${arrow.to}`];
    merged.add(back);
    const said = (one: C4Relationship): string => one.description.replace(/^(\d+\. )?/, `$1${nameOf.get(one.from)}: `);
    return [`${arrow.from} <-->|"${above([said(arrow), said(back)])}"| ${arrow.to}`];
  });
}

function typeLabel(element: C4Element): string {
  if (element.kind === 'person') return 'Person';
  if (element.kind === 'system') return 'Software system';
  return element.technology ? `Container: ${plain(element.technology)}` : 'Container';
}

function box(element: C4Element): string {
  const label = [plain(element.name), `[${typeLabel(element)}]`, ...(element.description ? [wrap(element.description)] : [])].join(BREAK);
  if (element.kind === 'person') return `${element.id}(["${label}"])`;
  return element.shape ? `${element.id}[("${label}")]` : `${element.id}["${label}"]`;
}

const nest = (lines: string[]): string[] => lines.map(line => `    ${line}`);

// The containers inside the system boundary: ungrouped first, then each group as its own box.
function boundary(model: C4Model, containers: C4Element[], withGroups: boolean): string[] {
  const groups = withGroups ? [...new Set(containers.flatMap(element => element.group ?? []))] : [];
  const loose = containers.filter(element => !groups.includes(element.group ?? ''));
  return [`subgraph ${SYSTEM_ID}["${plain(model.system.name)} [Software system]"]`,
    ...nest([...loose.map(box), ...groups.flatMap((name, i) =>
      [`subgraph g_${i + 1}["${plain(name)}"]`, ...nest(containers.filter(element => element.group === name).map(box)), 'end'])]),
    'end', `style ${SYSTEM_ID} ${BOUNDARY}`, ...groups.map((_, i) => `style g_${i + 1} ${GROUP}`)];
}

type Drawing = { elements: C4Element[]; arrows: C4Relationship[]; withGroups: boolean };

function picture(model: C4Model, { elements, arrows, withGroups }: Drawing): string {
  const outside = elements.filter(element => element.kind !== 'container');
  const classes = Object.keys(CLASS_DEF).flatMap(name => {
    const ids = elements.filter(element => CLASS_OF[element.kind] === name).map(element => element.id);
    return ids.length ? [`classDef ${name} ${CLASS_DEF[name as keyof typeof CLASS_DEF]};`, `class ${ids.join(',')} ${name};`] : [];
  });
  return [INIT, 'flowchart LR', ...nest([
    ...outside.map(box),
    ...boundary(model, elements.filter(element => element.kind === 'container'), withGroups),
    ...drawnArrows(arrows, new Map(elements.map(element => [element.id, plain(element.name)]))),
    ...classes,
  ])].join('\n');
}

function nativeElement(element: C4Element): string {
  const text = (...values: (string | undefined)[]): string => values.map(value => `"${plain(value ?? '')}"`).join(', ');
  if (element.kind === 'person') return `Person(${element.id}, ${text(element.name, element.description)})`;
  if (element.kind === 'system') return `System_Ext(${element.id}, ${text(element.name, element.description)})`;
  return `${element.shape ? NATIVE[element.shape] : 'Container'}(${element.id}, ${text(element.name, element.technology, element.description)})`;
}

function native(model: C4Model, keyword: string, title: string, { elements, arrows }: Drawing): string {
  const outside = elements.filter(element => element.kind !== 'container'), inside = elements.filter(element => element.kind === 'container');
  return [keyword, ...nest([
    `title ${plain(model.name)}: ${title}`,
    ...outside.map(nativeElement),
    `System_Boundary(${SYSTEM_ID}, "${plain(model.system.name)}") {`, ...nest(inside.map(nativeElement)), '}',
    ...arrows.map(({ from, to, description }) => `Rel(${from}, ${to}, "${plain(description)}")`),
  ])].join('\n');
}

// Relationships as a container view shows them: a component stands for its container, and what is left
// inside one container, or repeats a pair already drawn, is dropped.
function betweenContainers(model: C4Model): C4Relationship[] {
  const holder = new Map(model.elements.map(element => [element.id, element.parent ?? element.id]));
  const seen = new Set<string>();
  return model.relationships.flatMap(({ from, to, description }) => {
    const lifted = { from: holder.get(from)!, to: holder.get(to)!, description }, pair = `${lifted.from} ${lifted.to}`;
    if (lifted.from === lifted.to || seen.has(pair)) return [];
    seen.add(pair);
    return [lifted];
  });
}

// The container view, then one view per dynamic view with its steps numbered.
export function c4Views(model: C4Model): C4View[] {
  const drawn = model.elements.filter(element => element.kind !== 'component');
  const containers: Drawing = { elements: drawn, arrows: betweenContainers(model), withGroups: true };
  return [
    { title: 'Containers', picture: picture(model, containers), native: native(model, 'C4Container', 'containers', containers) },
    ...model.dynamics.map(view => {
      const taking = new Set(view.steps.flatMap(({ from, to }) => [from, to]));
      const elements = drawn.filter(element => taking.has(element.id));
      const numbered = view.steps.map((step, i) => ({ ...step, description: `${i + 1}. ${step.description}` }));
      return { title: view.title,
        picture: picture(model, { elements, arrows: numbered, withGroups: false }),
        native: native(model, 'C4Dynamic', view.title, { elements, arrows: view.steps, withGroups: false }) };
    }),
  ];
}

const fenced = (mermaid: string): string[] => ['```mermaid', mermaid, '```', ''];

// A page GitHub renders: each view as a picture, with mermaid's native C4 for the same view folded under
// it. `from` says what the model was read from; `workspace` is the Structurizr file beside the page.
export function renderC4Markdown(model: C4Model, { workspace, from }: { workspace: string; from: string }): string {
  return [
    `# ${plain(model.name)}: C4`, '',
    ...(model.description ? [model.description, ''] : []),
    `Generated from ${from}; edit that, not this page. The same model as a Structurizr workspace: [\`${workspace}\`](${workspace}).`, '',
    ...c4Views(model).flatMap(view => [
      `## ${view.title}`, '', ...fenced(view.picture),
      '<details>', "<summary>Mermaid's native C4 syntax</summary>", '', ...fenced(view.native), '</details>', '',
    ]),
  ].join('\n');
}
