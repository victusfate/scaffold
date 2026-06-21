// Validation phases for check-resolvable.ts.
// Each phase takes (rows, ctx) where ctx carries fail/warn and path constants.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileCell, anchorSlug, tokens, jaccard, frontmatterDescription, normalizeWhitespace, type Reporter } from './resolver-utils.ts';
import type { ResolverRow } from '../tools/lib/resolver-parse.ts';
import { compileKeepMatcher } from '../tools/lib/safe-write.ts';

// Shared context passed to every phase. Each phase destructures the subset it
// needs; collecting them in one type keeps the call sites in check-resolvable.ts
// honest about what each phase consumes.
export interface PhaseCtx {
  fail: Reporter;
  warn: Reporter;
  rel: (p: string) => string;
  ROOT: string;
  SKILLS_DIR: string;
  CURSOR_RULES: string;
  ANTIGRAVITY_SKILLS: string;
  ANTIGRAVITY_WORKFLOWS: string;
  MANIFEST: string;
  INTERNAL: string;
  STRICT: boolean;
  skillDirs: string[];
  bundledSkills: Set<string>;
  trackedFiles: string[];
  manifestSet: Set<string>;
  listedInManifest: (p: string) => boolean;
}

export function phaseReachability(rows: ResolverRow[], { fail, ROOT, SKILLS_DIR, skillDirs, bundledSkills, rel }: PhaseCtx): void {
  const registered = new Set(rows.map(r => r.name));
  for (const slug of skillDirs) {
    if (!registered.has(slug) && !bundledSkills.has(slug))
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

// Validate bundled (vendored, self-contained) skills. Each ships as a single
// .claude/skills/<slug>/ tree with its own SKILL.md frontmatter and is exempt
// from the canonical/@-include/multi-harness wrapper contract — so the only
// invariants are: the dir exists on disk, and SKILL.md carries a frontmatter
// `name` matching the slug plus a `description`. Their files are covered by the
// manifest-completeness phase like any other tracked file.
export function phaseBundled(_rows: ResolverRow[], { fail, SKILLS_DIR, skillDirs, bundledSkills, rel }: PhaseCtx): void {
  const onDisk = new Set(skillDirs);
  for (const slug of bundledSkills) {
    const skillMd = join(SKILLS_DIR, slug, 'SKILL.md');
    if (!onDisk.has(slug)) {
      fail('Bundled', `'${slug}' registered as bundled but ${rel(skillMd)} not found on disk`);
      continue;
    }
    const frontmatter = readFileSync(skillMd, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const name = frontmatter.match(/^name:\s*(.+?)\s*$/m)?.[1]?.replace(/['"]/g, '');
    if (!name) fail('Bundled', `${rel(skillMd)} missing frontmatter 'name:'`);
    else if (name !== slug)
      fail('Bundled', `${rel(skillMd)} frontmatter name '${name}' must equal dir '${slug}'`);
    if (!frontmatterDescription(skillMd))
      fail('Bundled', `${rel(skillMd)} missing frontmatter 'description:'`);
  }
}

export function phaseAmbiguity(rows: ResolverRow[], { fail }: PhaseCtx): void {
  const compiled = rows
    .map(r => ({ ...r, re: compileCell(r.regexCell, r.name, fail) }))
    .filter((r): r is ResolverRow & { re: RegExp } => r.re !== null);
  const seenAnchor = new Map<string | null, string>();
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

export function phaseDry(rows: ResolverRow[], { fail, warn, ROOT, STRICT }: PhaseCtx): void {
  // 3 consecutive meaningful lines is the minimum for intentional duplication:
  // a 1- or 2-line match fires on common phrases ("See also:", empty returns)
  // too often to be actionable. 3 lines is long enough to signal a real block.
  const MIN_RUN = 3;
  // Lines shorter than 20 chars are almost always structural (headings, bullets,
  // closing braces) rather than logic — filtering them keeps the duplicate
  // detector focused on actual content blocks.
  const MIN_LEN = 20;
  const norm = (l: string): string => l.trim();
  const meaningful = (l: string): boolean => l.length >= MIN_LEN && !l.startsWith('#') && !/^[-*]\s*$/.test(l);
  const fileLines = rows
    .filter(r => existsSync(join(ROOT, r.path)))
    .map(r => ({ skill: r.name, lines: readFileSync(join(ROOT, r.path), 'utf8').split('\n').map(norm) }));
  const blockOwners = new Map<string, Set<string>>();
  for (const { skill, lines } of fileLines) {
    for (let i = 0; i + MIN_RUN <= lines.length; i++) {
      const run = lines.slice(i, i + MIN_RUN);
      if (!run.every(meaningful)) continue;
      const key = run.join('\n');
      let owners = blockOwners.get(key);
      if (!owners) { owners = new Set(); blockOwners.set(key, owners); }
      owners.add(skill);
    }
  }
  for (const [block, owners] of blockOwners) {
    if (owners.size >= 2) {
      const msg = `duplicated block across {${[...owners].join(', ')}} — extract to lib/:\n    "${block.split('\n')[0]}…"`;
      if (STRICT) fail('DRY', msg); else warn('DRY', msg);
    }
  }
}

export function phaseMece(rows: ResolverRow[], { fail }: PhaseCtx): void {
  // 0.7 Jaccard on purpose-description tokens is the overlap point where two
  // skills are almost certainly describing the same intent. Below 0.7 the
  // similarity is incidental (shared domain vocabulary). Calibrated against the
  // current skill set: the closest legitimate pair scores ~0.45.
  const THRESHOLD = 0.7;
  const sig = rows.map(r => ({ name: r.name, t: tokens(r.purpose) }));
  for (let i = 0; i < sig.length; i++)
    for (let j = i + 1; j < sig.length; j++) {
      const score = jaccard(sig[i].t, sig[j].t);
      if (score >= THRESHOLD)
        fail('MECE', `'${sig[i].name}' and '${sig[j].name}' are not mutually exclusive (purpose similarity ${score.toFixed(2)}) — combine via parameterized args`);
    }
}

export function phaseWrapperIntegrity(rows: ResolverRow[], { fail, SKILLS_DIR, CURSOR_RULES, ANTIGRAVITY_SKILLS, ANTIGRAVITY_WORKFLOWS, rel }: PhaseCtx): void {
  for (const r of rows) {
    const expected = `skills/${r.name}.md`;
    const check = (path: string, include: string): void => {
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

export function phaseCursorParity(rows: ResolverRow[], { fail, CURSOR_RULES, listedInManifest, rel }: PhaseCtx): void {
  for (const r of rows) {
    const mirror = join(CURSOR_RULES, `${r.name}.mdc`);
    if (!existsSync(mirror)) fail('Cursor', `'${r.name}' has no Cursor mirror at ${rel(mirror)}`);
    else if (!listedInManifest(`.cursor/rules/${r.name}.mdc`))
      fail('Cursor', `.cursor/rules/${r.name}.mdc not in scaffold manifest — won't sync downstream`);
  }
}

export function phaseAntigravityParity(rows: ResolverRow[], { fail, ANTIGRAVITY_SKILLS, ANTIGRAVITY_WORKFLOWS, listedInManifest, rel }: PhaseCtx): void {
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

export function phaseFrontmatterParity(rows: ResolverRow[], { fail, SKILLS_DIR, CURSOR_RULES, ANTIGRAVITY_SKILLS, ANTIGRAVITY_WORKFLOWS, rel }: PhaseCtx): void {
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

export function phaseScaffold(rows: ResolverRow[], { fail, warn, MANIFEST, listedInManifest, rel }: PhaseCtx): void {
  if (!existsSync(MANIFEST)) { fail('Scaffold', `manifest not found at ${rel(MANIFEST)}`); return; }
  for (const r of rows) {
    if (!listedInManifest(r.path))
      fail('Scaffold', `'${r.name}' path ${r.path} not in scaffold manifest — won't sync downstream`);
  }
  for (const p of ['.claude/skills/RESOLVER.md', 'scripts/check-resolvable.ts']) {
    if (!listedInManifest(p)) warn('Scaffold', `${p} not in scaffold manifest — consider adding it`);
  }
}

const compileIgnore = compileKeepMatcher;

// Completeness guard for the sync manifest. Every tracked file must be either
// shipped (scaffold-files.txt) or held back (scaffold-internal.txt); every
// manifest entry must be a real tracked file and not also internal. This makes
// "ship unless ignored" the default, closing the "added a file but forgot the
// manifest" gap. Scaffold-only: keyed on the internal list, which never syncs,
// so consumer repos (which lack it) skip the check rather than flag their own
// files.
export function phaseManifestCompleteness(_rows: ResolverRow[], { fail, MANIFEST, INTERNAL, manifestSet, trackedFiles, rel }: PhaseCtx): void {
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
