#!/usr/bin/env node
// check-guidelines.ts — keep agent guideline text concise and consistent across model sizes.
//
// Every model that uses this harness reads AGENTS.md each turn and a skill per task, so duplicated or drifting
// text costs attention and can contradict itself (docs/agent-authoring-requirements.md, section 7). Fails on:
//   - a paragraph of MIN_PARAGRAPH+ characters that appears in two places (one home per rule). Fenced code is
//     exempt, and so is a paragraph carrying a `quality-override:` pragma that explains the repetition;
//   - "the root" for the orchestrator (the canonical term);
//   - a skill over SKILL_MAX_BYTES, unless it carries `quality-ok: skill-length — <reason>`.
// AGENTS.md's own size limit is scripts/check-agents-detail.ts.
//
//   node scripts/check-guidelines.ts [repo-root]

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// quality-ok: magic-number — long enough to be a rule, not a heading or a shared one-liner
export const MIN_PARAGRAPH = 120;
// quality-ok: magic-number — one skill read in full should stay a small share of a small model's window
export const SKILL_MAX_BYTES = 32_000;

const ROOT_TERM = /\bthe root(?:'s)?\b(?!\s+(?:cause|of|dir|directory|folder|checkout|path|commit))|\broot orchestrator\b/i;
const SKILL_PRAGMA = /quality-ok:\s*skill-length\s*—\s*\S/;

function paragraphs(text: string): string[] {
  return text.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.length >= MIN_PARAGRAPH && !p.includes('quality-override:'));
}

export function check(files: Map<string, string>, skillMax = SKILL_MAX_BYTES): string[] {
  const errors: string[] = [];
  const homes = new Map<string, string[]>();
  for (const [path, text] of files) {
    for (const p of paragraphs(text)) homes.set(p, [...(homes.get(p) ?? []), path]);
    text.split('\n').forEach((line, i) => {
      if (ROOT_TERM.test(line)) errors.push(`${path}:${i + 1} says "the root"; the canonical term is "the orchestrator"`);
    });
    const bytes = Buffer.byteLength(text, 'utf8');
    if (path.startsWith('skills/') && bytes > skillMax && !SKILL_PRAGMA.test(text))
      errors.push(`${path} is ${bytes} bytes, over the ${skillMax}-byte skill budget; cut repetition or move detail to a referenced doc`);
  }
  for (const [p, paths] of homes)
    if (paths.length > 1) errors.push(`paragraph duplicated in ${paths.join(', ')}; keep one home and link to it: "${p.slice(0, 80)}…"`);
  return errors;
}

export function guidelineFiles(root: string): Map<string, string> {
  const paths = ['AGENTS.md', 'docs/agents-detail.md', 'docs/security-review.md',
    ...readdirSync(join(root, 'skills')).filter(f => f.endsWith('.md')).sort().map(f => `skills/${f}`)];
  return new Map(paths.map(p => [p, readFileSync(join(root, p), 'utf8')]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = guidelineFiles(process.argv[2] ?? process.cwd());
  const errors = check(files);
  for (const e of errors) console.error(`check-guidelines: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`check-guidelines: OK (${files.size} files)`);
}
