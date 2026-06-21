import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry, type Language } from './registry.ts';

// The subset of package.json this tool reads and writes.
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export type MergeStatus =
  | 'none' | 'no-package-json' | 'unparsable' | 'satisfied' | 'written' | 'sidecar';

export interface MergeResult {
  added: string[];
  status: MergeStatus;
}

// Indentation of an existing JSON file, so we don't reflow the consumer's
// package.json. Falls back to two spaces.
function detectIndent(text: string): string | number {
  const m = text.match(/\n([ \t]+)"/);
  return m ? m[1] : 2;
}

type Section = 'devDependencies' | 'scripts';

// Shared merge engine: idempotently add entries to a package.json section.
// For devDependencies, also checks dependencies to avoid duplicates.
// Returns { added, status } — same shape for both public exports below.
function mergeInto(targetRepo: string, section: Section, entries: Record<string, string>): MergeResult {
  if (!entries || Object.keys(entries).length === 0) return { added: [], status: 'none' };
  const pkgPath = join(targetRepo, 'package.json');
  if (!existsSync(pkgPath)) return { added: [], status: 'no-package-json' };
  const raw = readFileSync(pkgPath, 'utf8');
  let pkg: PackageJson;
  try { pkg = JSON.parse(raw) as PackageJson; } catch { return { added: [], status: 'unparsable' }; }

  const present = section === 'devDependencies'
    ? new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
    : new Set(Object.keys(pkg.scripts ?? {}));

  const target = (pkg[section] ?? {}) as Record<string, string>;
  const added: string[] = [];
  for (const [name, val] of Object.entries(entries)) {
    if (present.has(name)) continue;
    target[name] = val;
    added.push(name);
  }
  if (added.length === 0) return { added: [], status: 'satisfied' };

  pkg[section] = target as never;
  const trailingNL = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, detectIndent(raw)) + trailingNL);
  return { added, status: 'written' };
}

// Idempotently add a language's shipped linter packages to the target repo's
// package.json devDependencies. Only fills in names absent from both
// dependencies and devDependencies — never changes a version the repo already
// pins. Existing key order is preserved; new keys are appended.
//
// Returns { added: string[], status } where status is one of:
//   'none'            — language declares no devDependencies
//   'no-package-json' — target has no package.json (nothing written)
//   'unparsable'      — package.json exists but is not valid JSON
//   'satisfied'       — every package already present (nothing written)
//   'written'         — added packages were written
export const mergeDevDependencies = (targetRepo: string, language: Language): MergeResult =>
  mergeInto(targetRepo, 'devDependencies', registry[language]?.devDependencies ?? {});

// Idempotently add a language's lint scripts (lint, lint:fix) to the target
// repo's package.json. Only fills in script names the repo hasn't already
// defined — never overwrites a consumer's own `lint` command. Returns the same
// { added, status } shape as mergeDevDependencies.
export const mergeScripts = (targetRepo: string, language: Language): MergeResult =>
  mergeInto(targetRepo, 'scripts', registry[language]?.scripts ?? {});
