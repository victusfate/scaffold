import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('Codex export installs a discoverable skill and records its harness', () => {
  const dest = mkdtempSync(join(tmpdir(), 'codex-hoist-'));
  try {
    const result = spawnSync(process.execPath, [
      'tools/hoist-skill/run', '--names', 'tdd', '--harness', 'codex', '--into', dest,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const wrapper = readFileSync(join(dest, '.agents/skills/tdd/SKILL.md'), 'utf8');
    assert.match(wrapper, /^---\nname: tdd\ndescription:/);
    assert.match(wrapper, /\.\.\/\.\.\/\.\.\/skills\/tdd\.md/);
    assert.equal(readFileSync(join(dest, 'skills/tdd.md'), 'utf8'),
      readFileSync('skills/tdd.md', 'utf8'));
    assert.match(readFileSync(join(dest, '.sync/hoisted'), 'utf8'), /tdd\tcodex\tmain/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});
