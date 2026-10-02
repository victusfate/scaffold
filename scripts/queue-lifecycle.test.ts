#!/usr/bin/env node
// Real CLI transitions must close display metadata without reclaiming live jobs.
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'queue-lifecycle-'));
const file = join(dir, 'queue.md');
const cli = fileURLToPath(new URL('./queue.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, QUEUE_FILE: file }, encoding: 'utf8', timeout: 10_000,
});
const ok = (...args: string[]) => {
  const result = run(...args);
  assert.equal(result.status, 0, result.stderr);
};
const present = (id: string) => {
  assert.ok(existsSync(join(dir, 'lanes', `${id}.json`)), id);
  assert.ok(existsSync(join(dir, 'lanes', `${id}.stop`)), id);
};
const cleared = (id: string) => {
  assert.ok(!existsSync(join(dir, 'lanes', `${id}.json`)), id);
  assert.ok(!existsSync(join(dir, 'lanes', `${id}.stop`)), id);
};
let serial = 0;
function claim(validate?: string): string {
  const id = `task-${String(++serial).padStart(3, '0')}`;
  ok('add', id, ...(validate ? ['--validate', validate] : []));
  ok('claim', id, '--worker', 'owned');
  ok('lane', 'beat', id, '--worker', 'owned', '--state', 'running');
  ok('lane', 'stop', id);
  return id;
}
try {
  ok('config', 'deliveryMode', 'batch'); // This suite exercises independent legacy lanes.
  const neighbor = claim();
  const released = claim();
  assert.notEqual(run('release', released, '--worker', 'other').status, 0);
  present(released);
  assert.notEqual(run('lane', 'finish', released, '--worker', 'other').status, 0);
  ok('lane', 'finish', released, '--worker', 'owned', '--tail', 'partial report');
  const finished: unknown = JSON.parse(readFileSync(join(dir, 'lanes', `${released}.json`), 'utf8'));
  assert.ok(finished && typeof finished === 'object' && 'state' in finished);
  assert.equal(finished.state, 'awaiting-review');
  assert.match(run('show', released).stdout, /\[active\]/);
  present(released); // A result notification neither accepts scope nor reclaims a job.
  ok('requeue', released); // Active requeue is deliberately a no-op.
  ok('set', released, 'note', 'still working');
  present(released);
  ok('release', released, '--worker', 'owned');
  cleared(released);
  assert.notEqual(run('lane', 'finish', released, '--worker', 'owned').status, 0);
  present(neighbor);

  for (const verb of ['done', 'fail', 'remove']) {
    const id = claim();
    ok(verb, id);
    cleared(id);
    present(neighbor);
  }
  const terminal = claim();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      ok('lane', 'beat', terminal, '--worker', 'owned');
      ok('lane', 'stop', terminal);
    }
    ok('fail', terminal);
    cleared(terminal);
  }
  ok('lane', 'beat', terminal, '--worker', 'owned');
  ok('lane', 'stop', terminal);
  ok('requeue', terminal);
  cleared(terminal);
  const stopOnly = claim();
  rmSync(join(dir, 'lanes', `${stopOnly}.json`));
  ok('release', stopOnly, '--worker', 'owned');
  cleared(stopOnly);
  const imported = claim();
  writeFileSync(file, readFileSync(file, 'utf8').replace(`- [>] ${imported} —`, `- [x] ${imported} —`));
  assert.notEqual(run('import').status, 0);
  present(imported);
  ok('import', '--force');
  cleared(imported);
  present(neighbor);
  const removed = claim();
  writeFileSync(file, readFileSync(file, 'utf8').replace(
    new RegExp(`^- \\[>\\] ${removed}.*\\n(?:  - .*\\n)*`, 'm'), '',
  ));
  assert.notEqual(run('import').status, 0);
  present(removed);
  ok('import', '--force');
  cleared(removed);
  present(neighbor);
  const failedValidation = claim(`${process.execPath} -e 'process.exit(1)'`);
  assert.notEqual(run('done', failedValidation).status, 0);
  cleared(failedValidation); // Failed validation ends the owned attempt.

  const rollback = claim();
  const before = readFileSync(join(dir, 'lanes', `${rollback}.json`), 'utf8');
  appendFileSync(file, '\nUnimported operator edit\n');
  assert.notEqual(run('release', rollback, '--worker', 'owned').status, 0);
  present(rollback);
  assert.equal(readFileSync(join(dir, 'lanes', `${rollback}.json`), 'utf8'), before);
  present(neighbor);
  console.log('queue-lifecycle: terminal cleanup, ownership refusal, active preservation and rollback PASS');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
