#!/usr/bin/env node
// update-readme-skills.mjs — regenerate README.md skill sections from RESOLVER.md.
//
//   node scripts/update-readme-skills.mjs          # update README.md in place
//   node scripts/update-readme-skills.mjs --check  # exit 1 if README is stale (used by pre-commit)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESOLVER = join(ROOT, '.claude', 'skills', 'RESOLVER.md');
const README = join(ROOT, 'README.md');

const CHECK = process.argv.includes('--check');

// ---------------------------------------------------------------- parse RESOLVER

function splitRow(row) {
  const cells = [];
  let current = '';
  let inBacktick = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '`') { inBacktick = !inBacktick; current += ch; }
    else if (ch === '|' && !inBacktick) { cells.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  if (current.trim()) cells.push(current.trim());
  return cells.filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
}

function parseResolver() {
  const lines = readFileSync(RESOLVER, 'utf8').split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (!isRow) { if (inTable && line.trim() !== '') break; continue; }
    const cells = splitRow(line);
    if (cells[0] === 'Skill') { inTable = true; continue; }
    if (/^-{2,}$/.test(cells[0]?.replace(/[:\s]/g, ''))) continue;
    if (!inTable || cells.length < 4) continue;
    rows.push({ skill: cells[0].replace(/`/g, ''), purpose: cells[3] });
  }
  return rows;
}

// ---------------------------------------------------------------- generate sections

function pad(name, col) {
  return name + ' '.repeat(Math.max(2, col - name.length));
}

function generateInvocation(rows) {
  const list = rows.map(r => `\`/${r.skill}\``).join(', ');
  return `Skills can also be invoked individually: ${list}.`;
}

function generateStructure(rows) {
  // Compute alignment column per section (longest entry + 2 spaces before #)
  const col = (names) => Math.max(...names.map(n => n.length)) + 2;

  const claudeCol = col([...rows.map(r => `    ${r.skill}/SKILL.md`), '    RESOLVER.md']);
  const cursorCol = col([...rows.map(r => `    ${r.skill}.mdc`),      '    agents.mdc']);
  const agentSCol = col(rows.map(r => `    ${r.skill}/SKILL.md`));
  const agentWCol = col([...rows.map(r => `    ${r.skill}.md`),       '    agents.md']);

  const claudeSkills = rows.map(r =>
    `${pad(`    ${r.skill}/SKILL.md`, claudeCol)}# ${r.purpose}`
  ).join('\n');

  const cursorSkills = rows.map(r =>
    `${pad(`    ${r.skill}.mdc`, cursorCol)}# mirrors ${r.skill} for Cursor`
  ).join('\n');

  const agentSkills = rows.map(r =>
    `${pad(`    ${r.skill}/SKILL.md`, agentSCol)}# ${r.purpose}`
  ).join('\n');

  const agentWorkflows = rows.map(r =>
    `${pad(`    ${r.skill}.md`, agentWCol)}# ${r.purpose}`
  ).join('\n');

  return `\`\`\`
AGENTS.md                        # agent instructions — single source of truth
CLAUDE.md                        # imports AGENTS.md (@AGENTS.md)
GEMINI.md                        # references AGENTS.md
package.json                     # npm entry (bin/sync) — name, version, engines, test scripts
docs/
  agent-authoring-requirements.md  # normative spec for tools, scripts, skills, bin
bin/
  bootstrap.sh                   # one-time setup for downstream repos
  sync-from-scaffold.sh          # pull scaffold updates into a downstream repo
  sync                           # npx entrypoint → tools/sync/run.mjs
  install-skills.sh              # copy skills into a global dir (e.g. ~/.claude/skills)
  globalize-skill.sh             # promote one skill into a global dir, imports inlined
  repo-bound-skills.txt          # shared guard list for the two installers
tools/
  README.md                      # capability index (spec §2 registration)
  lib/
    safe-write.mjs               # shared clobber-safe write engine (sidecars, .scaffold-keep)
  hoist-skill/                   # tool: emit skills into a consumer repo (tool.yaml, run, hoist.mjs, test)
  sync/                          # tool: npx consumer sync (tool.yaml, run.mjs, policy.mjs, promote.mjs, test)
.claude/
  skills/
${pad('    RESOLVER.md', claudeCol)}# central routing table — skill → regex → path
${claudeSkills}
  session-start/
    hook.sh                      # SessionStart hook: fetches origin/main, warns if branch is behind
  read-once/
    hook.sh                      # PreToolUse hook: skips redundant file reads
    compact.sh                   # PostCompact hook: clears read cache after compaction
  settings.json                  # hook wiring (SessionStart, PreToolUse, PostCompact)
.cursor/
  rules/
${pad('    agents.mdc', cursorCol)}# thin pointer to AGENTS.md
${cursorSkills}
.agents/
  skills/
${agentSkills}
.agent/
  rules/
${pad('    agents.md', agentWCol)}# thin pointer to AGENTS.md (always-on)
  workflows/
${agentWorkflows}
scripts/
  check-resolvable.mjs           # RESOLVER linter (reachability/ambiguity/DRY/MECE/parity/sync)
  update-readme-skills.mjs       # regenerate README.md skill sections from RESOLVER.md
  compute-bump.mjs               # conventional-commit version bump (used by version-bump.yml)
  test-sync.sh                   # isolated tests for bin/sync-from-scaffold.sh
  test-bootstrap.sh              # isolated tests for bin/bootstrap.sh
.githooks/
  pre-commit                     # runs the linter and README freshness check — enable via core.hooksPath
.github/
  scaffold-files.txt             # manifest of files managed by scaffold
  workflows/
    ci.yml                       # verify (npm test) + integration jobs on PRs
    version-bump.yml             # post-merge version bump + tag on main
    sync-scaffold.yml            # manual workflow to sync updates via PR
.claudeignore                    # excludes build artifacts from Claude's context
\`\`\``;
}

// ---------------------------------------------------------------- replace markers

function replaceBetween(content, beginTag, endTag, replacement) {
  const begin = `<!-- ${beginTag} -->`;
  const end   = `<!-- ${endTag} -->`;
  const re = new RegExp(`${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}`, 'm');
  if (!re.test(content)) throw new Error(`Markers not found: ${begin} … ${end}`);
  return content.replace(re, `${begin}\n${replacement}\n${end}`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- main

if (!existsSync(RESOLVER)) { console.error(`RESOLVER.md not found at ${RESOLVER}`); process.exit(1); }
if (!existsSync(README))   { console.error(`README.md not found at ${README}`);   process.exit(1); }

const rows = parseResolver();
if (rows.length === 0) { console.error('No skill rows found in RESOLVER.md'); process.exit(1); }

let readme = readFileSync(README, 'utf8');
readme = replaceBetween(readme, 'BEGIN_SKILLS_INVOCATION', 'END_SKILLS_INVOCATION', generateInvocation(rows));
readme = replaceBetween(readme, 'BEGIN_SKILLS_STRUCTURE',  'END_SKILLS_STRUCTURE',  generateStructure(rows));

const original = readFileSync(README, 'utf8');
if (original === readme) {
  console.log(`✓ README.md skills sections are up to date — ${rows.length} skills.`);
  process.exit(0);
}

if (CHECK) {
  console.error(`✗ README.md skills sections are stale — run: node scripts/update-readme-skills.mjs`);
  process.exit(1);
}

writeFileSync(README, readme, 'utf8');
console.log(`✓ README.md updated — ${rows.length} skills written.`);
