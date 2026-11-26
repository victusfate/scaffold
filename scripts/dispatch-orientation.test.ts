import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, bashWrites, summarise } from './dispatch-orientation.ts';

const t = (s: number) => new Date(Date.UTC(2026, 10, 26, 12, 0, s)).toISOString();
const tool = (s: number, name: string, input: Record<string, unknown>) =>
  ({ type: 'assistant', timestamp: t(s), message: { content: [{ type: 'tool_use', name, input }] } });

void test('bash writes: in-place edits, commits, python writes and repo redirects count; reads, temp logs and setup do not', () => {
  for (const c of ["sed -i 's/a/b/' x.ts", 'git -c core.hooksPath=/dev/null commit -qm x', "python3 - <<'EOF'\nopen(p,'w').write(t)\nEOF",
    'cat > scripts/new.sh <<EOF', 'echo x >> docs/log.md', 'git cherry-pick abc']) assert.ok(bashWrites(c), c);
  for (const c of ['grep -rn foo scripts', 'sed -n 1,40p x.ts', 'make ci > /tmp/ci.log 2>&1', 'git fetch origin && git merge origin/main',
    'cmd 2>&1 | tail', 'x > /dev/null', 'run > ~/scratch/evidence/a.log', 'echo $((a > b))',
    "python3 - <<'EOF'\nif a > b: print(1)\nEOF"]) assert.ok(!bashWrites(c), c);
});

void test('counts tool calls and seconds from the first prompt to the first edit', () => {
  const r = analyse('a', [
    { type: 'user', timestamp: t(0), message: { content: 'Do the task.' } },
    tool(5, 'Bash', { command: 'git fetch origin && git merge origin/main' }),
    tool(9, 'Read', { file_path: '/x' }),
    tool(14, 'Bash', { command: 'grep -rn foo .' }),
    tool(30, 'Edit', { file_path: '/x' }),
    tool(40, 'Bash', { command: 'make test' }),
  ], '', () => '');
  assert.equal(r.toolsBeforeEdit, 3);
  assert.equal(r.secondsToFirstEdit, 30);
  assert.equal(r.totalTools, 5);
  assert.equal(r.startHere, false);
});

void test('detects a Start here block in the prompt or in a brief file it points at', () => {
  const inline = analyse('b', [{ type: 'user', timestamp: t(0), message: { content: '## Start here\n- scripts/x.ts: fn()' } }], '', () => '');
  assert.equal(inline.startHere, true);
  const viaFile = analyse('c', [{ type: 'user', timestamp: t(0), message: { content: 'Your brief is the file /b/brief.md' } }], '',
    () => '**Start here**\n- a.ts');
  assert.equal(viaFile.startHere, true);
});

void test('an agent that never edits has no orientation figure and is left out of the medians', () => {
  const rows = [
    analyse('d', [{ type: 'user', timestamp: t(0), message: { content: 'x' } }, tool(3, 'Read', {})], '', () => ''),
    analyse('e', [{ type: 'user', timestamp: t(0), message: { content: 'x' } }, tool(3, 'Read', {}), tool(8, 'Write', {})], '', () => ''),
  ];
  assert.equal(rows[0].toolsBeforeEdit, null);
  const s = summarise(rows);
  assert.deepEqual(s.cold, { agents: 2, edited: 1, medianToolsBeforeEdit: 1, medianSecondsToFirstEdit: 8 });
});
