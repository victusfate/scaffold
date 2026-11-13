#!/usr/bin/env node
// Strict bootstrap defaults and consumer-owned formatter preservation.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './emit.ts';
import { registry } from './registry.ts';
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'strict-linter-'));
try {
  writeFileSync(join(dir, 'package.json'), '{}\n');
  writeFileSync(join(dir, '.prettierrc.json'), '{"semi": false}\n');
  const result = emit('ts', dir, root);
  const eslint = readFileSync(join(dir, 'eslint.config.mjs'), 'utf8');
  assert.match(eslint, /strictTypeChecked/);
  assert.doesNotMatch(eslint, /\['warn'/);
  const config = JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8')) as { compilerOptions: Record<string, unknown> };
  assert.equal(config.compilerOptions.strict, true);
  // Node type-stripping rejects non-erasable syntax (enums, parameter properties) at runtime; tsc must catch it first.
  assert.equal(config.compilerOptions.erasableSyntaxOnly, true);
  assert.match(eslint, /'\*\*\/fixtures\/\*\*'/);
  assert.equal(readFileSync(join(dir, '.prettierrc.json'), 'utf8'), '{"semi": false}\n');
  assert.ok(existsSync(join(dir, '.prettierrc.json.scaffold-new')));
  assert.ok(result.sidecars.includes('.prettierrc.json'));
  assert.match(registry.ts.scripts?.lint ?? '', /--max-warnings 0/);
  assert.match(registry.ts.scripts?.['format:check'] ?? '', /prettier.*--check/);
  assert.ok(registry.ts.devDependencies?.prettier);
  const workflow = readFileSync(join(dir, '.github/workflows/lint-ts.yml'), 'utf8');
  assert.match(workflow, /eslint \. --max-warnings 0/);
  assert.match(workflow, /prettier.*--check/);
  assert.match(workflow, /tsc --noEmit/);
  const rust = readFileSync(join(root, 'lib/linters/rust/lint-rust.yml'), 'utf8');
  assert.match(rust, /cargo fmt --all -- --check/);
  assert.match(rust, /clippy::pedantic/);
} finally { rmSync(dir, { recursive: true, force: true }); }
// Prettier supports many config names and package.json's prettier field.
// Installing another config must not silently take precedence over any of them.
for (const alternate of ['.prettierrc', 'prettier.config.ts', 'package.json']) {
  const consumer = mkdtempSync(join(tmpdir(), 'strict-existing-'));
  try {
    writeFileSync(join(consumer, alternate), alternate === 'package.json' ? '{"prettier":{"semi":false}}\n' : '{}\n');
    const result = emit('js', consumer, root);
    assert.ok(!existsSync(join(consumer, '.prettierrc.json')), alternate);
    assert.ok(result.sidecars.includes('.prettierrc.json'), alternate);
  } finally { rmSync(consumer, { recursive: true, force: true }); }
}
console.log('strict-defaults.test: ok');
