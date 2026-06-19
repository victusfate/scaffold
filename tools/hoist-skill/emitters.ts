// Per-harness emitters for hoist-skill.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { safeWrite as sharedSafeWrite } from '../lib/safe-write.ts';

function safeWrite(dest, relPath, content, kept, results, force) {
  sharedSafeWrite(dest, relPath, content, kept, results, force, { log: console.error });
}

export function emitClaude(cap, dest, kept, results, srcRoot, force) {
  const bodyAbs = join(srcRoot, cap.path);
  safeWrite(dest, cap.path, readFileSync(bodyAbs, 'utf8'), kept, results, force);
  const wrapperRel = `.claude/skills/${cap.name}/SKILL.md`;
  const src = join(srcRoot, '.claude', 'skills', cap.name, 'SKILL.md');
  const content = existsSync(src)
    ? readFileSync(src, 'utf8')
    : `---\ndescription: ${cap.purpose}\n---\n\n@../../../${cap.path}\n`;
  safeWrite(dest, wrapperRel, content, kept, results, force);
}

export function emitCursor(cap, dest, kept, results, srcRoot, force) {
  const bodyAbs = join(srcRoot, cap.path);
  safeWrite(dest, cap.path, readFileSync(bodyAbs, 'utf8'), kept, results, force);
  const cursorRel = `.cursor/rules/${cap.name}.mdc`;
  const src = join(srcRoot, '.cursor', 'rules', `${cap.name}.mdc`);
  const content = existsSync(src)
    ? readFileSync(src, 'utf8')
    : `---\ndescription: ${cap.purpose}\n---\n\n@../../${cap.path}\n`;
  safeWrite(dest, cursorRel, content, kept, results, force);
}

export function emitAntigravity(cap, dest, kept, results, srcRoot, force) {
  const bodyAbs = join(srcRoot, cap.path);
  safeWrite(dest, cap.path, readFileSync(bodyAbs, 'utf8'), kept, results, force);

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

export function makeEmitters(srcRoot, force) {
  return {
    claude:      (cap, dest, kept, results) => emitClaude(cap, dest, kept, results, srcRoot, force),
    cursor:      (cap, dest, kept, results) => emitCursor(cap, dest, kept, results, srcRoot, force),
    antigravity: (cap, dest, kept, results) => emitAntigravity(cap, dest, kept, results, srcRoot, force),
  };
}
