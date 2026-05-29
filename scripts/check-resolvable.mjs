#!/usr/bin/env node
// check-resolvable.mjs — strict compliance linter for the skill engine.
//
//   node scripts/check-resolvable.mjs            # lint (DRY/MECE-soft as warnings)
//   node scripts/check-resolvable.mjs --strict   # promote DRY warnings to errors
//   node scripts/check-resolvable.mjs --quiet     # errors only
//
// Reads .claude/skills/RESOLVER.md and skills/<slug>.md canonical files and
// enforces: Reachability, Ambiguity, DRY, MECE, Cursor parity, Wrapper integrity,
// and Scaffold-sync. Exits non-zero on any error so it can gate a pre-commit hook.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, '.claude', 'skills');
const RESOLVER = join(SKILLS_DIR, 'RESOLVER.md');
const MANIFEST = join(ROOT, '.github', 'scaffold-files.txt');
const CURSOR_RULES = join(ROOT, '.cursor', 'rules');

const argv = new Set(process.argv.slice(2));
const STRICT = argv.has('--strict');
const QUIET = argv.has('--quiet');

const errors = [];
const warnings = [];
const fail = (phase, msg) => errors.push(`[${phase}] ${msg}`);
const warn = (phase, msg) => warnings.push(`[${phase}] ${msg}`);

// ---------------------------------------------------------------- helpers

const rel = (p) => p.replace(ROOT + '/', '');

const STOPWORDS = new Set(
  'a an the to of and or as in on for with into via end md from this that'.split(' ')
);

// Tokenize prose into a deduped, stopword-free lowercase set.
function tokens(text) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

let _manifest = null;
function manifestSet() {
  if (_manifest) return _manifest;
  _manifest = new Set(
    existsSync(MANIFEST)
      ? readFileSync(MANIFEST, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
      : []
  );
  return _manifest;
}
const listedInManifest = (p) => manifestSet().has(p);

// Split a markdown table row on unescaped pipes only, then trim cells.
function splitRow(row) {
  return row
    .split(/(?<!\\)\|/)
    .map((c) => c.trim())
    .filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
}

// ---------------------------------------------------------------- parse RESOLVER

function parseResolver() {
  if (!existsSync(RESOLVER)) {
    fail('Parse', `RESOLVER.md not found at ${rel(RESOLVER)}`);
    return [];
  }
  const lines = readFileSync(RESOLVER, 'utf8').split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (!isRow) {
      if (inTable) break; // table ended
      continue;
    }
    const cells = splitRow(line);
    // header row + separator row (---) are skipped
    if (cells[0] === 'Skill') { inTable = true; continue; }
    if (/^-{2,}$/.test(cells[0]?.replace(/[:\s]/g, ''))) continue;
    if (!inTable) continue;
    if (cells.length < 4) { fail('Parse', `Malformed row: ${line.trim()}`); continue; }
    rows.push({
      skill: cells[0].replace(/`/g, ''),
      regexCell: cells[1],
      path: cells[2].replace(/`/g, ''),
      purpose: cells[3],
    });
  }
  if (rows.length === 0) fail('Parse', 'No skill rows found in RESOLVER.md table.');
  return rows;
}

// Turn a `/pattern/flags` cell (backtick-wrapped, table-escaped) into a RegExp.
function compileCell(cell, skill) {
  const raw = cell.replace(/`/g, '').trim();
  const m = raw.match(/^\/(.*)\/([a-z]*)$/s);
  if (!m) { fail('Parse', `${skill}: regex cell is not /pattern/flags → ${raw}`); return null; }
  const body = m[1].replace(/\\\|/g, '|'); // unescape table pipes back to alternation
  try {
    return new RegExp(body, m[2]);
  } catch (e) {
    fail('Parse', `${skill}: uncompilable regex (${e.message})`);
    return null;
  }
}

function anchorSlug(cell) {
  const raw = cell.replace(/`/g, '');
  const m = raw.match(/\^\\?\/([a-z0-9-]+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- disk

function skillDirsOnDisk() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((name) => {
      const p = join(SKILLS_DIR, name);
      return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'));
    });
}

// ---------------------------------------------------------------- phases

// Phase 1 — Reachability: canonical files ↔ resolver, both directions.
function phaseReachability(rows) {
  const registered = new Set(rows.map((r) => r.skill));
  // Every skill dir on disk must appear in RESOLVER
  for (const slug of skillDirsOnDisk()) {
    if (!registered.has(slug)) {
      fail('Reachability', `orphaned skill '${slug}' on disk but missing from RESOLVER.md`);
    }
  }
  for (const r of rows) {
    // Canonical file must exist
    if (!existsSync(join(ROOT, r.path))) {
      fail('Reachability', `'${r.skill}' canonical path ${r.path} not found`);
    }
    // Regex anchor must match slug
    if (anchorSlug(r.regexCell) !== r.skill) {
      fail('Reachability', `'${r.skill}' regex anchor '^/${anchorSlug(r.regexCell)}' must match its slug`);
    }
    // Claude wrapper must exist
    const claudeWrapper = join(SKILLS_DIR, r.skill, 'SKILL.md');
    if (!existsSync(claudeWrapper)) {
      fail('Reachability', `'${r.skill}' missing Claude wrapper at ${rel(claudeWrapper)}`);
    }
  }
}

// Phase 2 — Ambiguity: deterministic slash-command routing must be collision-free.
function phaseAmbiguity(rows) {
  const compiled = rows.map((r) => ({ ...r, re: compileCell(r.regexCell, r.skill) }))
                       .filter((r) => r.re);
  const seenAnchor = new Map();
  for (const r of compiled) {
    const a = anchorSlug(r.regexCell);
    if (seenAnchor.has(a)) {
      fail('Ambiguity', `duplicate anchor '^/${a}' shared by '${seenAnchor.get(a)}' and '${r.skill}'`);
    } else {
      seenAnchor.set(a, r.skill);
    }
  }
  for (const r of compiled) {
    const invocation = `/${r.skill}`;
    if (!r.re.test(invocation)) {
      fail('Ambiguity', `'${r.skill}' regex does not match its own invocation '${invocation}'`);
    }
    for (const other of compiled) {
      if (other.skill === r.skill) continue;
      if (other.re.test(invocation)) {
        fail('Ambiguity', `routing collision: '${invocation}' also matches '${other.skill}' regex`);
      }
    }
  }
}

// Phase 3 — DRY: blocks of identical prose duplicated across skills belong in lib/.
function phaseDry(rows) {
  const MIN_RUN = 3;          // consecutive identical lines
  const MIN_LEN = 20;         // ignore short/boilerplate lines
  const norm = (l) => l.trim();
  const meaningful = (l) => l.length >= MIN_LEN && !l.startsWith('#') && !/^[-*]\s*$/.test(l);

  const fileLines = rows
    .filter((r) => existsSync(join(ROOT, r.path)))
    .map((r) => ({ skill: r.skill, lines: readFileSync(join(ROOT, r.path), 'utf8').split('\n').map(norm) }));
  // DRY checks canonical files only — wrappers are intentionally minimal

  const blockOwners = new Map(); // block text → Set(skill)
  for (const { skill, lines } of fileLines) {
    for (let i = 0; i + MIN_RUN <= lines.length; i++) {
      const run = lines.slice(i, i + MIN_RUN);
      if (!run.every(meaningful)) continue;
      const key = run.join('\n');
      if (!blockOwners.has(key)) blockOwners.set(key, new Set());
      blockOwners.get(key).add(skill);
    }
  }
  for (const [block, owners] of blockOwners) {
    if (owners.size >= 2) {
      const msg = `duplicated block across {${[...owners].join(', ')}} — extract to lib/:\n    "${block.split('\n')[0]}…"`;
      STRICT ? fail('DRY', msg) : warn('DRY', msg);
    }
  }
}

// Phase 4 — MECE: two skills with near-identical purpose must merge via args.
function phaseMece(rows) {
  const THRESHOLD = 0.7;
  const sig = rows.map((r) => ({ skill: r.skill, t: tokens(r.purpose) }));
  for (let i = 0; i < sig.length; i++) {
    for (let j = i + 1; j < sig.length; j++) {
      const score = jaccard(sig[i].t, sig[j].t);
      if (score >= THRESHOLD) {
        fail('MECE', `'${sig[i].skill}' and '${sig[j].skill}' are not mutually exclusive ` +
          `(purpose similarity ${score.toFixed(2)}) — combine via parameterized args`);
      }
    }
  }
}

// Phase 5 — Wrapper integrity: harness wrappers must @-include the canonical.
function phaseWrapperIntegrity(rows) {
  for (const r of rows) {
    const expectedCanonical = `skills/${r.skill}.md`;
    const claudeWrapper = join(SKILLS_DIR, r.skill, 'SKILL.md');
    const cursorWrapper = join(CURSOR_RULES, `${r.skill}.mdc`);

    if (existsSync(claudeWrapper)) {
      const src = readFileSync(claudeWrapper, 'utf8');
      if (!src.includes(`@../../../${expectedCanonical}`)) {
        fail('Wrapper', `Claude wrapper for '${r.skill}' must contain '@../../../${expectedCanonical}' — edit skills/${r.skill}.md, not the wrapper`);
      }
    }
    if (existsSync(cursorWrapper)) {
      const src = readFileSync(cursorWrapper, 'utf8');
      if (!src.includes(`@../../${expectedCanonical}`)) {
        fail('Wrapper', `Cursor wrapper for '${r.skill}' must contain '@../../${expectedCanonical}' — edit skills/${r.skill}.md, not the wrapper`);
      }
    }
  }
}

// Phase 6 — Cursor parity: every skill must have a Cursor mirror so it's
// available to Cursor, not just Claude. Codex/Gemini read through AGENTS.md.
function phaseCursorParity(rows) {
  for (const r of rows) {
    const mirror = join(CURSOR_RULES, `${r.skill}.mdc`);
    if (!existsSync(mirror)) {
      fail('Cursor', `'${r.skill}' has no Cursor mirror at ${rel(mirror)}`);
    } else if (!listedInManifest(`.cursor/rules/${r.skill}.mdc`)) {
      warn('Cursor', `.cursor/rules/${r.skill}.mdc not in scaffold manifest — won't sync downstream`);
    }
  }
}

// Phase 6 — Scaffold-sync: every registered skill must propagate upstream.
function phaseScaffold(rows) {
  if (!existsSync(MANIFEST)) {
    fail('Scaffold', `manifest not found at ${rel(MANIFEST)}`);
    return;
  }
  for (const r of rows) {
    if (!listedInManifest(r.path)) {
      fail('Scaffold', `'${r.skill}' path ${r.path} not in scaffold manifest — won't sync downstream`);
    }
  }
  // RESOLVER + this script should also propagate; warn rather than block.
  for (const p of ['.claude/skills/RESOLVER.md', 'scripts/check-resolvable.mjs']) {
    if (!listedInManifest(p)) warn('Scaffold', `${p} not in scaffold manifest — consider adding it`);
  }
}

// ---------------------------------------------------------------- run

const rows = parseResolver();
if (rows.length) {
  phaseReachability(rows);
  phaseAmbiguity(rows);
  phaseDry(rows);
  phaseMece(rows);
  phaseWrapperIntegrity(rows);
  phaseCursorParity(rows);
  phaseScaffold(rows);
}

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
