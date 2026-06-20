#!/usr/bin/env node
// sync — zero-local-code consumer sync for external scaffold consumers.
// Usage: npx github:victusfate/scaffold#<tag> sync [--into <path>] [--ref <ref>] [--check] [--force]

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePolicy } from './policy.ts';
import { promoteFiles } from './promote.ts';
import { readLedger, writeLedger, hashContent, type Ledger } from './ledger.ts';
import { computePrune } from './prune.ts';
import { hoist } from '../hoist-skill/hoist.ts';
import { readManifest } from '../hoist-skill/manifest.ts';
import { loadKeep, type WriteResult } from '../lib/safe-write.ts';
import { detect } from '../linter-setup/detect.ts';

const SCAFFOLD_ROOT = process.env.SYNC_SCAFFOLD_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
const has  = (flag: string): boolean => args.includes(flag);
const get  = (flag: string): string | null => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
// --scaffold-root=<path> form (for testing)
const getEq = (prefix: string): string | null => {
  const a = args.find(a => a.startsWith(prefix + '='));
  return a ? a.slice(prefix.length + 1) : null;
};

const intoRaw    = get('--into') ?? '.';
const refArg     = get('--ref');
const check      = has('--check');
const force      = has('--force');
const prune      = has('--prune');
const srcRootArg = getEq('--scaffold-root');
const srcRoot    = srcRootArg ? resolve(srcRootArg) : SCAFFOLD_ROOT;
const INTO       = resolve(intoRaw);

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const STATUS_PAD = 16;

// ---------------------------------------------------------------- prune

/**
 * Diff the managed set against the previous ledger, report orphans, delete the
 * pristine ones under --prune, and persist the next ledger (outside --check).
 *
 * The managed set is the policy-promoted files scaffold owns on disk: status
 * `written`/`unchanged` on a real sync, `would-write`/`unchanged` under --check
 * (where the dest file isn't written yet, so the hash recorded is irrelevant —
 * --check persists no ledger).
 */
function pruneOrphans(into: string, results: WriteResult[], check: boolean, prune: boolean): void {
  const ledgerPath = join(into, '.sync', 'managed');
  const owned: Ledger = new Map();
  for (const r of results) {
    if (check) {
      if (r.status === 'unchanged' || r.status === 'would-write') owned.set(r.path, '');
    } else if (r.status === 'written' || r.status === 'unchanged') {
      owned.set(r.path, hashContent(readFileSync(join(into, r.path), 'utf8')));
    }
  }

  const { results: pruneResults, nextLedger } = computePrune({
    destRoot: into, owned, previous: readLedger(ledgerPath), kept: loadKeep(into), check, prune,
  });
  for (const pr of pruneResults) {
    console.log(`  ${pr.status.padEnd(STATUS_PAD)} ${pr.path}`);
  }
  if (!check) writeLedger(ledgerPath, nextLedger);

  const modified = pruneResults.filter(r => r.status === 'orphan-modified');
  if (modified.length) {
    console.log('');
    for (const m of modified) console.log(`  warning: orphan kept (locally modified) — ${m.path}`);
  }

  const pending = pruneResults.filter(r => r.status === 'orphan' || r.status === 'would-prune');
  if (pending.length && !prune) {
    console.log('');
    console.log(`hint: ${pending.length} orphaned file(s) no longer shipped by scaffold — rerun with --prune to remove.`);
  }
}

// ---------------------------------------------------------- removed-files hint

/**
 * Flag paths scaffold removed upstream (renamed or deleted) that are still
 * present in the consumer repo. Reads `tools/sync/removed-files.tsv` from the
 * scaffold source and reports the gap the ledger can't see: removed paths on
 * disk that aren't in the current managed set and aren't already tracked by the
 * ledger (those are handled by the prune pass). Read-only guidance — never
 * deletes; the consumer reviews each, deletes it, or claims it via .scaffold-keep.
 */
function removedFilesHint(srcRoot: string, into: string, results: WriteResult[]): void {
  const manifestPath = join(srcRoot, 'tools', 'sync', 'removed-files.tsv');
  if (!existsSync(manifestPath)) return;

  const ownedNow = new Set(
    results.filter(r => r.status === 'written' || r.status === 'unchanged' || r.status === 'would-write').map(r => r.path),
  );
  const ledger = readLedger(join(into, '.sync', 'managed'));

  // Paths sync must never flag or touch downstream. `.pause/` is the consumer's
  // own pause/resume state — never scaffold's to manage — so skip it even if a
  // future manifest regeneration re-adds it from git history.
  const NEVER_DOWNSTREAM = ['.pause/'];

  const flagged: { path: string; replacement: string }[] = [];
  for (const line of readFileSync(manifestPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [removed, replacement] = line.split('\t');
    if (!removed) continue;
    if (NEVER_DOWNSTREAM.some(p => removed.startsWith(p))) continue;
    if (ownedNow.has(removed)) continue;        // re-added under the same path
    if (ledger.has(removed)) continue;          // prune pass already covers it
    if (!existsSync(join(into, removed))) continue; // consumer never had it / already gone
    flagged.push({ path: removed, replacement: replacement?.trim() || '-' });
  }
  if (!flagged.length) return;

  console.log('');
  console.log(`hint: ${flagged.length} file(s) removed upstream are still present here (not tracked by the ledger):`);
  for (const f of flagged) {
    console.log(`  ${f.path}${f.replacement !== '-' ? `  →  ${f.replacement}` : '  (removed)'}`);
  }
  console.log('  Review and delete, or add to .scaffold-keep to claim them.');
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
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
    console.error(`sync: invalid policy — ${errMsg(e)}`);
    process.exit(1);
  }

  const ref = refArg ?? policy.ref ?? 'main';

  // Print provenance before any writes. Files always come from the local
  // source tree (the npx package checkout, or --scaffold-root); only skill
  // hoisting resolves --ref. Name both so mixed-version syncs are visible.
  const pkg = JSON.parse(readFileSync(join(SCAFFOLD_ROOT, 'package.json'), 'utf8')) as { version?: string };
  const pkgVersion = pkg.version;
  const filesSrc = srcRootArg ? srcRoot : `package@${pkgVersion}`;
  console.log(`scaffold sync  files=${filesSrc}  skills-ref=${ref}  into=${INTO}${check ? '  (--check)' : ''}`);

  // File promotion
  const results = promoteFiles(policy, srcRoot, INTO, { check, force });

  // Print promotion summary
  for (const r of results) {
    console.log(`  ${r.status.padEnd(STATUS_PAD)} ${r.path}`);
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
        console.error(`sync: hoist failed — ${errMsg(e)}`);
        process.exit(1);
      }
    }
  }

  pruneOrphans(INTO, results, check, prune);
  removedFilesHint(srcRoot, INTO, results);

  const warnings = results.filter(r => r.status === 'guarded-skip');
  if (warnings.length) {
    console.log('');
    for (const w of warnings) {
      console.log(`  warning: guarded file skipped (marker absent) — ${w.path}`);
    }
  }

  console.log('');
  console.log(`done.${check ? ' (dry run — no files written)' : ''}`);

  // Suggest /add-linter for any detected language not yet using scaffold thresholds
  if (!check) {
    try {
      const langs = detect(INTO, srcRoot);
      const actionable = langs.filter(l => l.state !== 'scaffold');
      if (actionable.length > 0) {
        const names = actionable.map(l => l.language).join(', ');
        console.log('');
        console.log(`hint: languages detected without scaffold linter config: ${names}`);
        console.log('  Run /add-linter to add quality thresholds for each language.');
      }
    } catch {
      // non-fatal: skip hint if detect fails (e.g. not a git repo)
    }
  }
}

main().catch((e: unknown) => { console.error(`sync: ${errMsg(e)}`); process.exit(1); });
