#!/usr/bin/env node
// check-resolvable.mjs — strict compliance linter for the skill engine.
//
//   node scripts/check-resolvable.mjs            # lint (DRY/MECE-soft as warnings)
//   node scripts/check-resolvable.mjs --strict   # promote DRY warnings to errors
//   node scripts/check-resolvable.mjs --quiet    # errors only

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResolverRows } from '../tools/lib/resolver-parse.ts';
import { execSync } from 'node:child_process';
import {
  phaseReachability, phaseAmbiguity, phaseDry, phaseMece,
  phaseWrapperIntegrity, phaseCursorParity, phaseAntigravityParity,
  phaseFrontmatterParity, phaseScaffold, phaseManifestCompleteness,
} from './resolver-phases.ts';

const ROOT              = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR        = join(ROOT, '.claude', 'skills');
const RESOLVER          = join(SKILLS_DIR, 'RESOLVER.md');
const MANIFEST          = join(ROOT, '.github', 'scaffold-files.txt');
const INTERNAL          = join(ROOT, '.github', 'scaffold-internal.txt');
const CURSOR_RULES      = join(ROOT, '.cursor', 'rules');
const ANTIGRAVITY_SKILLS    = join(ROOT, '.agents', 'skills');
const ANTIGRAVITY_WORKFLOWS = join(ROOT, '.agent', 'workflows');

const argv = new Set(process.argv.slice(2));
const STRICT = argv.has('--strict');
const QUIET  = argv.has('--quiet');

const errors = [], warnings = [];
const fail = (phase, msg) => errors.push(`[${phase}] ${msg}`);
const warn = (phase, msg) => warnings.push(`[${phase}] ${msg}`);

const rel = p => p.replace(ROOT + '/', '');

import { readFileSync } from 'node:fs';
const manifestSet = new Set(
  existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8').split('\n').map(l => l.trim()).filter(Boolean) : []
);
const listedInManifest = p => manifestSet.has(p);

const trackedFiles = (() => {
  try {
    return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return []; // not a git checkout — manifest completeness check no-ops
  }
})();

function skillDirsOnDisk() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR).filter(name => {
    const p = join(SKILLS_DIR, name);
    return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'));
  });
}

const rows = parseResolverRows(RESOLVER);
if (!existsSync(RESOLVER)) fail('Parse', `RESOLVER.md not found at ${rel(RESOLVER)}`);
else if (rows.length === 0) fail('Parse', 'No skill rows found in RESOLVER.md table.');

if (rows.length) {
  const ctx = {
    fail, warn, ROOT, STRICT, MANIFEST, SKILLS_DIR, CURSOR_RULES,
    ANTIGRAVITY_SKILLS, ANTIGRAVITY_WORKFLOWS,
    skillDirs: skillDirsOnDisk(),
    listedInManifest, rel,
  };
  phaseReachability(rows, ctx);
  phaseAmbiguity(rows, ctx);
  phaseDry(rows, ctx);
  phaseMece(rows, ctx);
  phaseWrapperIntegrity(rows, ctx);
  phaseCursorParity(rows, ctx);
  phaseAntigravityParity(rows, ctx);
  phaseFrontmatterParity(rows, ctx);
  phaseScaffold(rows, ctx);
}

// Manifest completeness is independent of RESOLVER parsing — run it always.
phaseManifestCompleteness(null, { fail, MANIFEST, INTERNAL, manifestSet, trackedFiles, rel });

if (!QUIET && warnings.length) {
  console.warn(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
}
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\nRESOLVER check FAILED.');
  process.exit(1);
}
console.log(`✓ RESOLVER check passed — ${rows.length} skills, ${warnings.length} warning(s).`);
