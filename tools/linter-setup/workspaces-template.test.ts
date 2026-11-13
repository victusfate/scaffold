#!/usr/bin/env node
// Acceptance check for the opt-in npm-workspaces template (lib/linters/ts/workspaces):
// a copy of it, with the README's example source and test, passes its own
// test, coverage and typecheck scripts.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const tpl = join(root, 'lib/linters/ts/workspaces');
const dir = mkdtempSync(join(tmpdir(), 'ts-workspaces-'));
try {
  cpSync(tpl, dir, { recursive: true });
  // The README's two ts blocks are the example package's source and test.
  const blocks = [...readFileSync(join(tpl, 'README.md'), 'utf8').matchAll(/```ts\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.equal(blocks.length, 2, 'README carries the example src and test');
  const pkg = join(dir, 'packages/example');
  mkdirSync(join(pkg, 'src')); mkdirSync(join(pkg, 'test'));
  // The README nests both blocks under a numbered list item, indented 3 spaces.
  writeFileSync(join(pkg, 'src/index.ts'), blocks[0].replace(/^ {3}/gm, ''));
  writeFileSync(join(pkg, 'test/index.test.ts'), blocks[1].replace(/^ {3}/gm, ''));
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir'); // typescript + @types/node

  const run = (...args: string[]) => execFileSync('npm', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  assert.match(run('test'), /pass 1/);
  assert.match(run('run', 'test:coverage'), /all files\s*\|\s*100/);
  run('run', 'typecheck');
  const config = JSON.parse(readFileSync(join(dir, 'packages/tsconfig.json'), 'utf8')) as { compilerOptions: Record<string, unknown> };
  assert.equal(config.compilerOptions.erasableSyntaxOnly, true);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('workspaces-template.test: ok');
