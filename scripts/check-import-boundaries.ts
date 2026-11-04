#!/usr/bin/env node
// Enforce explicit source import rules. Usage: node scripts/check-import-boundaries.ts [--root DIR].
// .agent/boundaries.json opts a repo in; malformed config, syntax and unresolved/computed edges fail closed.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type ts from 'typescript';
import { importEdges } from './import-boundary-edges.ts';

interface BoundaryRule { from: string[]; deny: string[]; reason: string }
interface Boundaries { version: 1; rules: BoundaryRule[] }
const SOURCE = /\.[cm]?[jt]sx?$/;
const DATA = /\.(?:md|json|ya?ml|toml|txt|csv|svg|png|jpe?g|gif|webp|ico|lock|css|scss|html)$/;
const BUILTINS = new Set(builtinModules.flatMap(m => [m, `node:${m}`]));
const localPath = (root: string, path: string) => relative(root, path).split(sep).join('/');

function globs(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((g: unknown) => typeof g === 'string' && g.length > 0
    && !isAbsolute(g) && !g.split('/').includes('..') && !/[\\\0\r\n!{}[\]]/.test(g));
}

function boundaryRule(value: unknown): BoundaryRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('boundaries: expected rule object');
  const rule = value as Record<string, unknown>;
  if (Object.keys(rule).some(k => !['from', 'deny', 'reason'].includes(k)) || !globs(rule.from) || !globs(rule.deny)) {
    throw new Error('boundaries: from/deny must be nonempty relative path globs (*, ** and ? only)');
  }
  if (typeof rule.reason !== 'string' || !rule.reason.trim()) throw new Error('boundaries: each rule needs a reason');
  return { from: rule.from, deny: rule.deny, reason: rule.reason };
}

function configAt(root: string): Boundaries | null {
  const path = join(root, '.agent/boundaries.json');
  if (!existsSync(path)) return null;
  const config: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('boundaries: expected an object');
  const c = config as Record<string, unknown>;
  if (c.version !== 1 || Object.keys(c).some(k => !['version', 'rules'].includes(k)) || !Array.isArray(c.rules)) {
    throw new Error('boundaries: unsupported version or invalid rules');
  }
  return { version: 1, rules: c.rules.map(boundaryRule) };
}

function compilerOptions(compiler: typeof ts, root: string): ts.CompilerOptions {
  const path = join(root, 'tsconfig.json');
  const defaults = { allowJs: true, resolveJsonModule: true, moduleResolution: compiler.ModuleResolutionKind.NodeNext };
  if (!existsSync(path)) return defaults;
  const read = compiler.readConfigFile(path, file => compiler.sys.readFile(file));
  if (read.error) throw new Error(`boundaries: invalid tsconfig.json: ${compiler.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
  const parsed = compiler.parseJsonConfigFileContent(read.config, compiler.sys, root);
  // An empty project is valid for this scan; all other config errors block resolution.
  const noInputs = 18003;
  const errors = parsed.errors.filter(d => d.code !== noInputs);
  if (errors.length) throw new Error(`boundaries: invalid tsconfig.json: ${errors.map(d => compiler.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
  return { ...defaults, ...parsed.options };
}

interface ScanContext { root: string; rule: BoundaryRule; compiler: typeof ts; options: ts.CompilerOptions; seen: Set<string> }
const matches = (path: string, globs: string[]) => globs.some(g => matchesGlob(path, g));
const forbidden = (ctx: ScanContext, path: string) => matches(localPath(ctx.root, path), ctx.rule.deny);
const escapesRoot = (root: string, path: string) => localPath(root, path).split('/').includes('..');

function scanTarget(ctx: ScanContext, target: string, external: boolean | undefined, at: string): string[] {
  const real = realpathSync(target);
  if (forbidden(ctx, target) || forbidden(ctx, real)) return [`${at}: forbidden import ${localPath(ctx.root, target)}`];
  if (external) return [];
  if (escapesRoot(ctx.root, real)) return [`${at}: local import escapes repository`];
  if (SOURCE.test(target)) return scanSource(ctx, target);
  return DATA.test(target) ? [] : [`${at}: unsupported local import ${localPath(ctx.root, target)}`];
}

function scanEdge(ctx: ScanContext, path: string, edge: ReturnType<typeof importEdges>[number]): string[] {
  if (edge.overridden) return [];
  const at = `${localPath(ctx.root, path)}:${edge.line}`;
  if (edge.specifier === null) return [`${at}: computed import cannot be classified`];
  if (BUILTINS.has(edge.specifier)) return [];
  const resolved = ctx.compiler.resolveModuleName(edge.specifier, path, ctx.options, ctx.compiler.sys).resolvedModule;
  if (!resolved) return [`${at}: unresolved import ${edge.specifier}`];
  return scanTarget(ctx, resolve(resolved.resolvedFileName), resolved.isExternalLibraryImport, at);
}

function scanSource(ctx: ScanContext, path: string): string[] {
  const real = realpathSync(path);
  if (ctx.seen.has(real)) return [];
  ctx.seen.add(real);
  const source = ctx.compiler.createSourceFile(path, readFileSync(path, 'utf8'), ctx.compiler.ScriptTarget.Latest, true);
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) return [`${localPath(ctx.root, path)}: syntax error prevents import analysis`];
  return importEdges(ctx.compiler, source).flatMap(edge => scanEdge(ctx, path, edge));
}

function scanConfigured(ctx: ScanContext, path: string): string[] {
  const file = localPath(ctx.root, path);
  if (escapesRoot(ctx.root, realpathSync(path))) return [`${file}: source symlink escapes repository`];
  if (SOURCE.test(file)) return scanSource(ctx, path);
  if (!statSync(path).isFile() || DATA.test(file)) return [];
  return [`${file}: unsupported source; add a language adapter`];
}

function scanFile(ctx: ScanContext, file: string): string[] {
  const path = join(ctx.root, file);
  if (!existsSync(path)) return [`${file}: missing tracked file`];
  if (!matches(file, ctx.rule.from)) return [];
  if (forbidden(ctx, realpathSync(path))) return [`${file}: source symlink targets forbidden source`];
  return scanConfigured(ctx, path);
}

/** Read-only scan. Carry origin rules through local imports so bridge modules cannot bypass them. */
export async function checkImportBoundaries(root: string): Promise<string[]> {
  root = realpathSync(root);
  const config = configAt(root);
  if (!config) return [];
  const compiler = (await import('typescript')).default;
  const options = compilerOptions(compiler, root);
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8',
  }).split('\0').filter(Boolean);
  return config.rules.flatMap(rule => {
    const ctx: ScanContext = { root, rule, compiler, options, seen: new Set() };
    return files.flatMap(file => scanFile(ctx, file)).map(finding => `${finding} (${rule.reason})`);
  });
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--root')) throw new Error('usage: check-import-boundaries.ts [--root DIR]');
    const findings = await checkImportBoundaries(args[1] ? resolve(args[1]) : ROOT);
    console.log(findings.length ? findings.join('\n') : 'import boundaries: passed (unconfigured repositories are skipped)');
    if (findings.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
