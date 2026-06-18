// Validation phases for check-resolvable.mjs.
// Each phase takes (rows, ctx) where ctx carries fail/warn and path constants.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileCell, anchorSlug, tokens, jaccard, frontmatterDescription, normalizeWhitespace } from './resolver-utils.mjs';

export function phaseReachability(rows, { fail, ROOT, SKILLS_DIR, skillDirs, rel }) {
  const registered = new Set(rows.map(r => r.name));
  for (const slug of skillDirs) {
    if (!registered.has(slug))
      fail('Reachability', `orphaned skill '${slug}' on disk but missing from RESOLVER.md`);
  }
  for (const r of rows) {
    if (!existsSync(join(ROOT, r.path)))
      fail('Reachability', `'${r.name}' canonical path ${r.path} not found`);
    if (anchorSlug(r.regexCell) !== r.name)
      fail('Reachability', `'${r.name}' regex anchor '^/${anchorSlug(r.regexCell)}' must match its slug`);
    const claudeWrapper = join(SKILLS_DIR, r.name, 'SKILL.md');
    if (!existsSync(claudeWrapper))
      fail('Reachability', `'${r.name}' missing Claude wrapper at ${rel(claudeWrapper)}`);
  }
}

export function phaseAmbiguity(rows, { fail }) {
  const compiled = rows.map(r => ({ ...r, re: compileCell(r.regexCell, r.name, fail) })).filter(r => r.re);
  const seenAnchor = new Map();
  for (const r of compiled) {
    const a = anchorSlug(r.regexCell);
    if (seenAnchor.has(a)) fail('Ambiguity', `duplicate anchor '^/${a}' shared by '${seenAnchor.get(a)}' and '${r.name}'`);
    else seenAnchor.set(a, r.name);
  }
  for (let i = 0; i < compiled.length; i++) {
    const r = compiled[i];
    const invocation = `/${r.name}`;
    if (!r.re.test(invocation)) fail('Ambiguity', `'${r.name}' regex does not match its own invocation '${invocation}'`);
    for (let j = i + 1; j < compiled.length; j++) {
      const other = compiled[j];
      if (other.re.test(invocation)) fail('Ambiguity', `routing collision: '${invocation}' also matches '${other.name}' regex`);
      if (r.re.test(`/${other.name}`)) fail('Ambiguity', `routing collision: '/${other.name}' also matches '${r.name}' regex`);
    }
  }
}

export function phaseDry(rows, { fail, warn, ROOT, STRICT }) {
  const MIN_RUN = 3;
  const MIN_LEN = 20;
  const norm = l => l.trim();
  const meaningful = l => l.length >= MIN_LEN && !l.startsWith('#') && !/^[-*]\s*$/.test(l);
  const fileLines = rows
    .filter(r => existsSync(join(ROOT, r.path)))
    .map(r => ({ skill: r.name, lines: readFileSync(join(ROOT, r.path), 'utf8').split('\n').map(norm) }));
  const blockOwners = new Map();
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

export function phaseMece(rows, { fail }) {
  const THRESHOLD = 0.7;
  const sig = rows.map(r => ({ name: r.name, t: tokens(r.purpose) }));
  for (let i = 0; i < sig.length; i++)
    for (let j = i + 1; j < sig.length; j++) {
      const score = jaccard(sig[i].t, sig[j].t);
      if (score >= THRESHOLD)
        fail('MECE', `'${sig[i].name}' and '${sig[j].name}' are not mutually exclusive (purpose similarity ${score.toFixed(2)}) — combine via parameterized args`);
    }
}

export function phaseWrapperIntegrity(rows, { fail, SKILLS_DIR, CURSOR_RULES, ANTIGRAVITY_SKILLS, ANTIGRAVITY_WORKFLOWS, rel }) {
  for (const r of rows) {
    const expected = `skills/${r.name}.md`;
    const check = (path, include) => {
      if (!existsSync(path)) return;
      if (!readFileSync(path, 'utf8').includes(include))
        fail('Wrapper', `${rel(path)} must contain '${include}' — edit skills/${r.name}.md, not the wrapper`);
    };
    check(join(SKILLS_DIR, r.name, 'SKILL.md'),              `@../../../${expected}`);
    check(join(CURSOR_RULES, `${r.name}.mdc`),               `@../../${expected}`);
    check(join(ANTIGRAVITY_SKILLS, r.name, 'SKILL.md'),      `../../../${expected}`);
    check(join(ANTIGRAVITY_WORKFLOWS, `${r.name}.md`),       `../../${expected}`);
  }
}

export function phaseCursorParity(rows, { fail, CURSOR_RULES, listedInManifest, rel }) {
  for (const r of rows) {
    const mirror = join(CURSOR_RULES, `${r.name}.mdc`);
    if (!existsSync(mirror)) fail('Cursor', `'${r.name}' has no Cursor mirror at ${rel(mirror)}`);
    else if (!listedInManifest(`.cursor/rules/${r.name}.mdc`))
      fail('Cursor', `.cursor/rules/${r.name}.mdc not in scaffold manifest — won't sync downstream`);
  }
}

export function phaseAntigravityParity(rows, { fail, ANTIGRAVITY_SKILLS, ANTIGRAVITY_WORKFLOWS, listedInManifest, rel }) {
  for (const r of rows) {
    const skillFile = join(ANTIGRAVITY_SKILLS, r.name, 'SKILL.md');
    if (!existsSync(skillFile)) fail('Antigravity', `'${r.name}' has no Antigravity skill at ${rel(skillFile)}`);
    else if (!listedInManifest(`.agents/skills/${r.name}/SKILL.md`))
      fail('Antigravity', `.agents/skills/${r.name}/SKILL.md not in scaffold manifest — won't sync downstream`);
    const workflowFile = join(ANTIGRAVITY_WORKFLOWS, `${r.name}.md`);
    if (!existsSync(workflowFile)) fail('Antigravity', `'${r.name}' has no Antigravity workflow at ${rel(workflowFile)}`);
    else if (!listedInManifest(`.agent/workflows/${r.name}.md`))
      fail('Antigravity', `.agent/workflows/${r.name}.md not in scaffold manifest — won't sync downstream`);
  }
}

export function phaseFrontmatterParity(rows, { fail, SKILLS_DIR, CURSOR_RULES, ANTIGRAVITY_SKILLS, ANTIGRAVITY_WORKFLOWS, rel }) {
  for (const r of rows) {
    const claudeWrapper = join(SKILLS_DIR, r.name, 'SKILL.md');
    if (!existsSync(claudeWrapper)) continue;
    const claudeDesc = normalizeWhitespace(frontmatterDescription(claudeWrapper));
    if (!claudeDesc) { fail('Parity', `'${r.name}' Claude wrapper has no frontmatter description`); continue; }
    for (const f of [
      join(CURSOR_RULES, `${r.name}.mdc`),
      join(ANTIGRAVITY_SKILLS, r.name, 'SKILL.md'),
      join(ANTIGRAVITY_WORKFLOWS, `${r.name}.md`),
    ]) {
      if (!existsSync(f)) continue;
      if (normalizeWhitespace(frontmatterDescription(f)) !== claudeDesc)
        fail('Parity', `'${r.name}' description drift in ${rel(f)} — sync it with the Claude form`);
    }
  }
}

export function phaseScaffold(rows, { fail, warn, MANIFEST, listedInManifest, rel }) {
  if (!existsSync(MANIFEST)) { fail('Scaffold', `manifest not found at ${rel(MANIFEST)}`); return; }
  for (const r of rows) {
    if (!listedInManifest(r.path))
      fail('Scaffold', `'${r.name}' path ${r.path} not in scaffold manifest — won't sync downstream`);
  }
  for (const p of ['.claude/skills/RESOLVER.md', 'scripts/check-resolvable.mjs']) {
    if (!listedInManifest(p)) warn('Scaffold', `${p} not in scaffold manifest — consider adding it`);
  }
}

// Mirrors the .scaffold-keep matcher in tools/lib/safe-write.mjs:loadKeep —
// exact path, dir prefix, or * glob (where * spans path separators).
function compileIgnore(patterns) {
  return (rel) => patterns.some(p => {
    if (p.includes('*')) {
      const re = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return re.test(rel);
    }
    return rel === p || rel.startsWith(p + '/');
  });
}

// Completeness guard for the sync manifest. Every tracked file must be either
// shipped (scaffold-files.txt) or held back (scaffold-internal.txt); every
// manifest entry must be a real tracked file and not also internal. This makes
// "ship unless ignored" the default, closing the "added a file but forgot the
// manifest" gap. Scaffold-only: keyed on the internal list, which never syncs,
// so consumer repos (which lack it) skip the check rather than flag their own
// files.
export function phaseManifestCompleteness(_rows, { fail, MANIFEST, INTERNAL, manifestSet, trackedFiles, rel }) {
  if (!existsSync(INTERNAL)) return; // not the scaffold repo — nothing to guard
  if (!existsSync(MANIFEST)) { fail('Manifest', `manifest not found at ${rel(MANIFEST)}`); return; }

  const patterns = readFileSync(INTERNAL, 'utf8')
    .split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
  const isInternal = compileIgnore(patterns);
  const tracked = new Set(trackedFiles);

  for (const f of trackedFiles) {
    if (!manifestSet.has(f) && !isInternal(f))
      fail('Manifest', `${f} is tracked but neither shipped (${rel(MANIFEST)}) nor held back (${rel(INTERNAL)}) — add it to one`);
  }
  for (const p of manifestSet) {
    if (!tracked.has(p))
      fail('Manifest', `${rel(MANIFEST)} lists ${p}, which is not a tracked file — remove or fix it`);
    else if (isInternal(p))
      fail('Manifest', `${p} is in both ${rel(MANIFEST)} and ${rel(INTERNAL)} — a file can't be shipped and held back`);
  }
}
