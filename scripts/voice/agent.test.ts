// Exercise the real mic → transcript → agent → speech entry point with local CLI fixtures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

interface Call { name: string; args: string[]; input: string }

function runLoop(agent: string, failure = '') {
  const dir = mkdtempSync(join(tmpdir(), 'voice-agent-test-'));
  try {
    const fixture = join(dir, 'cli.ts');
    copyFileSync('scripts/voice/fixtures/cli.ts', fixture);
    chmodSync(fixture, 0o755);
    for (const name of ['codex', 'claude', 'rec', 'sox', 'whisper-cli', 'espeak-ng'])
      symlinkSync(fixture, join(dir, name));
    writeFileSync(join(dir, 'model'), 'fixture');
    const result = spawnSync(process.execPath, [resolve('scripts/voice/voice-loop.ts')], {
      encoding: 'utf8', timeout: 15000,
      env: {
        ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`,
        VOICE_TEST_DIR: dir, VOICE_TEST_FAILURE: failure, VOICE_AGENT: agent,
        VOICE_CODEX_BIN: join(dir, 'codex'), VOICE_CLAUDE_BIN: join(dir, 'claude'),
        VOICE_WHISPER_BIN: join(dir, 'whisper-cli'), VOICE_WHISPER_MODEL: join(dir, 'model'),
        VOICE_TTS_BACKEND: 'espeak', VOICE_ESPEAK_BIN: join(dir, 'espeak-ng'), VOICE_METER: '0',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as Call);
    return { calls, spoken: readFileSync(join(dir, 'spoken'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await test('Codex voice invokes exec and resumes the exact returned session', () => {
  const { calls, spoken } = runLoop('codex');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.name, 'codex');
  assert.ok(calls[0]!.args.includes('exec'));
  assert.ok(calls[0]!.args.includes('--json'));
  assert.equal(calls[0]!.input, 'Please inspect $(literal) and `text`');
  assert.ok(calls[1]!.args.includes('resume'));
  assert.ok(calls[1]!.args.includes('codex-session'));
  assert.ok(!calls[1]!.args.includes('--last'));
  assert.match(spoken, /Codex reply/);
  assert.doesNotMatch(spoken, /private reasoning|thread.started/);
});
