// Human-owned tasks: top-level tasks come from a human. An agent session may add a task only as a
// child of an existing task (`--parent <id>`) or carrying the human's own request (`--requested
// "<their words>"`). This is a guardrail against agents growing the backlog with their own ideas,
// not authentication: the quote is unauthenticated text, so an agent must only ever quote real words.
// The queue console (queue-console.ts) is the human's own UI, so its add is exempt; agents never drive it.
import type { Parsed } from './queue-cli-args.ts';
import type { Queue, Task } from './queue-model.ts';

/** Environment markers set by agent harnesses (Claude Code, Codex, Gemini) or by scaffold lane launchers. */
export const AGENT_ENV_MARKERS = ['CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_CI', 'GEMINI_CLI', 'AI_AGENT', 'LANE_RUN_ID', 'SCAFFOLD_AGENT'] as const;

export function isAgentSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return AGENT_ENV_MARKERS.some(key => Boolean(env[key]));
}

export type Origin = { ok: true; patch: Partial<Task> } | { ok: false; error: string };

/**
 * Resolve where a new task comes from. Humans need no flags. An agent must name an existing parent
 * task or quote the human's request; either is recorded on the task (a `parent:<id>` or
 * `requested-by:human` tag plus a note) so reviewers can trace every task to its human owner.
 */
export function taskOrigin(q: Queue, f: Parsed, env: NodeJS.ProcessEnv = process.env): Origin {
  const parent = flagValue(f, 'parent');
  const requested = flagValue(f, 'requested');
  if (parent && !q.tasks.some(t => t.id === parent)) return { ok: false, error: `queue add: --parent ${parent} is not a task in this queue` };
  if (!parent && !requested) return isAgentSession(env) ? { ok: false, error: AGENT_ADD_REFUSAL } : { ok: true, patch: {} };
  return { ok: true, patch: originPatch(parent, requested) };
}

const AGENT_ADD_REFUSAL = 'queue add: tasks are human-owned. From an agent session, attach the work to the task it came from '
  + 'with --parent <task-id>, or pass --requested "<the human\'s own words>" when a human asked for it. '
  + 'Review follow-ups and bugs found while working belong to their parent task; ask the human before adding new top-level work.';

/** Tags and note recording where a task came from; both origins are kept when both are given. */
function originPatch(parent: string, requested: string): Partial<Task> {
  const tags = [...(parent ? [`parent:${parent}`] : []), ...(requested ? ['requested-by:human'] : [])];
  const note = [parent && `Child of ${parent}.`, requested && `Requested by a human: "${requested}"`].filter(Boolean).join(' ');
  return { tags, note };
}

function flagValue(f: Parsed, key: string): string {
  return f.flags.get(key)?.trim() ?? '';
}

/** Merge an origin patch with the task's own flags: tags are combined, an explicit --note is kept after the origin note. */
export function withOrigin(overrides: Partial<Task>, origin: Partial<Task>): Partial<Task> {
  if (!origin.tags) return overrides;
  return {
    ...overrides,
    tags: [...origin.tags, ...(overrides.tags ?? []).filter(t => !origin.tags!.includes(t))],
    note: overrides.note ? `${origin.note} ${overrides.note}` : origin.note,
  };
}

/** The environment with every agent marker removed: how tests and human-run tooling call the CLI as a human. */
export function humanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const key of AGENT_ENV_MARKERS) delete out[key];
  return out;
}
