#!/usr/bin/env node
// A tiny real TypeScript stack: combat -> pure damage -> in-memory save.
// Invoked only inside the reference container by mind-meld.ts.
interface Event { id: string; node: string; parent: string | null; durationMs: number; input: string; output: string; changes: { key: string; before: string; after: string }[] }
const events: Event[] = [];
const saved: string[] = [];
function span(node: string, parent: string | null, input: string, work: () => string): string {
  const event: Event = { id: String(events.length), node, parent, durationMs: 0, input, output: '', changes: [] };
  events.push(event);
  const start = performance.now();
  event.output = work();
  event.durationMs = performance.now() - start;
  return event.output;
}
export function damage(hp: number, amount: number, parent: string | null): string {
  return span('damage', parent, JSON.stringify({ hp, amount }), () => {
    const after = String(Math.max(0, hp - amount));
    events.at(-1)!.changes.push({ key: 'hp', before: String(hp), after });
    return after;
  });
}
export function save(hp: string, parent: string): string {
  return span('save', parent, hp, () => {
    saved.push(hp);
    events.at(-1)!.changes.push({ key: 'save.hp', before: '(absent)', after: hp });
    return hp;
  });
}
export function combat(hp: number, amount: number): string {
  return span('combat', null, JSON.stringify({ hp, amount }), () => {
    const parent = events[0].id;
    return save(damage(hp, amount, parent), parent);
  });
}
const [mode, raw] = process.argv.slice(2);
const inputs = JSON.parse(raw ?? '{}') as { hp: number; damage: number };
const output = mode === 'flow' ? combat(inputs.hp, inputs.damage) : damage(inputs.hp, inputs.damage, null);
console.log(JSON.stringify({ output, events }));
