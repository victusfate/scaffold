// Test helpers for dependency-watch (not part of the installed check): temp git repos and the
// workflow template's shell steps.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export function repoWith(tracked: Record<string, string>, untracked: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'dependency-watch-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [path, content] of Object.entries({ ...tracked, ...untracked })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  if (Object.keys(tracked).length) execFileSync('git', ['add', ...Object.keys(tracked)], { cwd: dir });
  return dir;
}

// Every `run: |` block in a workflow, de-indented to the shell it runs.
export const runBlocks = (workflow: string): string[] =>
  [...workflow.matchAll(/run: \|\n((?:\s{10}.*\n?|\n)+)/g)].map(m => m[1].replace(/^ {10}/gm, ''));
