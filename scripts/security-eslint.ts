#!/usr/bin/env node
/**
 * security-eslint.ts — the security ESLint config, and a runner the security scan uses on changed JS/TS files
 * (docs/security-review.md). Part of the gate: exported from origin/main with the rest of GATE_FILES.
 *
 *   node scripts/security-eslint.ts [--tuning <file.json>] -- <file...>
 *
 * Run from the repo root. ESLint, typescript-eslint, eslint-plugin-security and eslint-plugin-no-unsanitized are
 * loaded from THAT repo's installed node_modules (devDependencies; `npm ci`), not from this file's location, so
 * the gate's exported copy works. The config is built in code and handed to the ESLint API (no config file is
 * looked up, so a branch's eslint.config.* is never loaded), with inline `eslint-disable` comments ignored.
 * Prints JSON [{file, line, rule, msg}] for every error-severity message (fatal parse errors as rule "parse").
 * Exit 0 ran (with or without findings), 2 ESLint or a plugin missing / crashed.
 *
 * Tuning: an optional JSON file `{ "rules": { "<rule>": "off" | "error" }, "ignores": ["<glob>"] }`
 * (the scan passes security/eslint-tuning.json from origin/main) is applied last.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT_ERROR = 2;
const SEVERITY_ERROR = 2;

/** High-signal eslint-plugin-security rules that gate a merge. */
export const SECURITY_RULES = ['detect-buffer-noassert', 'detect-child-process', 'detect-disable-mustache-escape',
  'detect-eval-with-expression', 'detect-new-buffer', 'detect-no-csrf-before-method-override', 'detect-non-literal-require',
  'detect-pseudoRandomBytes', 'detect-unsafe-regex', 'detect-bidi-characters', 'detect-invisible-characters',
  'detect-possible-timing-attacks'];
/** Rules from the plugin's recommended set left off: they flag most ordinary code (Semgrep and the review cover it). */
export const NOISY_RULES = ['detect-non-literal-fs-filename', 'detect-non-literal-regexp', 'detect-object-injection'];
/** typescript-eslint type-aware rules that gate a merge on TypeScript files. */
export const TYPED_RULES = ['no-unsafe-assignment', 'no-unsafe-call', 'no-unsafe-member-access', 'no-unsafe-return',
  'no-unsafe-argument', 'no-floating-promises', 'no-implied-eval'];

export interface Tuning { rules?: Record<string, string>; ignores?: string[] }

const errors = (prefix: string, names: string[]) => Object.fromEntries(names.map(n => [`${prefix}${n}`, 'error']));
const offs = (prefix: string, names: string[]) => Object.fromEntries(names.map(n => [`${prefix}${n}`, 'off']));

interface Plugins { security: unknown; noUnsanitized: unknown; tseslint: { parser: unknown; plugin: unknown } }

/** The security config as ESLint flat-config objects. */
export function securityConfig(p: Plugins, root: string, tuning: Tuning = {}): object[] {
  return [
    { ignores: ['**/node_modules/**', ...(tuning.ignores ?? [])] },
    {
      files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
      plugins: { security: p.security, 'no-unsanitized': p.noUnsanitized },
      rules: { ...errors('security/', SECURITY_RULES), ...offs('security/', NOISY_RULES),
        'no-unsanitized/method': 'error', 'no-unsanitized/property': 'error', 'no-eval': 'error', 'no-new-func': 'error' },
    },
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      languageOptions: { parser: p.tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: root } },
      plugins: { '@typescript-eslint': p.tseslint.plugin },
      rules: errors('@typescript-eslint/', TYPED_RULES),
    },
    { rules: tuning.rules ?? {} },
  ];
}

/** Imports a package installed in `root`'s node_modules. */
async function fromRepo<T>(root: string, name: string): Promise<T> {
  const req = createRequire(join(root, 'package.json'));
  return await import(pathToFileURL(req.resolve(name)).href) as T;
}

interface LintMessage { ruleId: string | null; line?: number; severity: number; message: string; fatal?: boolean }
interface ESLintCtor { new (o: object): { lintFiles(files: string[]): Promise<{ filePath: string; messages: LintMessage[] }[]> } }

async function lint(root: string, files: string[], tuning: Tuning): Promise<{ file: string; line: number; rule: string; msg: string }[]> {
  const { ESLint } = await fromRepo<{ ESLint: ESLintCtor }>(root, 'eslint');
  const unwrap = (m: { default?: unknown }) => m.default ?? m;
  const plugins: Plugins = {
    security: unwrap(await fromRepo(root, 'eslint-plugin-security')),
    noUnsanitized: unwrap(await fromRepo(root, 'eslint-plugin-no-unsanitized')),
    tseslint: unwrap(await fromRepo(root, 'typescript-eslint')) as Plugins['tseslint'],
  };
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: securityConfig(plugins, root, tuning),
    allowInlineConfig: false, warnIgnored: false, errorOnUnmatchedPattern: false });
  const results = await eslint.lintFiles(files);
  return results.flatMap(r => r.messages.filter(m => m.severity === SEVERITY_ERROR || m.fatal).map(m => ({
    file: r.filePath.startsWith(`${root}/`) ? r.filePath.slice(root.length + 1) : r.filePath,
    line: m.line ?? 0, rule: m.ruleId ?? 'parse', msg: m.message })));
}

async function main(argv: string[]): Promise<void> {
  const sep = argv.indexOf('--');
  const opts = sep < 0 ? argv : argv.slice(0, sep);
  const files = sep < 0 ? [] : argv.slice(sep + 1);
  const ti = opts.indexOf('--tuning');
  const tuningFile = ti >= 0 ? opts[ti + 1] : '';
  const tuning = tuningFile && existsSync(tuningFile) ? JSON.parse(readFileSync(tuningFile, 'utf8')) as Tuning : {};
  console.log(JSON.stringify(files.length ? await lint(process.cwd(), files, tuning) : []));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main(process.argv.slice(2)).catch((e: unknown) => { console.error(`security-eslint: ${String(e)}`); process.exit(EXIT_ERROR); });
}
