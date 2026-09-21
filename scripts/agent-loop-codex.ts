#!/usr/bin/env node
// Convert Codex structured output to the loop protocol without exposing private state.
// Usage: node scripts/agent-loop-codex.ts CODEX_COMMAND... -- [OPTIONS | resume ID] --prompt PROMPT
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { codexThreadId, parseCodexEvent } from './codex-jsonl.ts';
import { readDirective } from './agent-loop-process.ts';
import { save } from './agent-loop-state.ts';

const MANAGED_OPTIONS = new Set([
  '--json', '--output-schema', '-o', '--output-last-message', '--ephemeral', '--last',
]);
const MANAGED_OPTION_PREFIXES = [
  '--json=', '--output-schema=', '--output-last-message=', '--ephemeral=', '--last=',
];
const NODE_ARGUMENT_OFFSET = 2;
const DIRECTIVE_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['continue', 'complete', 'blocked'] },
    summary: { type: 'string', minLength: 1 },
  },
  required: ['status', 'summary'],
  additionalProperties: false,
};
function invocation(args: string[], schema: string, output: string): string[] {
  const commandEnd = args.indexOf('--');
  const promptAt = args.length - NODE_ARGUMENT_OFFSET;
  if (commandEnd < 1 || promptAt <= commandEnd)
    throw new Error('Usage: agent-loop-codex.ts CODEX_COMMAND... -- [OPTIONS | resume ID] --prompt PROMPT');
  if (args[promptAt] !== '--prompt')
    throw new Error('Usage: agent-loop-codex.ts CODEX_COMMAND... -- [OPTIONS | resume ID] --prompt PROMPT');
  const command = args.slice(0, commandEnd);
  const codexArgs = args.slice(commandEnd + 1, promptAt);
  const conflict = codexArgs.find(argument => MANAGED_OPTIONS.has(argument)
    || MANAGED_OPTION_PREFIXES.some(prefix => argument.startsWith(prefix))
    || (argument.startsWith('-o') && !argument.startsWith('--')));
  if (conflict) throw new Error(`Codex option ${conflict} is managed by the loop adapter`);
  return [...command, 'exec', '--json', '--output-schema', schema,
    '-o', output, ...codexArgs, '--', args[promptAt + 1]!];
}

function parseEvent(line: string, threads: Set<string>): boolean {
  const event = parseCodexEvent(line);
  const thread = codexThreadId(event);
  if (thread) threads.add(thread);
  return event.type === 'turn.completed';
}

async function run(args: string[], resultPath: string): Promise<number> {
  const token = randomUUID();
  const schemaPath = join(dirname(resultPath), `codex-result-schema.${token}.json`);
  const outputPath = join(dirname(resultPath), `codex-result-output.${token}.json`);
  writeFileSync(schemaPath, JSON.stringify(DIRECTIVE_SCHEMA), { mode: 0o600, flag: 'wx' });
  try {
    const argv = invocation(args, schemaPath, outputPath);
    const env = { ...process.env };
    delete env.SCAFFOLD_AGENT_LOOP_RESULT;
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true, env,
    });
    const threads = new Set<string>();
    let buffer = '';
    let completed = false;
    let protocolError: Error | undefined;
    const consume = (line: string) => {
      if (!line.trim() || protocolError) return;
      try { completed = parseEvent(line, threads) || completed; }
      catch (error) { protocolError = error instanceof Error ? error : new Error(String(error)); }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
    });
    const exit = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(signal ? 1 : code ?? 1));
    });
    consume(buffer);
    if (exit !== 0) return exit;
    if (protocolError) throw protocolError;
    if (!completed) throw new Error('Codex JSONL ended without turn.completed');
    if (threads.size !== 1) throw new Error('Codex JSONL must contain exactly one thread ID');
    const directive = readDirective(outputPath);
    if (!directive) throw new Error('Codex produced a missing or invalid loop result');
    save(dirname(resultPath), basename(resultPath), { ...directive, resume: [...threads][0] });
    return 0;
  } finally {
    rmSync(schemaPath, { force: true });
    rmSync(outputPath, { force: true });
  }
}

const resultPath = process.env.SCAFFOLD_AGENT_LOOP_RESULT;
if (!resultPath) {
  console.error(JSON.stringify({ error: 'SCAFFOLD_AGENT_LOOP_RESULT is required' }));
  process.exitCode = 1;
} else {
  run(process.argv.slice(NODE_ARGUMENT_OFFSET), resultPath).then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
