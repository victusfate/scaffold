#!/usr/bin/env node
// Human-owned tasks: from an agent session `queue add` / `add-many` need --parent <id> or
// --requested "<human words>" and record that origin; a human at a terminal adds freely.
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseQueue } from './queue-model.ts';
import { AGENT_ENV_MARKERS, humanEnv, isAgentSession } from './queue-task-origin.ts';

const dir = mkdtempSync(join(tmpdir(), 'queue-origin-'));
const file = join(dir, 'queue.md');
const cli = fileURLToPath(new URL('./queue.ts', import.meta.url));
const run = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...env, QUEUE_FILE: file }, encoding: 'utf8',
});
const human = humanEnv();
const agent = { ...human, CLAUDECODE: '1' };
const tasks = () => parseQueue(readFileSync(file, 'utf8')).tasks;
try {
  // Every marker counts as an agent session; none means a human.
  for (const key of AGENT_ENV_MARKERS) assert.ok(isAgentSession({ [key]: '1' }), key);
  assert.ok(!isAgentSession(human));

  // A human adds a top-level task with no origin flags.
  assert.equal(run(human, 'add', 'Climbing in scenes').status, 0);

  // An agent's bare top-level add is refused, and nothing is written.
  const refused = run(agent, 'add', 'Refactor the lock helper');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /human-owned/);
  assert.equal(tasks().length, 1);
  assert.equal(run({ ...human, LANE_RUN_ID: 'lane-x' }, 'add-many', 'a', 'b').status, 2, 'lane workers are agents too');

  // An agent may add a child of an existing task; the parent must exist.
  assert.equal(run(agent, 'add', 'Review follow-up', '--parent', 'task-099').status, 2);
  assert.equal(run(agent, 'add', 'Review follow-up: ledge reach', '--parent', 'task-001', '--tags', 'perf').status, 0);
  const child = tasks()[1];
  assert.deepEqual(child.tags, ['parent:task-001', 'perf']);
  assert.match(child.note ?? '', /^Child of task-001\./);

  // An agent may carry a human's own request.
  assert.equal(run(agent, 'add', 'Destructible walls', '--requested', 'We need those').status, 0);
  assert.deepEqual(tasks()[2].tags, ['requested-by:human']);
  assert.match(tasks()[2].note ?? '', /Requested by a human: "We need those"/);

  // add-many follows the same rule and stamps every new task.
  assert.equal(run(agent, 'add-many', 'one', 'two', '--parent', 'task-001').status, 0);
  assert.deepEqual(tasks().slice(3).map(t => t.tags), [['parent:task-001'], ['parent:task-001']]);
  // Both origins are kept when given together; add-many keeps its own --tags and --note too.
  assert.equal(run(agent, 'add', 'Cryo hall dressing', '--parent', 'task-001', '--requested', 'add them back').status, 0);
  assert.deepEqual(tasks()[5].tags, ['parent:task-001', 'requested-by:human']);
  assert.match(tasks()[5].note ?? '', /Child of task-001\. Requested by a human: "add them back"/);
  assert.equal(run(agent, 'add-many', 'three', '--parent', 'task-001', '--tags', 'audio', '--note', 'from review').status, 0);
  assert.deepEqual(tasks()[6].tags, ['parent:task-001', 'audio']);
  assert.match(tasks()[6].note ?? '', /Child of task-001\. from review/);
  console.log('PASS queue-task-origin: agents add tasks only as children or with a human request; humans add freely');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
