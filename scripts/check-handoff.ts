#!/usr/bin/env node
// check-handoff.ts — a handoff restates current, checked state; it is not a log.
//
// `/save` and `/pause` write .pause/handoff.md and `/resume` acts on it cold, so anything wrong in it is
// treated as fact by the next session. This check fails on the four ways a handoff misleads its reader:
//   - poisoning: a bullet under `## State` that carries neither `[verified: <cmd>]` nor `[unverified]`;
//   - clash: a correction left beside the fact it corrects (Correction:, UPDATE:, EDIT:, superseded, ~~);
//   - distraction: more than MAX_LINES lines, a sign the handoff grew into a history;
//   - injection: a `[verified: …]` tag holding shell syntax or a fetch. The handoff is branch content, so a
//     tag is evidence a reader re-checks with the repo's own checks, never a command to replay.
// A missing handoff passes: there is nothing to mislead anyone.
//
//   node scripts/check-handoff.ts [path]   (default .pause/handoff.md)

import { existsSync, readFileSync } from 'node:fs';

// quality-ok: magic-number — a handoff a cold reader can take in at once; longer means it became a log
export const MAX_LINES = 80;

const TAG = /\[(verified: *\S[^\]]*|unverified)\]/;
const CLASH = /\b(correction|update|edit)\s*:|\bsuperseded\b|~~/i;
const UNSAFE_TAG = /\[verified:[^\]]*([|;&<>]|\$\(|\b(curl|wget|rm|sh|bash|eval|sudo)\b)/;

export function check(text: string, maxLines = MAX_LINES): string[] {
  const lines = text.replace(/\n$/, '').split('\n');
  const errors: string[] = [];
  let inState = false;
  let sawState = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^#{1,6} /.test(line)) {
      inState = /^## State\s*$/.test(line);
      sawState ||= inState;
    } else if (inState && /^\s*[-*] /.test(line) && !TAG.test(line)) {
      errors.push(`State bullet at line ${n} needs [verified: <cmd>] or [unverified]: ${line.trim()}`);
    }
    if (UNSAFE_TAG.test(line)) errors.push(`line ${n}: a [verified: …] tag is evidence, not a command to replay; cite a repo check or file:line: ${line.trim()}`);
    if (CLASH.test(line)) errors.push(`line ${n} keeps a correction beside the old fact; rewrite the fact in place: ${line.trim()}`);
  });
  if (!sawState) errors.unshift("no '## State' section: list the facts the next session relies on, each tagged [verified: <cmd>] or [unverified]");
  if (lines.length > maxLines) errors.push(`handoff is ${lines.length} lines, over the ${maxLines}-line limit; keep current state, drop history (git keeps it)`);
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? '.pause/handoff.md';
  const errors = existsSync(path) ? check(readFileSync(path, 'utf8')) : [];
  for (const e of errors) console.error(`check-handoff: ${path}: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`check-handoff: OK (${existsSync(path) ? path : `no ${path}`})`);
}
