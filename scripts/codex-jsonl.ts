// Shared validation for Codex CLI JSONL events.
export interface CodexEvent {
  type: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  item?: { type?: string; text?: string };
}

const FAILED_EVENTS = new Set(['turn.failed', 'error']);

export function parseCodexEvent(line: string): CodexEvent {
  const event = JSON.parse(line) as Partial<CodexEvent> | null;
  if (!event || typeof event.type !== 'string') throw new Error('Invalid Codex JSONL event');
  if (FAILED_EVENTS.has(event.type))
    throw new Error(event.error?.message ?? event.message ?? 'Codex turn failed');
  if (event.type === 'thread.started' && (typeof event.thread_id !== 'string' || !event.thread_id.trim()))
    throw new Error('Codex thread.started event has no thread ID');
  return event as CodexEvent;
}

export function codexThreadId(event: CodexEvent): string | undefined {
  return event.type === 'thread.started' ? event.thread_id : undefined;
}
