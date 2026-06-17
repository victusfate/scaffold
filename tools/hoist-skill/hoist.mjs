// hoist-skill engine — emit scaffold capabilities into a consumer repo.
// Importable on Node 18+; the `run` CLI shim wraps this module.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { loadKeep } from '../lib/safe-write.mjs';
import { readManifest, upsertManifest } from './manifest.mjs';
import { makeEmitters } from './emitters.mjs';
import { parseResolverRows } from '../lib/resolver-parse.mjs';

const SCAFFOLD_ROOT = process.env.HOIST_SCAFFOLD_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESSES     = ['claude', 'cursor', 'antigravity'];
const TOOL_REL      = 'tools/hoist-skill/run';
const RESOLVER_REL  = '.claude/skills/RESOLVER.md';
const RAW_BASE      = process.env.HOIST_RAW_BASE
  ?? 'https://raw.githubusercontent.com/victusfate/scaffold';

// Temp dir created in --fetch mode; cleaned up on any exit path.
let _fetchTempDir = null;
process.on('exit', () => {
  if (_fetchTempDir) try { rmSync(_fetchTempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ---------------------------------------------------------------- source paths (for --plan and --fetch)

function capSourcePaths(cap, harness) {
  const paths = [{ path: cap.path, required: true }];
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

async function fetchRaw(url, required = true) {
  const res = await fetch(url);
  if (!res.ok) {
    if (required) throw new Error(`hoist-skill: fetch failed for ${url} (${res.status})`);
    return null;
  }
  return res.text();
}

async function populateFetchRoot(tempDir, pairs, registry, ref) {
  const written = new Set();
  for (const { name, harness, ref: pairRef } of pairs) {
    const cap = registry.find(r => r.name === name);
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

function checkLocalSources(pairs, srcRoot, registry, ref) {
  for (const { name } of pairs) {
    const cap = registry.find(r => r.name === name);
    const bodyAbs = join(srcRoot, cap.path);
    if (!existsSync(bodyAbs)) {
      throw new Error(
        `hoist-skill: missing source ${cap.path}\n` +
        `  (mirror it from ${RAW_BASE}/${ref}/${cap.path}, or run with --fetch)`
      );
    }
  }
}

// ---------------------------------------------------------------- hoist API

/**
 * Hoist scaffold capabilities into a consumer repo.
 * Returns the result object (same shape as the JSON previously printed to stdout).
 * Throws on fatal errors instead of calling process.exit().
 */
export async function hoist(opts = {}) {
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
    if (Number(process.versions.node.split('.')[0]) < 18) {
      throw new Error(`hoist-skill: --fetch requires Node 18+ (current: ${process.version})`);
    }
    _fetchTempDir = mkdtempSync(join(tmpdir(), 'hoist-skill-'));
    srcRoot = _fetchTempDir;
    const resolverContent = await fetchRaw(`${RAW_BASE}/${ref}/${RESOLVER_REL}`, true);
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

  // Build emit pairs: [{ name, harness }]
  let emitPairs;

  if (fromManifestFlag) {
    const entries = readManifest(manifestReadPath);
    if (!entries.length) {
      throw new Error(`No entries found in manifest: ${manifestReadPath}`);
    }
    const unknownNames     = entries.filter(e => !registry.find(r => r.name === e.name)).map(e => e.name);
    const unknownHarnesses = entries.filter(e => !HARNESSES.includes(e.harness)).map(e => e.harness);
    if (unknownNames.length) {
      throw new Error(`Unknown capabilities in manifest: ${unknownNames.join(', ')}\nAvailable: ${registry.map(r => r.name).join(', ')}`);
    }
    if (unknownHarnesses.length) {
      throw new Error(`Unknown harnesses in manifest: ${unknownHarnesses.join(', ')}\nAvailable: ${HARNESSES.join(', ')}`);
    }
    emitPairs = entries.map(e => ({ name: e.name, harness: e.harness, ref: e.ref }));
  } else {
    const requestedNames = rawNames === 'all' ? registry.map(r => r.name) : rawNames.split(',').map(s => s.trim());
    const unknown = requestedNames.filter(n => !registry.find(r => r.name === n));
    if (unknown.length) {
      throw new Error(`Unknown capabilities: ${unknown.join(', ')}\nAvailable: ${registry.map(r => r.name).join(', ')}`);
    }
    const requestedHarnesses = rawHarness === 'all' ? HARNESSES : [rawHarness];
    const badHarnesses = requestedHarnesses.filter(h => !HARNESSES.includes(h));
    if (badHarnesses.length) {
      throw new Error(`Unknown harnesses: ${badHarnesses.join(', ')}\nAvailable: ${HARNESSES.join(', ')}`);
    }
    emitPairs = [];
    for (const name of requestedNames)
      for (const harness of requestedHarnesses)
        emitPairs.push({ name, harness, ref });
  }

  // Plan mode: output annotated sources list, no emit
  if (planMode) {
    const seen    = new Set([TOOL_REL, RESOLVER_REL]);
    const sources = [
      { path: TOOL_REL,     required: true },
      { path: RESOLVER_REL, required: true },
    ];
    const uniqueHarnesses = [...new Set(emitPairs.map(p => p.harness))];

    for (const { name, harness, ref: pairRef } of emitPairs) {
      const cap = registry.find(r => r.name === name);
      const pRef = pairRef ?? ref;
      for (const s of capSourcePaths(cap, harness)) {
        if (!seen.has(s.path)) { seen.add(s.path); sources.push({ ...s, ref: pRef }); }
      }
    }

    const out = { ref };
    if (uniqueHarnesses.length === 1) out.harness = uniqueHarnesses[0];
    else out.harnesses = uniqueHarnesses;
    out.sources = sources;
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
  const results  = [];

  for (const { name, harness } of emitPairs) {
    const cap = registry.find(r => r.name === name);
    console.error(`→ ${name} [${harness}]`);
    EMITTERS[harness](cap, INTO, kept, results);
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
