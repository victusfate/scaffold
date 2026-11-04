#!/usr/bin/env node
// Enforce explicit source import rules. Usage: node scripts/check-import-boundaries.ts [--root DIR].
// .agent/boundaries.json opts a repo in; malformed config, syntax and unresolved/computed edges fail closed.
// Default to native runtime edges. Elide aggregate type specifiers only with explicit noEmit:false + verbatimModuleSyntax:false.
// A noEmit project executes source and keeps empty runtime edges, matching Node native type stripping.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type ts from 'typescript';
import { requireTypeScript } from './typescript-runtime.ts';
import { importEdges } from './import-boundary-edges.ts';

interface BoundaryRule { from: string[]; deny: string[]; reason: string }
interface Boundaries { version: 1; rules: BoundaryRule[] }
const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'];
const TYPESCRIPT_SUFFIXES = ['.ts', '.tsx', '.mts', '.mtsx', '.cts', '.ctsx'];
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
  const defaults = { noEmit: true, verbatimModuleSyntax: true, allowJs: true, resolveJsonModule: true, moduleResolution: compiler.ModuleResolutionKind.NodeNext };
  if (!existsSync(path)) return defaults;
  const read = compiler.readConfigFile(path, file => compiler.sys.readFile(file));
  if (read.error) throw new Error(`boundaries: invalid tsconfig.json: ${compiler.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
  const parsed = compiler.parseJsonConfigFileContent(read.config, compiler.sys, root);
  // An empty project is valid for this scan; all other config errors block resolution.
  const NO_INPUTS = 18003;
  const errors = parsed.errors.filter(d => d.code !== NO_INPUTS);
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
  if (external && (escapesRoot(ctx.root, real) || localPath(ctx.root, real).split('/').includes('node_modules'))) return [];
  if (escapesRoot(ctx.root, real)) return [`${at}: local import escapes repository`];
  if (SOURCE.test(target)) return scanSource(ctx, target);
  return DATA.test(target) ? [] : [`${at}: unsupported local import ${localPath(ctx.root, target)}`];
}

type HiddenFiles = 'declarations' | 'typescript' | undefined;
function visibleFile(path: string, hidden: HiddenFiles): boolean {
  if (hidden === 'declarations') return !DECLARATION_SUFFIXES.some(suffix => path.endsWith(suffix));
  if (hidden === 'typescript') return !TYPESCRIPT_SUFFIXES.some(suffix => path.endsWith(suffix));
  return true;
}

/** Resolve both Node condition branches conservatively; declarations must never hide value implementations. */
function resolveTargets(ctx: ScanContext, path: string, specifier: string, hidden?: HiddenFiles): ts.ResolvedModuleFull[] {
  const host: ts.ModuleResolutionHost = {
    ...ctx.compiler.sys,
    fileExists: file => visibleFile(file, hidden) && ctx.compiler.sys.fileExists(file),
  };
  const modes = [ctx.compiler.ModuleKind.ESNext, ctx.compiler.ModuleKind.CommonJS] as const;
  return modes.flatMap(mode => {
    const resolved = ctx.compiler.resolveModuleName(specifier, path, { ...ctx.options, allowJs: true }, host, undefined, undefined, mode).resolvedModule;
    return resolved && visibleFile(resolved.resolvedFileName, hidden) ? [resolved] : [];
  });
}

function uniqueTargets(targets: ts.ResolvedModuleFull[]): ts.ResolvedModuleFull[] {
  const seen = new Set<string>();
  return targets.filter(target => {
    const path = resolve(target.resolvedFileName);
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function edgeTargets(ctx: ScanContext, path: string, edge: ReturnType<typeof importEdges>[number]): ts.ResolvedModuleFull[] {
  const specifier = edge.specifier!;
  const typed = resolveTargets(ctx, path, specifier);
  if (edge.typeOnly) return uniqueTargets(typed);
  const runtime = resolveTargets(ctx, path, specifier, 'declarations');
  // TypeScript sources may themselves shadow adjacent JS. Scan physical JS implementations as well.
  const javascript = resolveTargets(ctx, path, specifier, 'typescript');
  if (!runtime.length && !javascript.length && typed.length) throw new Error('runtime implementation unavailable');
  return uniqueTargets([...typed, ...runtime, ...javascript]);
}

function scanEdge(ctx: ScanContext, path: string, edge: ReturnType<typeof importEdges>[number]): string[] {
  if (edge.overridden) return [];
  const at = `${localPath(ctx.root, path)}:${edge.line}`;
  if (edge.specifier === null) return [`${at}: computed import cannot be classified`];
  if (BUILTINS.has(edge.specifier)) return [];
  let targets: ts.ResolvedModuleFull[];
  try { targets = edgeTargets(ctx, path, edge); }
  catch (error) { return [`${at}: ${String(error)} for ${edge.specifier}`]; }
  if (!targets.length) return [`${at}: unresolved import ${edge.specifier}`];
  return targets.flatMap(target => scanTarget(ctx, resolve(target.resolvedFileName), target.isExternalLibraryImport, at));
}

function scanSource(ctx: ScanContext, path: string): string[] {
  const real = realpathSync(path);
  if (ctx.seen.has(real)) return [];
  ctx.seen.add(real);
  const source = ctx.compiler.createSourceFile(real, readFileSync(real, 'utf8'), ctx.compiler.ScriptTarget.Latest, true);
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) return [`${localPath(ctx.root, real)}: syntax error prevents import analysis`];
  return importEdges(ctx.compiler, source, ctx.options.noEmit !== false || ctx.options.verbatimModuleSyntax !== false).flatMap(edge => scanEdge(ctx, real, edge));
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
  if (!matches(file, ctx.rule.from)) return [];
  if (!existsSync(path)) return [`${file}: missing tracked file`];
  if (forbidden(ctx, realpathSync(path))) return [`${file}: source symlink targets forbidden source`];
  return scanConfigured(ctx, path);
}

/** Read-only scan. Carry origin rules through local imports so bridge modules cannot bypass them. */
export async function checkImportBoundaries(root: string): Promise<string[]> {
  root = realpathSync(root);
  const config = configAt(root);
  if (!config) return [];
  const compiler = await requireTypeScript('check-import-boundaries');
  const options = compilerOptions(compiler, root);
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8',
  }).split('\0').filter(Boolean);
  return config.rules.flatMap(rule => {
    const ctx: ScanContext = { root, rule, compiler, options, seen: new Set() };
    const missing = rule.from.filter(glob => !files.some(file => matchesGlob(file, glob)));
    if (missing.length) return [`boundaries: from globs match no source: ${missing.join(', ')} (${rule.reason})`];
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
