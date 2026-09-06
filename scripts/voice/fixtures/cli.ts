#!/usr/bin/env node
// Local subprocess fixture for the voice loop; never calls a model or audio device.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const dir = process.env.VOICE_TEST_DIR!;
const name = basename(process.argv[1]!);
const args = process.argv.slice(2);
if (name === 'whisper-cli') {
  const counter = join(dir, 'utterance');
  const turn = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
  writeFileSync(counter, String(turn + 1));
  console.log(['Please inspect $(literal) and `text`', 'Continue the review', 'goodbye agent'][turn]);
} else if (name === 'codex' || name === 'claude') {
  const input = name === 'codex' ? readFileSync(0, 'utf8') : args[1];
  appendFileSync(join(dir, 'calls'), JSON.stringify({ name, args, input }) + '\n');
  if (process.env.VOICE_TEST_FAILURE === 'exit') {
    console.error('fixture agent failed');
    process.exit(1);
  }
  if (name === 'claude') {
    console.log(JSON.stringify({ result: 'Claude reply', session_id: 'claude-session' }));
  } else if (process.env.VOICE_TEST_FAILURE === 'malformed') {
    console.log('not JSON');
  } else {
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'codex-session' }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'private reasoning' } }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Codex reply' } }));
    console.log(JSON.stringify({ type: 'turn.completed' }));
  }
} else if (name === 'espeak-ng') {
  appendFileSync(join(dir, 'spoken'), args.join(' ') + '\n');
}
