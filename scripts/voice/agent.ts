// Voice-loop agent subprocess protocol. Called by voice-loop.ts; no audio or global writes.
import { spawnSync } from 'node:child_process';

interface AgentConfig {
  name: 'claude' | 'codex';
  binary: string;
  allowedTools: string;
}

interface Reply { reply: string; sessionId: string | null }
interface CodexEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  item?: { type?: string; text?: string };
}

export function agentConfig(env = process.env): AgentConfig {
  const name = env.VOICE_AGENT ?? 'claude';
  if (name !== 'claude' && name !== 'codex')
    throw new Error(`Unsupported VOICE_AGENT: ${name}; choose claude or codex`);
  return {
    name,
    binary: name === 'codex' ? (env.VOICE_CODEX_BIN ?? 'codex') : (env.VOICE_CLAUDE_BIN ?? 'claude'),
    allowedTools: env.VOICE_ALLOWED_TOOLS ?? 'Read,Edit,Write,Bash,Glob,Grep',
  };
}

function codexReply(stdout: string, sessionId: string | null): Reply {
  let reply = '';
  let completed = false;
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    const event = JSON.parse(line) as CodexEvent | null;
    if (!event || typeof event.type !== 'string') throw new Error('Invalid Codex event');
    if (event.type === 'thread.started' && typeof event.thread_id === 'string')
      sessionId = event.thread_id;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message'
      && typeof event.item.text === 'string') reply = event.item.text.trim();
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'turn.failed' || event.type === 'error')
      throw new Error(event.error?.message ?? event.message ?? 'Codex turn failed');
  }
  if (!completed || !reply || !sessionId) throw new Error('Incomplete Codex reply or missing session ID');
  return { reply, sessionId };
}

function claudeReply(stdout: string, sessionId: string | null): Reply {
  try {
    const result = JSON.parse(stdout) as { result?: string; session_id?: string };
    return { reply: (result.result ?? '').trim(), sessionId: result.session_id ?? sessionId };
  } catch {
    // Retain Claude's existing plain-text fallback.
    return { reply: stdout.trim(), sessionId };
  }
}

/** Run one utterance; keep the prior session on any subprocess or protocol failure. */
export function askAgent(config: AgentConfig, text: string, sessionId: string | null): Reply {
  const args = config.name === 'codex'
    ? ['exec', '--sandbox', 'workspace-write', ...(sessionId ? ['resume', sessionId] : []), '--json', '-']
    : ['-p', text, '--output-format', 'json', '--allowedTools', config.allowedTools,
      ...(sessionId ? ['--resume', sessionId] : [])];
  const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
  const result = spawnSync(config.binary, args, {
    encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES,
    input: config.name === 'codex' ? text : undefined,
  });
  if (result.status !== 0) {
    const reason = result.error?.message || result.stderr?.trim() || `exit ${String(result.status)}`;
    return { reply: `The agent call failed. ${reason}`, sessionId };
  }
  try {
    return config.name === 'codex' ? codexReply(result.stdout, sessionId) : claudeReply(result.stdout, sessionId);
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'Invalid JSON from the agent.' : String(error);
    return { reply: `The agent response failed. ${reason}`, sessionId };
  }
}
