// c4-mermaid — draw a C4 model with mermaid, two ways, and lay both out as a markdown page.
// Why: GitHub renders mermaid, so a C4 view can sit in the repo with no tooling. The picture is a
// flowchart in C4 notation (a system boundary, a typed label on every box) because mermaid lays
// flowcharts out automatically. Mermaid's own C4 syntax ("native C4") is written beside it for tools that
// read it, but its layout is not automatic: on a real system labels overlap and lines cross boxes.
// Components are not drawn: a container view of a repo is readable, a view of every file is not. The
// Structurizr workspace carries them. The model must have passed validateC4.

import { byGroup, C4_COLOURS, firstPerPair, nest, plain, SYSTEM_ID, type C4Element, type C4Kind, type C4Model, type C4Relationship, type C4Shape } from './c4-model.ts';

// One view, drawn both ways.
export type C4View = { title: string; picture: string; native: string };

type DrawnKind = Exclude<C4Kind, 'component'>;
type Drawn = C4Element & { kind: DrawnKind };
// An arrow as drawn; `order` is its step number in a dynamic view.
type Arrow = C4Relationship & { order?: number };
// What one view shows: the people and outside systems, the containers inside the boundary, and the arrows.
type Drawing = { outside: Drawn[]; containers: Drawn[]; arrows: Arrow[] };

// quality-ok: magic-number — characters per line of a description or arrow label: about the width mermaid wraps SVG text at, so the lines break here and not mid-phrase
const WRAP = 22;
const BREAK = '<br/>';
// A line that takes up height and shows nothing: the braille blank. An empty line collapses, a space is
// trimmed, and mermaid prints a no-break space as the text `&nbsp;` in SVG labels.
const BLANK = '⠀';
// Layout for the picture. Text is wrapped here, so mermaid's own wrap is set wider than any line; ranks sit
// far enough apart for an arrow label; and an arrow label has no background box, so it reads as text beside
// its line in light and dark themes alike.
const INIT = `%%{init: {"flowchart": {"wrappingWidth": 400, "nodeSpacing": 45, "rankSpacing": 90}, "themeCSS": ".edgeLabel rect, .edgeLabel .labelBkg { fill: none !important; background: none !important; } .edgeLabel p, .edgeLabel span { background: none !important; }"}}%%`;
// A boundary is an outline, not a filled box, so it stays quiet around what it holds.
const BOUNDARY = 'fill:none,stroke:#8a8f98,stroke-width:1px,stroke-dasharray:6 4';
const GROUP = 'fill:none,stroke:#b4b9c2,stroke-width:1px';
const CLASS_OF: Record<DrawnKind, keyof typeof CLASS_DEF> = { person: 'person', system: 'external', container: 'container' };
const CLASS_DEF = {
  person: `fill:${C4_COLOURS.person},stroke:#052e56,color:#ffffff`,
  external: `fill:${C4_COLOURS.external},stroke:#6b6b6b,color:#ffffff`,
  container: `fill:${C4_COLOURS.container},stroke:#2e6295,color:#ffffff`,
};
const NATIVE_CONTAINER: Record<C4Shape, string> = { database: 'ContainerDb', queue: 'ContainerQueue' };

// Text inside a quoted flowchart label. GitHub draws labels as HTML and would swallow `<slug>` as a tag,
// and mermaid reads `#name;` as an entity; its entity codes are no way out, because its SVG labels print
// them as typed. So angle brackets become ‹ ›, a `#` that would start an entity is set apart, and a
// backtick, which opens a markdown label, becomes a single quote.
const labelText = (text: string): string => plain(text).replace(/</g, '‹').replace(/>/g, '›').replace(/#(?=\w+;)/g, '# ').replace(/`/g, "'");

function wrap(text: string): string[] {
  const lines: string[] = [];
  for (const word of labelText(text).split(' ')) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= WRAP) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

// An arrow's label, lifted above its line: mermaid centres a label on the line, so as many blank lines
// follow the text as the text has, which puts the line just under the words.
function liftedLabel(texts: string[]): string {
  const lines = texts.flatMap(wrap);
  return [...lines, ...lines.map(() => BLANK)].join(BREAK);
}

// The arrows as mermaid statements. Two parts that talk in both directions get one double-headed arrow
// whose label says who does what: drawn as two arrows, mermaid lays one label under a box. Each arrow is
// drawn once, so a third message between the same two keeps an arrow of its own.
function arrowLines(arrows: Arrow[], nameOf: Map<string, string>): string[] {
  const drawn = new Set<Arrow>();
  const numbered = (arrow: Arrow, who = ''): string => `${arrow.order ? `${arrow.order}. ` : ''}${who}${arrow.description}`;
  const attributed = (arrow: Arrow): string => numbered(arrow, `${nameOf.get(arrow.from)}: `);
  return arrows.flatMap(arrow => {
    if (drawn.has(arrow)) return [];
    drawn.add(arrow);
    const back = arrows.find(other => !drawn.has(other) && other.from === arrow.to && other.to === arrow.from);
    if (!back) return [`${arrow.from} -->|"${liftedLabel([numbered(arrow)])}"| ${arrow.to}`];
    drawn.add(back);
    return [`${arrow.from} <-->|"${liftedLabel([attributed(arrow), attributed(back)])}"| ${arrow.to}`];
  });
}

function typeLabel(element: Drawn): string {
  if (element.kind === 'person') return 'Person';
  if (element.kind === 'system') return 'Software system';
  return element.technology ? `Container: ${labelText(element.technology)}` : 'Container';
}

function box(element: Drawn): string {
  const label = [labelText(element.name), `[${typeLabel(element)}]`, ...(element.description ? wrap(element.description) : [])].join(BREAK);
  if (element.kind === 'person') return `${element.id}(["${label}"])`;
  return element.shape ? `${element.id}[("${label}")]` : `${element.id}["${label}"]`;
}

// The containers inside the system boundary, each group as its own box. A view with no container taking
// part has no boundary.
function boundary(model: C4Model, containers: Drawn[], withGroups: boolean): string[] {
  if (!containers.length) return [];
  const { loose, groups } = withGroups ? byGroup(containers) : { loose: containers, groups: [] };
  return [`subgraph ${SYSTEM_ID}["${labelText(model.system.name)} [Software system]"]`,
    ...nest([...loose.map(box), ...groups.flatMap(([name, members], i) =>
      [`subgraph g_${i + 1}["${labelText(name)}"]`, ...nest(members.map(box)), 'end'])]),
    'end', `style ${SYSTEM_ID} ${BOUNDARY}`, ...groups.map((_, i) => `style g_${i + 1} ${GROUP}`)];
}

function picture(model: C4Model, { outside, containers, arrows }: Drawing, withGroups: boolean): string {
  const elements = [...outside, ...containers];
  const classes = Object.entries(CLASS_DEF).flatMap(([name, style]) => {
    const ids = elements.filter(element => CLASS_OF[element.kind] === name).map(element => element.id);
    return ids.length ? [`classDef ${name} ${style};`, `class ${ids.join(',')} ${name};`] : [];
  });
  return [INIT, 'flowchart LR', ...nest([
    ...outside.map(box),
    ...boundary(model, containers, withGroups),
    ...arrowLines(arrows, new Map(elements.map(element => [element.id, element.name]))),
    ...classes,
  ])].join('\n');
}

function nativeElement(element: Drawn): string {
  const text = (...values: (string | undefined)[]): string => values.map(value => `"${plain(value ?? '')}"`).join(', ');
  if (element.kind === 'person') return `Person(${element.id}, ${text(element.name, element.description)})`;
  if (element.kind === 'system') return `System_Ext(${element.id}, ${text(element.name, element.description)})`;
  return `${element.shape ? NATIVE_CONTAINER[element.shape] : 'Container'}(${element.id}, ${text(element.name, element.technology, element.description)})`;
}

function native(model: C4Model, keyword: string, title: string, { outside, containers, arrows }: Drawing): string {
  const inside = containers.length ? [`System_Boundary(${SYSTEM_ID}, "${plain(model.system.name)}") {`, ...nest(containers.map(nativeElement)), '}'] : [];
  return [keyword, ...nest([
    `title ${plain(model.name)}: ${plain(title)}`,
    ...outside.map(nativeElement),
    ...inside,
    ...arrows.map(({ from, to, description }) => `Rel(${from}, ${to}, "${plain(description)}")`),
  ])].join('\n');
}

// Relationships as a container view shows them: a component stands for its container, and what is left
// inside one container, or repeats a pair already drawn, is dropped.
function betweenContainers(model: C4Model): C4Relationship[] {
  const holder = new Map(model.elements.map(element => [element.id, element.parent ?? element.id]));
  const lifted = model.relationships.map(({ from, to, description }) => ({ from: holder.get(from) ?? from, to: holder.get(to) ?? to, description }));
  return firstPerPair(lifted.filter(({ from, to }) => from !== to));
}

// The container view, then one view per dynamic view with its steps numbered.
export function c4Views(model: C4Model): C4View[] {
  const drawn = model.elements.filter((element): element is Drawn => element.kind !== 'component');
  const drawing = (elements: Drawn[], arrows: Arrow[]): Drawing =>
    ({ outside: elements.filter(element => element.kind !== 'container'), containers: elements.filter(element => element.kind === 'container'), arrows });
  const all = drawing(drawn, betweenContainers(model));
  return [
    { title: 'Containers', picture: picture(model, all, true), native: native(model, 'C4Container', 'containers', all) },
    ...model.dynamics.map(view => {
      const taking = new Set(view.steps.flatMap(({ from, to }) => [from, to]));
      const story = drawing(drawn.filter(element => taking.has(element.id)), view.steps.map((step, i) => ({ ...step, order: i + 1 })));
      return { title: view.title, picture: picture(model, story, false), native: native(model, 'C4Dynamic', view.title, story) };
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
      `## ${plain(view.title)}`, '', ...fenced(view.picture),
      '<details>', "<summary>Mermaid's native C4 syntax</summary>", '', ...fenced(view.native), '</details>', '',
    ]),
  ].join('\n');
}
