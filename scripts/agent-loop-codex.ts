#!/usr/bin/env node
// Adapt Codex JSONL and structured output to the agent-loop result protocol.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readDirective } from './agent-loop-process.ts';

const MANAGED_OPTIONS = new Set([
  '--json', '--output-schema', '-o', '--output-last-message', '--ephemeral', '--last',
]);
const FAILED_EVENTS = new Set(['turn.failed', 'error']);
const JSON_INDENT = 2;
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
interface CodexEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
}

function invocation(args: string[], schema: string, output: string): string[] {
  if (args.shift() !== '--' || !args[0]) throw new Error('Usage: agent-loop-codex.ts -- CODEX_EXECUTABLE ... exec [resume SESSION] PROMPT');
  const execAt = args.indexOf('exec');
  if (execAt < 1) throw new Error('Codex argv must contain the exec subcommand');
  const conflict = args.find(argument => MANAGED_OPTIONS.has(argument));
  if (conflict) throw new Error(`Codex option ${conflict} is managed by the loop adapter`);
  return [...args.slice(0, execAt + 1), '--json', '--output-schema', schema,
    '-o', output, ...args.slice(execAt + 1)];
}

function parseEvent(line: string, threads: Set<string>): boolean {
  const event = JSON.parse(line) as CodexEvent | null;
  if (!event || typeof event.type !== 'string') throw new Error('Invalid Codex JSONL event');
  if (event.type === 'thread.started') {
    if (typeof event.thread_id !== 'string' || !event.thread_id.trim()) throw new Error('Codex thread.started event has no thread ID');
    threads.add(event.thread_id);
  }
  if (FAILED_EVENTS.has(event.type))
    throw new Error(event.error?.message ?? event.message ?? 'Codex turn failed');
  return event.type === 'turn.completed';
}

async function run(args: string[], resultPath: string): Promise<number> {
  const token = randomUUID();
  const schemaPath = join(dirname(resultPath), `codex-result-schema.${token}.json`);
  const outputPath = join(dirname(resultPath), `codex-result-output.${token}.json`);
  const finalTemp = join(dirname(resultPath), `codex-result-final.${token}.json`);
  writeFileSync(schemaPath, JSON.stringify(DIRECTIVE_SCHEMA), { mode: 0o600, flag: 'wx' });
  try {
    const argv = invocation(args, schemaPath, outputPath);
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true,
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
    writeFileSync(finalTemp, JSON.stringify({ ...directive, resume: [...threads][0] }, null, JSON_INDENT) + '\n',
      { mode: 0o600, flag: 'wx' });
    renameSync(finalTemp, resultPath);
    return 0;
  } finally {
    rmSync(schemaPath, { force: true });
    rmSync(outputPath, { force: true });
    rmSync(finalTemp, { force: true });
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
