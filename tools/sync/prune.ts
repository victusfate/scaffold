// Orphan prune engine — diffs the previous ledger against the current managed
// set and decides each orphan's fate under three safety gates: .scaffold-keep
// release, pristine-hash check, and opt-in deletion (--prune). Returns the
// per-orphan results plus the ledger to persist next.

import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { hashContent, type Ledger } from './ledger.ts';
import type { KeepMatcher } from '../lib/safe-write.ts';

export interface PruneResult {
  path: string;
  // pruned | would-prune | orphan | orphan-modified | orphan-kept | orphan-gone
  status: string;
}

export interface PruneInput {
  destRoot: string;
  owned: Ledger;     // path -> hash of files scaffold owns now (the managed set)
  previous: Ledger;  // the previous run's ledger
  kept: KeepMatcher; // .scaffold-keep matcher
  check: boolean;    // dry run — report only, write nothing
  prune: boolean;    // actually delete pristine orphans (ignored under check)
}

/**
 * Compute orphans (previous-ledger paths no longer in the managed set) and,
 * outside check mode with --prune, delete the pristine ones. The returned
 * nextLedger starts from the managed set and retains every un-deleted orphan
 * so it keeps being flagged on later syncs (design D4).
 */
export function computePrune(input: PruneInput): { results: PruneResult[]; nextLedger: Ledger } {
  const { destRoot, owned, previous, kept, check, prune } = input;
  const results: PruneResult[] = [];
  const nextLedger: Ledger = new Map(owned);

  for (const [relPath, prevHash] of previous) {
    if (owned.has(relPath)) continue; // still shipped — not an orphan

    // Gate 1: released to the consumer via .scaffold-keep.
    if (kept(relPath)) {
      results.push({ path: relPath, status: 'orphan-kept' });
      continue; // dropped from nextLedger
    }

    const abs = join(destRoot, relPath);
    if (!existsSync(abs)) {
      results.push({ path: relPath, status: 'orphan-gone' });
      continue; // dropped from nextLedger
    }

    // Gate 2: pristine check — never auto-delete consumer-edited files.
    if (hashContent(readFileSync(abs, 'utf8')) !== prevHash) {
      results.push({ path: relPath, status: 'orphan-modified' });
      nextLedger.set(relPath, prevHash); // retain — keep flagging it
      continue;
    }

    // Gate 3: deletion is opt-in.
    if (check) {
      results.push({ path: relPath, status: 'would-prune' });
      nextLedger.set(relPath, prevHash); // check persists nothing, but stay honest
      continue;
    }
    if (prune) {
      rmSync(abs);
      results.push({ path: relPath, status: 'pruned' }); // dropped from nextLedger
      continue;
    }
    results.push({ path: relPath, status: 'orphan' });
    nextLedger.set(relPath, prevHash); // retain until pruned
  }

  return { results, nextLedger };
}
