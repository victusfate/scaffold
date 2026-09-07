import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cli = new URL('./agent-loop.ts', import.meta.url).pathname;
test('public CLI rejects malformed intervals before scheduling', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-test-'));
  const result = spawnSync(process.execPath, [cli, 'start', '--cwd', cwd,
    '--interval', 'forever', '--', 'true'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid duration/);
});
