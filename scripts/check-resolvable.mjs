#!/usr/bin/env node
// check-resolvable.mjs — strict compliance linter for the skill engine.
//
//   node scripts/check-resolvable.mjs            # lint (DRY/MECE-soft as warnings)
//   node scripts/check-resolvable.mjs --strict   # promote DRY warnings to errors
//   node scripts/check-resolvable.mjs --quiet     # errors only
//
// Reads .claude/skills/RESOLVER.md and skills/<slug>.md canonical files and
// enforces: Reachability, Ambiguity, DRY, MECE, Cursor parity, Antigravity parity,
// Wrapper integrity, and Scaffold-sync. Exits non-zero on any error so it can gate a pre-commit hook.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, '.claude', 'skills');
const RESOLVER = join(SKILLS_DIR, 'RESOLVER.md');
const MANIFEST = join(ROOT, '.github', 'scaffold-files.txt');
const CURSOR_RULES = join(ROOT, '.cursor', 'rules');
const ANTIGRAVITY_SKILLS = join(ROOT, '.agents', 'skills');
const ANTIGRAVITY_WORKFLOWS = join(ROOT, '.agent', 'workflows');

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

const manifestSet = new Set(
  existsSync(MANIFEST)
    ? readFileSync(MANIFEST, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    : []
);
const listedInManifest = (p) => manifestSet.has(p);

// Split a markdown table row into cells, treating pipe characters inside
// backtick spans as content (not separators). This lets regex cells like
// `/(?:foo|bar)/i` use raw `|` for alternation without escaping.
// Outside backtick spans, all `|` are cell separators.
// `\|` inside a backtick cell is still unescaped to `|` by compileCell,
// so existing escaped patterns remain valid.
function splitRow(row) {
  const cells = [];
  let current = '';
  let inBacktick = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '`') {
      inBacktick = !inBacktick;
      current += ch;
    } else if (ch === '|' && !inBacktick) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) cells.push(current.trim());
  return cells.filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
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
      if (inTable && line.trim() !== '') break; // table ended (blank rows are skipped)
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
  for (let i = 0; i < compiled.length; i++) {
    const r = compiled[i];
    const invocation = `/${r.skill}`;
    if (!r.re.test(invocation)) {
      fail('Ambiguity', `'${r.skill}' regex does not match its own invocation '${invocation}'`);
    }
    for (let j = i + 1; j < compiled.length; j++) {
      const other = compiled[j];
      if (other.re.test(invocation)) {
        fail('Ambiguity', `routing collision: '${invocation}' also matches '${other.skill}' regex`);
      }
      if (r.re.test(`/${other.skill}`)) {
        fail('Ambiguity', `routing collision: '/${other.skill}' also matches '${r.skill}' regex`);
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

// Phase 5 — Wrapper integrity: harness wrappers must reference the canonical.
// Claude and Cursor use @-include syntax (resolved by their respective parsers).
// Antigravity bodies are literal Markdown — no include resolution — so they use
// a standard Markdown link with an explicit read instruction instead.
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
    // Antigravity: body is literal Markdown; check for a Markdown link to the canonical path.
    const antigravitySkill = join(ANTIGRAVITY_SKILLS, r.skill, 'SKILL.md');
    if (existsSync(antigravitySkill)) {
      const src = readFileSync(antigravitySkill, 'utf8');
      if (!src.includes(`../../../${expectedCanonical}`)) {
        fail('Wrapper', `Antigravity skill for '${r.skill}' must contain a Markdown link to '../../../${expectedCanonical}' — edit skills/${r.skill}.md, not the wrapper`);
      }
    }
    const antigravityWorkflow = join(ANTIGRAVITY_WORKFLOWS, `${r.skill}.md`);
    if (existsSync(antigravityWorkflow)) {
      const src = readFileSync(antigravityWorkflow, 'utf8');
      if (!src.includes(`../../${expectedCanonical}`)) {
        fail('Wrapper', `Antigravity workflow for '${r.skill}' must contain a Markdown link to '../../${expectedCanonical}' — edit skills/${r.skill}.md, not the wrapper`);
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
      fail('Cursor', `.cursor/rules/${r.skill}.mdc not in scaffold manifest — won't sync downstream`);
    }
  }
}

// Phase 7b — Antigravity parity: every skill must have both an Antigravity skill
// wrapper and a workflow file so it's available in Google Antigravity.
function phaseAntigravityParity(rows) {
  for (const r of rows) {
    const skillFile = join(ANTIGRAVITY_SKILLS, r.skill, 'SKILL.md');
    if (!existsSync(skillFile)) {
      fail('Antigravity', `'${r.skill}' has no Antigravity skill at ${rel(skillFile)}`);
    } else if (!listedInManifest(`.agents/skills/${r.skill}/SKILL.md`)) {
      fail('Antigravity', `.agents/skills/${r.skill}/SKILL.md not in scaffold manifest — won't sync downstream`);
    }
    const workflowFile = join(ANTIGRAVITY_WORKFLOWS, `${r.skill}.md`);
    if (!existsSync(workflowFile)) {
      fail('Antigravity', `'${r.skill}' has no Antigravity workflow at ${rel(workflowFile)}`);
    } else if (!listedInManifest(`.agent/workflows/${r.skill}.md`)) {
      fail('Antigravity', `.agent/workflows/${r.skill}.md not in scaffold manifest — won't sync downstream`);
    }
  }
}

// Phase 8 — Frontmatter parity: every per-harness form must carry the same
// description as the Claude form (spec §4: keep emitted descriptions in sync
// by hand until the generator ships). Normalized-whitespace comparison.
function frontmatterDescription(file) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1].split('\n');
  for (let i = 0; i < fm.length; i++) {
    const line = fm[i];
    if (!line.startsWith('description:')) continue;
    const inline = line.slice('description:'.length).trim();
    if (inline && inline !== '|' && inline !== '>') return inline;
    // block scalar — collect indented continuation lines
    const parts = [];
    for (let j = i + 1; j < fm.length && /^\s+\S/.test(fm[j]); j++) parts.push(fm[j].trim());
    return parts.join(' ');
  }
  return null;
}

const normWs = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

function phaseFrontmatterParity(rows) {
  for (const r of rows) {
    const claudeWrapper = join(SKILLS_DIR, r.skill, 'SKILL.md');
    if (!existsSync(claudeWrapper)) continue; // Reachability already failed it
    const claudeDesc = normWs(frontmatterDescription(claudeWrapper));
    if (!claudeDesc) {
      fail('Parity', `'${r.skill}' Claude wrapper has no frontmatter description`);
      continue;
    }
    const forms = [
      join(CURSOR_RULES, `${r.skill}.mdc`),
      join(ANTIGRAVITY_SKILLS, r.skill, 'SKILL.md'),
      join(ANTIGRAVITY_WORKFLOWS, `${r.skill}.md`),
    ];
    for (const f of forms) {
      if (!existsSync(f)) continue; // parity phases 6/7b already failed it
      const desc = normWs(frontmatterDescription(f));
      if (desc !== claudeDesc) {
        fail('Parity', `'${r.skill}' description drift in ${rel(f)} — sync it with the Claude form`);
      }
    }
  }
}

// Phase 7 — Scaffold-sync: every registered skill must propagate upstream.
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
  phaseAntigravityParity(rows);
  phaseFrontmatterParity(rows);
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
