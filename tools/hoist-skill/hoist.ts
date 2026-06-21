// hoist-skill engine — emit scaffold capabilities into a consumer repo.
// Importable on Node ≥22.18 (native TS type-stripping); the `run` CLI shim wraps this module.

import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { loadKeep, type WriteResult } from '../lib/safe-write.ts';
import { readManifest, upsertManifest } from './manifest.ts';
import { makeEmitters, type Capability, type Emitter } from './emitters.ts';
import { parseResolverRows, type ResolverRow } from '../lib/resolver-parse.ts';

export type Harness = 'claude' | 'cursor' | 'antigravity';

interface EmitPair {
  name: string;
  harness: Harness;
  ref?: string;
}

interface SourcePath {
  path: string;
  required: boolean;
  ref?: string;
}

export interface HoistOpts {
  names?: string;
  harness?: string;
  into?: string;
  force?: boolean;
  list?: boolean;
  ref?: string;
  refExplicit?: boolean;
  noRecord?: boolean;
  plan?: boolean;
  fetch?: boolean;
  fromManifest?: string | null;
  srcRoot?: string | null;
}

interface ListResult {
  capabilities: { name: string; purpose: string }[];
  harnesses: readonly string[];
}
interface PlanResult {
  ref: string;
  harness?: string;
  harnesses?: string[];
  sources: SourcePath[];
}
interface EmitOutcome {
  into: string;
  harnesses: string[];
  results: WriteResult[];
}
export type HoistResult = ListResult | PlanResult | EmitOutcome;

// Back-compat: `readManifest` moved to ./manifest.ts when this file was split.
// Consumer-vendored tools/sync/run.ts copies import it from here and are not
// refreshed by sync (run.ts is not in scaffold-files.txt), so re-export it to
// keep those copies resolving after they pull the new hoist.ts.
export { readManifest } from './manifest.ts';

const SCAFFOLD_ROOT = process.env.HOIST_SCAFFOLD_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESSES: readonly Harness[] = ['claude', 'cursor', 'antigravity'];
const TOOL_REL      = 'tools/hoist-skill/run';
const RESOLVER_REL  = '.claude/skills/RESOLVER.md';
const RAW_BASE      = process.env.HOIST_RAW_BASE
  ?? 'https://raw.githubusercontent.com/victusfate/scaffold';

// Temp dir created in --fetch mode; cleaned up on any exit path.
let _fetchTempDir: string | null = null;
process.on('exit', () => {
  if (_fetchTempDir) try { rmSync(_fetchTempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ---------------------------------------------------------------- source paths (for --plan and --fetch)

function capSourcePaths(cap: Capability, harness: Harness): SourcePath[] {
  const paths: SourcePath[] = [{ path: cap.path, required: true }];
  if (harness === 'claude') {
    paths.push({ path: `.claude/skills/${cap.name}/SKILL.md`, required: false });
  } else if (harness === 'cursor') {
    paths.push({ path: `.cursor/rules/${cap.name}.mdc`, required: false });
  } else if (harness === 'antigravity') {
    paths.push({ path: `.agents/skills/${cap.name}/SKILL.md`, required: false });
    paths.push({ path: `.agent/workflows/${cap.name}.md`, required: false });
  }
  return paths;
}

// ---------------------------------------------------------------- network fetch (--fetch mode)

async function fetchRaw(url: string, required = true): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) {
    if (required) throw new Error(`hoist-skill: fetch failed for ${url} (${res.status})`);
    return null;
  }
  return res.text();
}

// Look up a capability by name; throws if absent (callers pre-validate names).
function findCap(registry: ResolverRow[], name: string): Capability {
  const cap = registry.find(r => r.name === name);
  if (!cap) throw new Error(`hoist-skill: unknown capability ${name}`);
  return cap;
}

async function populateFetchRoot(tempDir: string, pairs: EmitPair[], registry: ResolverRow[], ref: string): Promise<void> {
  const written = new Set<string>();
  for (const { name, harness, ref: pairRef } of pairs) {
    const cap = findCap(registry, name);
    for (const { path: p, required } of capSourcePaths(cap, harness)) {
      if (written.has(p)) continue;
      const content = await fetchRaw(`${RAW_BASE}/${pairRef ?? ref}/${p}`, required);
      if (content === null) continue;
      const dest = join(tempDir, p);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content, 'utf8');
      written.add(p);
    }
  }
}

// ---------------------------------------------------------------- pre-check sources (pure-emit mode)

function checkLocalSources(pairs: EmitPair[], srcRoot: string, registry: ResolverRow[], ref: string): void {
  for (const { name } of pairs) {
    const cap = findCap(registry, name);
    const bodyAbs = join(srcRoot, cap.path);
    if (!existsSync(bodyAbs)) {
      throw new Error(
        `hoist-skill: missing source ${cap.path}\n` +
        `  (mirror it from ${RAW_BASE}/${ref}/${cap.path}, or run with --fetch)`
      );
    }
  }
}

// ---------------------------------------------------------------- emit-pair resolution

// Two paths produce the same EmitPair list — manifest replay vs. CLI args.
// Extracted so hoist() reads as a linear sequence of stages rather than a
// branching block that mixes validation with construction.
function resolveEmitPairs({
  fromManifestFlag, manifestReadPath, registry, rawNames, rawHarness, ref,
}: {
  fromManifestFlag: boolean;
  manifestReadPath: string;
  registry: ResolverRow[];
  rawNames: string;
  rawHarness: string;
  ref: string;
}): EmitPair[] {
  if (fromManifestFlag) {
    const entries = readManifest(manifestReadPath);
    if (!entries.length) throw new Error(`No entries found in manifest: ${manifestReadPath}`);
    const unknownNames     = entries.filter(e => !registry.find(r => r.name === e.name)).map(e => e.name);
    const unknownHarnesses = entries.filter(e => !(HARNESSES as readonly string[]).includes(e.harness)).map(e => e.harness);
    if (unknownNames.length)
      throw new Error(`Unknown capabilities in manifest: ${unknownNames.join(', ')}\nAvailable: ${registry.map(r => r.name).join(', ')}`);
    if (unknownHarnesses.length)
      throw new Error(`Unknown harnesses in manifest: ${unknownHarnesses.join(', ')}\nAvailable: ${HARNESSES.join(', ')}`);
    return entries.map(e => ({ name: e.name, harness: e.harness as Harness, ref: e.ref }));
  }

  const requestedNames = rawNames === 'all' ? registry.map(r => r.name) : rawNames.split(',').map(s => s.trim());
  const unknown = requestedNames.filter(n => !registry.find(r => r.name === n));
  if (unknown.length)
    throw new Error(`Unknown capabilities: ${unknown.join(', ')}\nAvailable: ${registry.map(r => r.name).join(', ')}`);
  const requestedHarnesses: Harness[] = rawHarness === 'all' ? [...HARNESSES] : [rawHarness as Harness];
  const badHarnesses = requestedHarnesses.filter(h => !HARNESSES.includes(h));
  if (badHarnesses.length)
    throw new Error(`Unknown harnesses: ${badHarnesses.join(', ')}\nAvailable: ${HARNESSES.join(', ')}`);
  const pairs: EmitPair[] = [];
  for (const name of requestedNames)
    for (const harness of requestedHarnesses)
      pairs.push({ name, harness, ref });
  return pairs;
}

// ---------------------------------------------------------------- hoist API

/**
 * Hoist scaffold capabilities into a consumer repo.
 * Returns the result object (same shape as the JSON previously printed to stdout).
 * Throws on fatal errors instead of calling process.exit().
 */
export async function hoist(opts: HoistOpts = {}): Promise<HoistResult> {
  const {
    names: rawNames     = 'all',
    harness: rawHarness = 'claude',
    into: intoRaw       = '.',
    force               = false,
    list: listMode      = false,
    ref                 = 'main',
    refExplicit         = false,
    noRecord            = false,
    plan: planMode      = false,
    fetch: fetchMode    = false,
    fromManifest        = null,   // path string or null (falsy = not using manifest)
    srcRoot: srcRootOpt = null,   // local scaffold tree override (mutually exclusive with fetch)
  } = opts;

  const INTO              = resolve(intoRaw);
  const manifestReadPath  = fromManifest ? resolve(fromManifest) : join(INTO, '.sync', 'hoisted');
  const manifestWritePath = join(INTO, '.sync', 'hoisted');
  const fromManifestFlag  = Boolean(fromManifest);

  let srcRoot = srcRootOpt ? resolve(srcRootOpt) : SCAFFOLD_ROOT;

  if (fetchMode) {
    // No Node-version guard here: this module is TypeScript run via native
    // type-stripping, so it only loads on Node ≥22.18 — well above fetch()'s
    // availability floor. The engines field + .npmrc enforce the minimum.
    _fetchTempDir = mkdtempSync(join(tmpdir(), 'hoist-skill-'));
    srcRoot = _fetchTempDir;
    const resolverContent = await fetchRaw(`${RAW_BASE}/${ref}/${RESOLVER_REL}`, true);
    if (resolverContent === null) throw new Error(`hoist-skill: could not fetch ${RESOLVER_REL}`);
    const resolverDest = join(srcRoot, RESOLVER_REL);
    mkdirSync(dirname(resolverDest), { recursive: true });
    writeFileSync(resolverDest, resolverContent, 'utf8');
  } else {
    const localResolver = join(srcRoot, RESOLVER_REL);
    if (!existsSync(localResolver)) {
      throw new Error(
        `hoist-skill: missing source ${RESOLVER_REL}\n` +
        `  (mirror it from ${RAW_BASE}/${ref}/${RESOLVER_REL}, or run with --fetch)`
      );
    }
  }

  const registry = parseResolverRows(join(srcRoot, RESOLVER_REL));

  if (listMode) {
    return {
      capabilities: registry.map(r => ({ name: r.name, purpose: r.purpose })),
      harnesses: HARNESSES,
    };
  }

  const emitPairs = resolveEmitPairs({ fromManifestFlag, manifestReadPath, registry, rawNames, rawHarness, ref });

  // Plan mode: output annotated sources list, no emit
  if (planMode) {
    const seen    = new Set<string>([TOOL_REL, RESOLVER_REL]);
    const sources: SourcePath[] = [
      { path: TOOL_REL,     required: true },
      { path: RESOLVER_REL, required: true },
    ];
    const uniqueHarnesses = [...new Set(emitPairs.map(p => p.harness))];

    for (const { name, harness, ref: pairRef } of emitPairs) {
      const cap = findCap(registry, name);
      const pRef = pairRef ?? ref;
      for (const s of capSourcePaths(cap, harness)) {
        if (!seen.has(s.path)) { seen.add(s.path); sources.push({ ...s, ref: pRef }); }
      }
    }

    const out: PlanResult = { ref, sources };
    if (uniqueHarnesses.length === 1) out.harness = uniqueHarnesses[0];
    else out.harnesses = uniqueHarnesses;
    return out;
  }

  // Fetch or pre-check required sources
  if (fetchMode) {
    await populateFetchRoot(srcRoot, emitPairs, registry, ref);
  } else {
    checkLocalSources(emitPairs, srcRoot, registry, ref);
  }

  // Emit
  const EMITTERS = makeEmitters(srcRoot, force);
  const kept     = loadKeep(INTO);
  const results: WriteResult[]  = [];

  for (const { name, harness } of emitPairs) {
    const cap = findCap(registry, name);
    console.error(`→ ${name} [${harness}]`);
    const emit: Emitter = EMITTERS[harness];
    emit(cap, INTO, kept, results);
  }

  // Record manifest — skip if replaying without an explicit --ref (nothing changed)
  if (!noRecord && (!fromManifestFlag || refExplicit)) {
    const writePath = fromManifestFlag ? manifestReadPath : manifestWritePath;
    const entries = emitPairs.map(({ name, harness, ref: r }) => ({
      name, harness, ref: refExplicit ? ref : (r ?? 'main'),
    }));
    upsertManifest(writePath, entries);
  }

  const usedHarnesses = [...new Set(emitPairs.map(p => p.harness))];
  return { into: INTO, harnesses: usedHarnesses, results };
}
