#!/usr/bin/env node
// sync — zero-local-code consumer sync for external scaffold consumers.
// Usage: npx github:victusfate/scaffold#<tag> sync [--into <path>] [--ref <ref>] [--check] [--force]

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePolicy } from './policy.mjs';
import { promoteFiles } from './promote.mjs';
import { hoist, readManifest } from '../hoist-skill/hoist.mjs';

const SCAFFOLD_ROOT = process.env.SYNC_SCAFFOLD_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
const has  = (flag) => args.includes(flag);
const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
// --scaffold-root=<path> form (for testing)
const getEq = (prefix) => {
  const a = args.find(a => a.startsWith(prefix + '='));
  return a ? a.slice(prefix.length + 1) : null;
};

const intoRaw    = get('--into') ?? '.';
const refArg     = get('--ref');
const check      = has('--check');
const force      = has('--force');
const srcRootArg = getEq('--scaffold-root');
const srcRoot    = srcRootArg ? resolve(srcRootArg) : SCAFFOLD_ROOT;
const INTO       = resolve(intoRaw);

// ---------------------------------------------------------------- main

async function main() {
  const policyPath = join(INTO, '.sync', 'policy.yaml');
  if (!existsSync(policyPath)) {
    console.error(`sync: missing policy file at ${policyPath}`);
    console.error('  Create .sync/policy.yaml to configure file promotion rules.');
    process.exit(1);
  }

  let policy;
  try {
    policy = parsePolicy(readFileSync(policyPath, 'utf8'));
  } catch (e) {
    console.error(`sync: invalid policy — ${e.message}`);
    process.exit(1);
  }

  const ref = refArg ?? policy.ref ?? 'main';

  // Print provenance before any writes. Files always come from the local
  // source tree (the npx package checkout, or --scaffold-root); only skill
  // hoisting resolves --ref. Name both so mixed-version syncs are visible.
  const pkgVersion = JSON.parse(readFileSync(join(SCAFFOLD_ROOT, 'package.json'), 'utf8')).version;
  const filesSrc = srcRootArg ? srcRoot : `package@${pkgVersion}`;
  console.log(`scaffold sync  files=${filesSrc}  skills-ref=${ref}  into=${INTO}${check ? '  (--check)' : ''}`);

  // File promotion
  const results = promoteFiles(policy, srcRoot, INTO, { check, force });

  // Print promotion summary
  for (const r of results) {
    console.log(`  ${r.status.padEnd(16)} ${r.path}`);
  }

  // Skills hoisting — skip if manifest doesn't exist and no skills section configured
  const manifestPath = join(INTO, policy.skills.manifest);
  if (existsSync(manifestPath)) {
    if (check) {
      const entries = readManifest(manifestPath);
      console.log(`  would-replay     ${entries.length} skill(s) from ${policy.skills.manifest}`);
    } else {
      console.log('  hoisting skills from manifest...');
      try {
        // A local --scaffold-root serves both file promotion and hoisting; no network.
        await hoist({
          fetch: !srcRootArg,
          ...(srcRootArg ? { srcRoot } : {}),
          fromManifest: manifestPath, ref, into: INTO, refExplicit: Boolean(refArg), force,
        });
      } catch (e) {
        console.error(`sync: hoist failed — ${e.message}`);
        process.exit(1);
      }
    }
  }

  const warnings = results.filter(r => r.status === 'guarded-skip');
  if (warnings.length) {
    console.log('');
    for (const w of warnings) {
      console.log(`  warning: guarded file skipped (marker absent) — ${w.path}`);
    }
  }

  console.log('');
  console.log(`done.${check ? ' (dry run — no files written)' : ''}`);
}

main().catch(e => { console.error(`sync: ${e.message}`); process.exit(1); });
