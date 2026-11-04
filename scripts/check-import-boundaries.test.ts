#!/usr/bin/env node
// Boundary gate acceptance fixtures: source syntax, aliases, fail-closed inputs and scoped overrides.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkImportBoundaries } from './check-import-boundaries.ts';
import { loadTypeScript } from './typescript-runtime.ts';
// The gate parses source with the optional typescript package; a consumer without it has nothing to check.
const compiler = await loadTypeScript();
if (!compiler) { console.log('import boundaries: skipped (typescript is not installed)'); process.exit(0); }
const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
const put = (file: string, value: string) => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), value); };
try {
  execFileSync('git', ['init', '-q', root]);
  assert.deepEqual(await checkImportBoundaries(root), []);
  put('.agent/boundaries.json', JSON.stringify({ version: 1, rules: [{ from: ['core/**'], deny: ['experiment/**'], reason: 'core must not depend on experimental UI' }] }));
  put('experiment/leaf.ts', 'export const value = 1;');
  put('core/main.ts', 'import { value } from "../experiment/leaf.ts"; console.log(value);');
  assert.match((await checkImportBoundaries(root)).join('\n'), /core\/main.ts:1.*forbidden/);
  put('core/main.ts', 'const text = "import x from \'../experiment/leaf.ts\'";');
  assert.deepEqual(await checkImportBoundaries(root), [], 'strings are not imports');
  put('core/main.ts', '// quality-ok: import-boundary — isolated migration adapter\nexport * from "../experiment/leaf.ts";');
  assert.deepEqual(await checkImportBoundaries(root), []);
  put('core/main.ts', '// quality-ok: import-boundary — \nexport * from "../experiment/leaf.ts";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/);
  put('core/main.ts', 'const marker = "// quality-ok: import-boundary — string is not a pragma"; import "../experiment/leaf.ts";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/);
  put('core/main.ts', 'import(/* real edge */ "../experiment/leaf.ts");');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/);
  put('core/main.ts', '// quality-ok: import-boundary — controlled runtime entry point\nconst target = import(somePath);');
  assert.deepEqual(await checkImportBoundaries(root), []);
  put('core/main.ts', 'const target = "../experiment/leaf.ts"; import(target);');
  assert.match((await checkImportBoundaries(root)).join('\n'), /computed/);
  put('core/main.ts', 'const leaf = require("../experiment/leaf.ts");');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/);
  put('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@exp/*': ['experiment/*'] } } }));
  put('core/main.ts', 'import { value } from "@exp/leaf";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/);
  put('bridge.ts', 'export * from "./experiment/leaf.ts";');
  put('core/main.ts', 'import { value } from "../bridge.ts";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /bridge.ts:1.*forbidden/, 'transitive dependency must honor origin boundary');
  put('bridge.ts', 'export const value = 1;');
  symlinkSync(join(root, 'experiment/leaf.ts'), join(root, 'core/link.ts'));
  put('core/main.ts', 'import "./link.ts";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden|symlink/);
  rmSync(join(root, 'core/link.ts'));
  put('core/main.ts', 'import "./missing.ts";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /unresolved/);
  put('core/main.ts', 'import {');
  assert.match((await checkImportBoundaries(root)).join('\n'), /syntax/);
  put('core/main.ts', 'export {};');
  put('core/hidden.rs', 'use experiment::leaf;');
  assert.match((await checkImportBoundaries(root)).join('\n'), /unsupported/);
  rmSync(join(root, 'core/hidden.rs'));
  // Runtime edges must not disappear behind adjacent type declarations.
  for (const [extension, declaration] of [['js', 'd.ts'], ['mjs', 'd.mts'], ['cjs', 'd.cts']]) {
    put(`experiment/leaf.${extension}`, extension === 'cjs' ? 'exports.value = 1;' : 'export const value = 1;');
    put(`runtime-bridge.${extension}`, extension === 'cjs' ? 'module.exports = require("./experiment/leaf.cjs");' : `export * from "./experiment/leaf.${extension}";`);
    put(`runtime-bridge.${declaration}`, 'export declare const value: number;');
    put('core/main.ts', `import { value } from "../runtime-bridge.${extension}"; console.log(value);`);
    assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/, `${extension} runtime implementation behind declarations is checked`);
    put('core/main.ts', `export * from "../runtime-bridge.${extension}";`);
    assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/, `${extension} value re-export is checked`);
  }
  put('bridge.js', 'export * from "./experiment/leaf.js";');
  put('core/main.ts', 'import { value } from "../bridge.js";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/, 'adjacent TS source must not hide physical JS implementation');
  put('types-only.d.ts', 'export interface Value { amount: number }');
  put('core/main.ts', 'import type { Value } from "../types-only.js"; export type Result = Value;');
  assert.deepEqual(await checkImportBoundaries(root), [], 'an explicit type-only import needs no runtime implementation');
  put('core/main.ts', 'import { type Value } from "../types-only.js";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /runtime.*unavailable/, 'an omitted runtime policy conservatively preserves empty imports');
  rmSync(join(root, 'tsconfig.json'));
  assert.match((await checkImportBoundaries(root)).join('\n'), /runtime.*unavailable/, 'without tsconfig native runtime policy is conservative');
  put('tsconfig.json', JSON.stringify({ compilerOptions: { noEmit: false, verbatimModuleSyntax: false } }));
  // Prove the distinction by running native source and compiler-emitted code.
  const marker = join(root, 'native-side-effect.txt');
  put('experiment/runtime.js', `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "executed"); export const value = 1;`);
  put('native-bridge.js', 'export * from "./experiment/runtime.js";');
  put('native-bridge.d.ts', 'export interface Value { amount: number }');
  const nativeSource = 'import { type Value } from "../native-bridge.js";';
  put('core/main.ts', nativeSource);
  put('tsconfig.json', JSON.stringify({ compilerOptions: { noEmit: true, verbatimModuleSyntax: false } }));
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/, 'noEmit source keeps runtime edges even when verbatim is false');
  execFileSync(process.execPath, [join(root, 'core/main.ts')], { cwd: root });
  assert.equal(readFileSync(marker, 'utf8'), 'executed', 'native Node executes the forbidden side effect behind aggregate type syntax');
  rmSync(marker);
  const emitted = compiler.transpileModule(nativeSource, { compilerOptions: {
    module: compiler.ModuleKind.ESNext, noEmit: false, verbatimModuleSyntax: false,
  } }).outputText;
  put('core/compiled.js', emitted);
  put('tsconfig.json', JSON.stringify({ compilerOptions: { noEmit: false, verbatimModuleSyntax: false } }));
  assert.deepEqual(await checkImportBoundaries(root), [], 'explicit emitted execution safely elides aggregate types');
  execFileSync(process.execPath, [join(root, 'core/compiled.js')], { cwd: root });
  assert.ok(!existsSync(marker), 'actual compiler-emitted execution has no import side effect');
  for (const source of ['import { type Value } from "../types-only.js";', 'export { type Value } from "../types-only.js";']) {
    put('core/main.ts', source);
    assert.deepEqual(await checkImportBoundaries(root), [], 'aggregate named types erase under default TypeScript import elision');
    put('tsconfig.json', JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }));
    assert.match((await checkImportBoundaries(root)).join('\n'), /runtime.*unavailable/, 'verbatim named types preserve an empty runtime module edge');
    put('tsconfig.json', JSON.stringify({ compilerOptions: { noEmit: false, verbatimModuleSyntax: false } }));
  }
  for (const source of [
    'import {} from "../types-only.js";', 'import "../types-only.js";',
    'import Default, { type Value } from "../types-only.js"; console.log(Default);',
    'import { type Value, value } from "../types-only.js"; console.log(value);',
  ]) {
    put('core/main.ts', source);
    assert.match((await checkImportBoundaries(root)).join('\n'), /runtime.*unavailable/, 'empty, default and mixed imports retain runtime requirements');
  }
  put('core/main.ts', 'import { Value } from "../types-only.js"; console.log(Value);');
  assert.match((await checkImportBoundaries(root)).join('\n'), /runtime.*unavailable/, 'a value import with declarations only fails closed');
  put('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@bridge': ['runtime-bridge.js'] } } }));
  put('core/main.ts', 'import { value } from "@bridge";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/, 'paths aliases resolve runtime code alongside declarations');
  put('package.json', JSON.stringify({ type: 'module', imports: { '#bridge': { types: './runtime-bridge.d.ts', default: './runtime-bridge.js' } } }));
  put('core/main.ts', 'import { value } from "#bridge";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/, 'package imports type conditions cannot hide runtime implementation');
  put('experiment/shape.d.ts', 'export interface Shape { value: number }');
  put('core/main.ts', 'import type { Shape } from "../experiment/shape.d.ts";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/, 'type-only imports still obey declared deny paths');
  put('packages/workspace/package.json', JSON.stringify({ name: 'workspace', types: './index.ts', main: './index.js' }));
  put('packages/workspace/index.ts', 'export * from "../../experiment/leaf.ts";');
  put('packages/workspace/index.js', 'export * from "../../experiment/leaf.js";');
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(join(root, 'packages/workspace'), join(root, 'node_modules/workspace'), 'dir');
  put('core/main.ts', 'import { value } from "workspace";');
  assert.match((await checkImportBoundaries(root)).join('\n'), /forbidden/, 'workspace package symlinks are local code even when TS labels them external');
  put('core/main.ts', 'export {};');
  put('.agent/boundaries.json', '{broken');
  await assert.rejects(checkImportBoundaries(root), /JSON/);
  put('.agent/boundaries.json', JSON.stringify({ version: 1, rules: [{ from: ['../outside/**'], deny: ['experiment/**'], reason: 'invalid glob' }] }));
  await assert.rejects(checkImportBoundaries(root), /glob/);
  put('.agent/boundaries.json', JSON.stringify({ version: 1, rules: [{ from: ['gone/**'], deny: ['experiment/**'], reason: 'missing configured root' }] }));
  assert.match((await checkImportBoundaries(root)).join('\n'), /match no source/);
  console.log('import boundaries: passed');
} finally { rmSync(root, { recursive: true, force: true }); }
