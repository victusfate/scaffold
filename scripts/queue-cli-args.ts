// CLI argument grammar and task-field coercion; independent of queue I/O.
import { EDITABLE_TASK_FIELDS, fieldPatch, type Task } from './queue-model.ts';

export interface Parsed { positionals: string[]; flags: Map<string, string>; bools: Set<string>; }

const VALUE_FLAGS = new Set([
  ...EDITABLE_TASK_FIELDS, 'worker', 'until', 'minutes', 'only',
  'step', 'model', 'tail', 'state',
]);

export function parse(rest: string[]): Parsed {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (VALUE_FLAGS.has(key)) flags.set(key, rest[++i] ?? '');
      else bools.add(key);
    } else positionals.push(arg);
  }
  return { positionals, flags, bools };
}

export { EDITABLE_TASK_FIELDS as SPEC_FLAGS } from './queue-model.ts';

export function taskOverrides(flags: Parsed): Partial<Task> {
  const overrides: Partial<Task> = {};
  for (const key of EDITABLE_TASK_FIELDS) {
    if (flags.flags.has(key)) Object.assign(overrides, fieldPatch(key, flags.flags.get(key) ?? ''));
  }
  return overrides;
}
