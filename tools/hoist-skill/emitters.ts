// Per-harness emitters for hoist-skill.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { safeWrite as sharedSafeWrite, type KeepMatcher, type WriteResult } from '../lib/safe-write.ts';

// A skill capability resolved from RESOLVER.md, ready to emit per harness.
export interface Capability {
  name: string;
  path: string;
  purpose: string;
}

// An emitter writes a capability's files into dest, appending to results.
export type Emitter = (cap: Capability, dest: string, kept: KeepMatcher, results: WriteResult[]) => void;

export interface Emitters {
  claude: Emitter;
  cursor: Emitter;
  antigravity: Emitter;
}

function safeWrite(dest: string, relPath: string, content: string, kept: KeepMatcher, results: WriteResult[], force: boolean): void {
  sharedSafeWrite(dest, relPath, content, kept, results, force, { log: console.error });
}

// Every harness emitter starts by writing the shared skill body (skills/<name>.md).
// Extracted here because the three emitters are otherwise structurally different:
// claude/cursor each add one wrapper file; antigravity adds two (skill + workflow).
// A table-driven approach would need variable-length rows and wouldn't be clearer.
function writeBody(cap: Capability, dest: string, srcRoot: string, kept: KeepMatcher, results: WriteResult[], force: boolean): void {
  safeWrite(dest, cap.path, readFileSync(join(srcRoot, cap.path), 'utf8'), kept, results, force);
}

// Each emitter writes the body then one or more harness-specific wrappers.
// Wrappers are thin @-include stubs generated from cap.purpose when no
// curated version exists in the scaffold source tree.

export function emitClaude(cap: Capability, dest: string, kept: KeepMatcher, results: WriteResult[], srcRoot: string, force: boolean): void {
  writeBody(cap, dest, srcRoot, kept, results, force);
  const wrapperRel = `.claude/skills/${cap.name}/SKILL.md`;
  const src = join(srcRoot, '.claude', 'skills', cap.name, 'SKILL.md');
  const content = existsSync(src)
    ? readFileSync(src, 'utf8')
    : `---\ndescription: ${cap.purpose}\n---\n\n@../../../${cap.path}\n`;
  safeWrite(dest, wrapperRel, content, kept, results, force);
}

export function emitCursor(cap: Capability, dest: string, kept: KeepMatcher, results: WriteResult[], srcRoot: string, force: boolean): void {
  writeBody(cap, dest, srcRoot, kept, results, force);
  const cursorRel = `.cursor/rules/${cap.name}.mdc`;
  const src = join(srcRoot, '.cursor', 'rules', `${cap.name}.mdc`);
  const content = existsSync(src)
    ? readFileSync(src, 'utf8')
    : `---\ndescription: ${cap.purpose}\n---\n\n@../../${cap.path}\n`;
  safeWrite(dest, cursorRel, content, kept, results, force);
}

export function emitAntigravity(cap: Capability, dest: string, kept: KeepMatcher, results: WriteResult[], srcRoot: string, force: boolean): void {
  writeBody(cap, dest, srcRoot, kept, results, force);

  const agentSkillRel = `.agents/skills/${cap.name}/SKILL.md`;
  const agentSkillSrc = join(srcRoot, '.agents', 'skills', cap.name, 'SKILL.md');
  const agentSkillContent = existsSync(agentSkillSrc)
    ? readFileSync(agentSkillSrc, 'utf8')
    : `---\nname: ${cap.name}\ndescription: |\n  ${cap.purpose}\nlicense: MIT\nmetadata:\n  version: "1.0"\n---\n\nRead and follow the complete skill instructions in [\`${cap.path}\`](../../../${cap.path}).\n`;
  safeWrite(dest, agentSkillRel, agentSkillContent, kept, results, force);

  const workflowRel = `.agent/workflows/${cap.name}.md`;
  const workflowSrc = join(srcRoot, '.agent', 'workflows', `${cap.name}.md`);
  const workflowContent = existsSync(workflowSrc)
    ? readFileSync(workflowSrc, 'utf8')
    : `---\ndescription: ${cap.purpose}\n---\n\nRead and follow the complete skill instructions in [\`${cap.path}\`](../../${cap.path}).\n`;
  safeWrite(dest, workflowRel, workflowContent, kept, results, force);
}

export function makeEmitters(srcRoot: string, force: boolean): Emitters {
  return {
    claude:      (cap, dest, kept, results) => emitClaude(cap, dest, kept, results, srcRoot, force),
    cursor:      (cap, dest, kept, results) => emitCursor(cap, dest, kept, results, srcRoot, force),
    antigravity: (cap, dest, kept, results) => emitAntigravity(cap, dest, kept, results, srcRoot, force),
  };
}
