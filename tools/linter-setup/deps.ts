import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { registry } from './registry.ts';

// Indentation of an existing JSON file, so we don't reflow the consumer's
// package.json. Falls back to two spaces.
function detectIndent(text) {
  const m = text.match(/\n([ \t]+)"/);
  return m ? m[1] : 2;
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
export function mergeDevDependencies(targetRepo, language) {
  const deps = registry[language]?.devDependencies;
  if (!deps) return { added: [], status: 'none' };

  const pkgPath = join(targetRepo, 'package.json');
  if (!existsSync(pkgPath)) return { added: [], status: 'no-package-json' };

  const raw = readFileSync(pkgPath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return { added: [], status: 'unparsable' };
  }

  const present = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);

  const devDeps = pkg.devDependencies ?? {};
  const added = [];
  for (const [name, range] of Object.entries(deps)) {
    if (present.has(name)) continue;
    devDeps[name] = range;
    added.push(name);
  }
  if (added.length === 0) return { added: [], status: 'satisfied' };

  pkg.devDependencies = devDeps;
  const trailingNL = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, detectIndent(raw)) + trailingNL);
  return { added, status: 'written' };
}

// Idempotently add a language's lint scripts (lint, lint:fix) to the target
// repo's package.json. Only fills in script names the repo hasn't already
// defined — never overwrites a consumer's own `lint` command. Returns the same
// { added, status } shape as mergeDevDependencies.
export function mergeScripts(targetRepo, language) {
  const scripts = registry[language]?.scripts;
  if (!scripts) return { added: [], status: 'none' };

  const pkgPath = join(targetRepo, 'package.json');
  if (!existsSync(pkgPath)) return { added: [], status: 'no-package-json' };

  const raw = readFileSync(pkgPath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return { added: [], status: 'unparsable' };
  }

  const existing = pkg.scripts ?? {};
  const added = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (name in existing) continue;
    existing[name] = command;
    added.push(name);
  }
  if (added.length === 0) return { added: [], status: 'satisfied' };

  pkg.scripts = existing;
  const trailingNL = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, detectIndent(raw)) + trailingNL);
  return { added, status: 'written' };
}
