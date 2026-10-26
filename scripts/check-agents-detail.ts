#!/usr/bin/env node
// check-agents-detail.ts — AGENTS.md stays compact without losing guidance.
//
// AGENTS.md keeps each rule in a few lines and links to its full text in docs/agents-detail.md.
// This check fails when that pairing breaks: an archived section no AGENTS.md section links to (its
// guidance would be unreachable), or an AGENTS.md link to an archive section that doesn't exist.
// It also fails when AGENTS.md exceeds MAX_BYTES: some harnesses (Antigravity/agy) silently truncate
// rule files past 24,000 bytes, so anything past the limit would be invisible to those agents.
// AGENTS_MAX_BYTES overrides the limit.
//
//   node scripts/check-agents-detail.ts [repo-root]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ARCHIVE = 'docs/agents-detail.md';
// quality-ok: magic-number — Antigravity (agy) truncates rule files past 24,000 bytes
export const MAX_BYTES = 24000;

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function anchor(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}\- _]/gu, '').replace(/ /g, '-');
}

export function headings(markdown: string): string[] {
  return [...markdown.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
}

export function linkedAnchors(agents: string): string[] {
  const escaped = ARCHIVE.replace(/[.]/g, '\\.');
  return [...agents.matchAll(new RegExp(`${escaped}#([^)\\s]+)`, 'g'))].map(m => m[1]);
}

export function check(agents: string, archive: string, maxBytes = MAX_BYTES): string[] {
  const archived = new Set(headings(archive).map(anchor));
  const linked = new Set(linkedAnchors(agents));
  const errors: string[] = [];
  for (const a of archived) if (!linked.has(a)) errors.push(`${ARCHIVE}#${a} is archived but no AGENTS.md section links to it`);
  for (const a of linked) if (!archived.has(a)) errors.push(`AGENTS.md links ${ARCHIVE}#${a}, which has no matching section`);
  const bytes = Buffer.byteLength(agents, 'utf8');
  if (bytes > maxBytes) errors.push(`AGENTS.md is ${bytes} bytes, over the ${maxBytes}-byte limit; move detail into ${ARCHIVE} and link it`);
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? process.cwd();
  const max = Number(process.env.AGENTS_MAX_BYTES ?? MAX_BYTES);
  const errors = check(readFileSync(join(root, 'AGENTS.md'), 'utf8'), readFileSync(join(root, ARCHIVE), 'utf8'), max);
  for (const e of errors) console.error(`check-agents-detail: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`check-agents-detail: OK (${headings(readFileSync(join(root, ARCHIVE), 'utf8')).length} archived sections, all linked)`);
}
