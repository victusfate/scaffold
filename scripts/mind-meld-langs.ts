// mind-meld-langs — per-language facts for the static repo map: each source file's top-level definitions
// and the repo files it imports. Each result says how it was found (compiler, stdlib parser, or pattern),
// and a missing tool leaves the file on the map with that reason instead of a guess.
//   TypeScript: the typescript compiler API      Python: python3's stdlib ast (one subprocess)
//   Rust:       item lines by pattern; `mod x;` and `use crate::…` resolved by Rust's module rules
//   Ruby:       def/class/module lines by pattern; require_relative and require resolved to files

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import type ts from 'typescript';
import { loadTypeScript } from './typescript-runtime.ts';

export interface Definition { name: string; kind: string; line: number }
// What an adapter reports per file; the map adds the language name and line count.
export interface FileFacts { file: string; definitions: Definition[]; imports: string[]; method: string }
export interface ModuleFacts extends FileFacts { language: string; lines: number }

// What an adapter gets: repo-relative paths in, repo-relative paths out.
export interface AdapterContext {
  root: string;
  has(file: string): boolean;
  read(file: string): string;
  // The first candidate path that is a file in the repo (normalized), as a 0- or 1-element list.
  resolve(candidates: string[]): string[];
}

// A language adapter. Scaffold ships TypeScript, Python, Rust and Ruby below; a repo adds any other
// language in its own .mind-meld/languages/<name>.ts (default export), so scaffold does not grow.
export interface LanguageAdapter {
  name: string;
  extensions: string[];
  facts(files: string[], ctx: AdapterContext): FileFacts[] | Promise<FileFacts[]>;
}

const lineCount = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
// The distinct repo files a file imports, without itself, sorted.
const otherFiles = (files: string[], self: string): string[] => [...new Set(files)].filter(f => f !== self).sort();

// ── TypeScript ─────────────────────────────────────────────────────────────────────────────────────
function tsDefinitions(tsc: typeof ts, sf: ts.SourceFile): Definition[] {
  const kinds: [(n: ts.Node) => boolean, string][] = [
    [tsc.isFunctionDeclaration, 'function'], [tsc.isClassDeclaration, 'class'], [tsc.isInterfaceDeclaration, 'interface'],
    [tsc.isTypeAliasDeclaration, 'type'], [tsc.isEnumDeclaration, 'enum']];
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  return sf.statements.flatMap((s): Definition[] => {
    const exported = tsc.canHaveModifiers(s) && tsc.getModifiers(s)?.some(m => m.kind === tsc.SyntaxKind.ExportKeyword);
    if (!exported) return [];
    if (tsc.isVariableStatement(s)) {
      return s.declarationList.declarations.flatMap(d => tsc.isIdentifier(d.name) ? [{ name: d.name.text, kind: 'const', line: line(s) }] : []);
    }
    const kind = kinds.find(([is]) => is(s))?.[1];
    const name = (s as ts.DeclarationStatement).name;
    return kind && name && tsc.isIdentifier(name) ? [{ name: name.text, kind, line: line(s) }] : [];
  });
}

function tsImports(tsc: typeof ts, sf: ts.SourceFile, file: string, ctx: AdapterContext): string[] {
  const specs = sf.statements.flatMap(s => (tsc.isImportDeclaration(s) || tsc.isExportDeclaration(s)) && s.moduleSpecifier
    && tsc.isStringLiteral(s.moduleSpecifier) ? [s.moduleSpecifier.text] : []);
  return otherFiles(specs.filter(spec => spec.startsWith('.')).flatMap(spec => {
    const base = posix.join(posix.dirname(file), spec);
    return ctx.resolve([base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]);
  }), file);
}

async function typescriptFacts(files: string[], ctx: AdapterContext): Promise<FileFacts[]> {
  const tsc = await loadTypeScript();
  return files.map(file => {
    const text = ctx.read(file);
    if (!tsc) return { file, definitions: [], imports: [], method: 'not extracted: the typescript package is not installed' };
    const sf = tsc.createSourceFile(file, text, tsc.ScriptTarget.Latest, true);
    return { file, definitions: tsDefinitions(tsc, sf), imports: tsImports(tsc, sf, file, ctx), method: 'the TypeScript compiler (exported definitions)' };
  });
}

// ── Python ─────────────────────────────────────────────────────────────────────────────────────────
// Reads the file list as JSON on stdin; prints per file its top-level definitions and imports.
const PY_SCRIPT = String.raw`
import ast, json, sys
root, files = sys.argv[1], json.load(sys.stdin)
out = {}
for f in files:
    try:
        tree = ast.parse(open(root + "/" + f, encoding="utf-8").read(), f)
    except Exception as e:
        out[f] = {"error": type(e).__name__}; continue
    defs = [[n.name, "class" if isinstance(n, ast.ClassDef) else "function", n.lineno]
            for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
    imps = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Import): imps += [[a.name, 0, []] for a in n.names]
        elif isinstance(n, ast.ImportFrom): imps.append([n.module or "", n.level, [a.name for a in n.names]])
    out[f] = {"defs": defs, "imports": imps}
print(json.dumps(out))`;

type PyResult = { error?: string; defs?: [string, string, number][]; imports?: [string, number, string[]][] };

function pyImports(file: string, imports: [string, number, string[]][], ctx: AdapterContext): string[] {
  return otherFiles(imports.flatMap(([mod, level, names]) => {
    // Relative imports climb level-1 packages from the file's own; absolute ones start at the root or src/.
    const bases = level > 0 ? [posix.join(posix.dirname(file), '../'.repeat(level - 1))] : ['.', 'src'];
    return bases.flatMap(base => {
      const pkg = posix.join(base, mod.replace(/\./g, '/'));
      // A package (pkg/__init__.py) takes precedence over a same-named module file.
      return [...ctx.resolve([`${pkg}/__init__.py`, `${pkg}.py`]), ...names.flatMap(n => ctx.resolve([`${pkg}/${n}.py`]))];
    });
  }), file);
}

const PY_TIMEOUT_MS = 120_000;
const PY_MAX_OUTPUT = 256 * 1024 * 1024;

// Why python3 gave no facts, stated as precisely as the run allows.
function pythonFailure(run: ReturnType<typeof spawnSync>): string {
  if ((run.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return 'python3 is not available';
  if (run.error) return `python3 failed: ${run.error.message}`;
  return `python3 exited ${run.status}${run.stderr ? `: ${String(run.stderr).trim().split('\n').at(-1)}` : ''}`;
}

function pythonFacts(files: string[], ctx: AdapterContext): FileFacts[] {
  const run = spawnSync('python3', ['-I', '-c', PY_SCRIPT, ctx.root],
    { input: JSON.stringify(files), encoding: 'utf8', timeout: PY_TIMEOUT_MS, maxBuffer: PY_MAX_OUTPUT });
  const parsed = run.status === 0 ? JSON.parse(run.stdout) as Record<string, PyResult> : undefined;
  const failure = parsed ? '' : pythonFailure(run);
  return files.map(file => {
    const result = parsed?.[file];
    if (!result) return { file, definitions: [], imports: [], method: `not extracted: ${failure}` };
    if (result.error) return { file, definitions: [], imports: [], method: `not extracted: Python ast reported ${result.error}` };
    return { file, method: 'Python ast',
      definitions: (result.defs ?? []).map(([name, kind, line]) => ({ name, kind, line })),
      imports: pyImports(file, result.imports ?? [], ctx) };
  });
}

// ── Rust ───────────────────────────────────────────────────────────────────────────────────────────
// Module-level items only (no indentation), so methods inside impl blocks are not listed as items.
const RS_ITEM = /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe)\s+)*(?:extern\s+"[^"]*"\s+)?(fn|struct|enum|trait|mod|type|union)\s+([A-Za-z_]\w*)/;
const RS_MOD_DECL = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/;
const RS_USE_CRATE = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+crate::([A-Za-z_][\w:]*)/;

// Block comments become blank lines, so commented-out code is never read as an item or import.
const withoutBlockComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '));

// The crate root: the nearest ancestor holding lib.rs or main.rs. A file with none above it (a build
// script, an example) is its own crate, so `use crate::` in it resolves to nothing here.
function crateRoot(file: string, ctx: AdapterContext): string | undefined {
  for (let dir = posix.dirname(file); dir !== '.' && dir !== '/'; dir = posix.dirname(dir)) {
    const root = ['lib.rs', 'main.rs'].map(f => posix.join(dir, f)).find(f => ctx.has(f));
    if (root) return root;
  }
  return undefined;
}

// The directory a file's `mod x;` children live in: its own dir for a crate or module root (including a
// src/bin/*.rs binary root), else a dir named after the file.
const childDir = (file: string): string =>
  ['mod.rs', 'lib.rs', 'main.rs'].includes(basename(file)) || posix.basename(posix.dirname(file)) === 'bin'
    ? posix.dirname(file) : file.replace(/\.rs$/, '');

const declaresItem = (text: string, name: string): boolean =>
  text.split('\n').some(line => RS_ITEM.exec(line)?.[2] === name);

function rsImports(file: string, text: string, ctx: AdapterContext): string[] {
  const own = childDir(file);
  const root = crateRoot(file, ctx);
  return otherFiles(text.split('\n').flatMap(line => {
    const mod = RS_MOD_DECL.exec(line)?.[1];
    if (mod) return ctx.resolve([`${own}/${mod}.rs`, `${own}/${mod}/mod.rs`]);
    const path = RS_USE_CRATE.exec(line)?.[1];
    if (!path || !root) return [];
    const segs = path.split('::').filter(Boolean);
    for (let k = segs.length; k > 0; k--) {
      const base = posix.join(posix.dirname(root), ...segs.slice(0, k));
      const hit = ctx.resolve([`${base}.rs`, `${base}/mod.rs`]);
      if (hit.length) return hit;
    }
    // No module file: an item declared in the crate root itself, else nothing (never a guess).
    return declaresItem(withoutBlockComments(ctx.read(root)), segs[0]) ? [root] : [];
  }), file);
}

function rustFacts(files: string[], ctx: AdapterContext): FileFacts[] {
  return files.map(file => {
    const text = withoutBlockComments(ctx.read(file));
    const definitions = text.split('\n').flatMap((line, i): Definition[] => {
      const m = RS_ITEM.exec(line);
      return m ? [{ name: m[2], kind: m[1], line: i + 1 }] : [];
    });
    return { file, definitions, imports: rsImports(file, text, ctx), method: 'pattern match on Rust item lines' };
  });
}

// ── Ruby ───────────────────────────────────────────────────────────────────────────────────────────
const RB_DEF = /^\s*(module|class)\s+([A-Z][\w:]*)|^\s*(def)\s+(?:self\.)?([\w?!=]+)/;
const RB_REQUIRE = /^\s*(require_relative|require)\s*\(?\s*['"]([^'"]+)['"]/;

function rubyFacts(files: string[], ctx: AdapterContext): FileFacts[] {
  return files.map(file => {
    const lines = ctx.read(file).split('\n');
    const definitions = lines.flatMap((line, i): Definition[] => {
      const m = RB_DEF.exec(line);
      return m ? [{ name: m[2] ?? m[4], kind: m[1] ?? m[3], line: i + 1 }] : [];
    });
    const area = file.split('/')[0];
    const imports = otherFiles(lines.flatMap(line => {
      const m = RB_REQUIRE.exec(line);
      if (!m) return [];
      const target = m[2].replace(/\.rb$/, '');
      return m[1] === 'require_relative'
        ? ctx.resolve([`${posix.join(posix.dirname(file), target)}.rb`])
        // require searches $LOAD_PATH; lib/ is the conventional entry, the repo root is not.
        : ctx.resolve([`lib/${target}.rb`, `${area}/lib/${target}.rb`]);
    }), file);
    return { file, definitions, imports, method: 'pattern match on Ruby def/class/module lines' };
  });
}

// ── Dispatch ───────────────────────────────────────────────────────────────────────────────────────
export const BUILT_IN: LanguageAdapter[] = [
  { name: 'TypeScript', extensions: ['.ts', '.tsx', '.mts'], facts: typescriptFacts },
  { name: 'Python', extensions: ['.py'], facts: pythonFacts },
  { name: 'Rust', extensions: ['.rs'], facts: rustFacts },
  { name: 'Ruby', extensions: ['.rb'], facts: rubyFacts },
];
export const REPO_ADAPTERS = '.mind-meld/languages';

const isAdapter = (a: unknown): a is LanguageAdapter => {
  const x = a as Partial<LanguageAdapter> | null;
  return Boolean(x && typeof x.name === 'string' && Array.isArray(x.extensions) && typeof x.facts === 'function');
};

// The repo's own adapters come first, so a repo can also replace a built-in for an extension.
export async function loadAdapters(root: string): Promise<LanguageAdapter[]> {
  const dir = join(root, REPO_ADAPTERS);
  const files = existsSync(dir) ? readdirSync(dir).filter(f => /\.(ts|js|mjs)$/.test(f)).sort() : [];
  const repo = await Promise.all(files.map(async f => {
    const adapter = ((await import(pathToFileURL(join(dir, f)).href)) as { default?: unknown }).default;
    if (!isAdapter(adapter)) throw new Error(`${REPO_ADAPTERS}/${f}: default export needs name, extensions and facts()`);
    return adapter;
  }));
  return [...repo, ...BUILT_IN];
}

export const adapterFor = (file: string, adapters: LanguageAdapter[]): LanguageAdapter | undefined =>
  adapters.find(a => a.extensions.includes(extname(file)));

// An adapter's answer, held to the facts rule: only its own files, only imports of real repo files, and
// a stated reason for any file it skipped or failed on, so nothing vanishes or is invented.
async function adapterFacts(adapter: LanguageAdapter, files: string[], ctx: AdapterContext): Promise<FileFacts[]> {
  const missing = (method: string) => (file: string): FileFacts => ({ file, definitions: [], imports: [], method });
  let reported: FileFacts[];
  try { reported = await adapter.facts(files, ctx); }
  catch (error) { return files.map(missing(`not extracted: ${adapter.name} failed: ${(error as Error).message}`)); }
  const byFile = new Map(reported.filter(f => files.includes(f.file)).map(f => [f.file, f]));
  return files.map(file => {
    const facts = byFile.get(file);
    return facts ? { ...facts, imports: facts.imports.filter(i => ctx.has(i) && i !== file) }
      : missing(`not extracted: ${adapter.name} returned nothing`)(file);
  });
}

export async function languageFacts(root: string, files: string[], adapters: LanguageAdapter[]): Promise<ModuleFacts[]> {
  const repo = new Set(files);
  const texts = new Map<string, string>();
  const ctx: AdapterContext = {
    root,
    has: file => repo.has(file),
    read: file => texts.get(file) ?? texts.set(file, readFileSync(join(root, file), 'utf8')).get(file)!,
    resolve: candidates => {
      const hit = candidates.map(c => posix.normalize(c)).find(c => repo.has(c));
      return hit ? [hit] : [];
    },
  };
  const results = await Promise.all(adapters.map(async adapter => {
    const mine = files.filter(f => adapterFor(f, adapters) === adapter);
    const facts = mine.length ? await adapterFacts(adapter, mine, ctx) : [];
    return facts.map(f => ({ ...f, language: adapter.name, lines: lineCount(ctx.read(f.file)) }));
  }));
  return results.flat().sort((a, b) => a.file.localeCompare(b.file));
}
