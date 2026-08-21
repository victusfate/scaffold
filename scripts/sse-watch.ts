// sse-watch.ts — shared Server-Sent-Events plumbing for the live local
// servers (queue-console.ts, mermaid-watch.ts): a client registry that
// broadcasts one-line events, plus a polling file watcher that fires on real
// mtime changes. Extracted so both servers share one lifecycle-correct
// implementation (clients dropped on disconnect, watcher detachable).

import type http from 'node:http';
import { watchFile, unwatchFile } from 'node:fs';

const HTTP_OK = 200;

export interface SseChannel {
  /** Adopt a request as an SSE client: headers, greeting, cleanup on close. */
  attach(req: http.IncomingMessage, res: http.ServerResponse): void;
  /** Send one event line to every connected client, dropping dead ones. */
  broadcast(data: string): void;
  /** End every client connection (server shutdown). */
  end(): void;
}

export function createSseChannel(): SseChannel {
  const clients = new Set<http.ServerResponse>();
  return {
    attach(req, res): void {
      res.writeHead(HTTP_OK, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    broadcast(data): void {
      for (const res of clients) {
        try { res.write(`data: ${data}\n\n`); } catch { clients.delete(res); }
      }
    },
    end(): void {
      for (const res of clients) { try { res.end(); } catch { /* already gone */ } }
      clients.clear();
    },
  };
}

/**
 * Poll `file` and call `onChange` on every real content change (mtime moved).
 * Polling survives editors that replace the file on save. Returns a detach
 * function so a closing server releases the event-loop handle.
 */
export function watchFileChanges(file: string, intervalMs: number, onChange: () => void): () => void {
  const listener = (curr: { mtimeMs: number }, prev: { mtimeMs: number }): void => {
    if (curr.mtimeMs !== prev.mtimeMs) onChange();
  };
  watchFile(file, { interval: intervalMs }, listener);
  return () => unwatchFile(file, listener);
}
