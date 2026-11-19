// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/patch.ts
// Deterministic patch bumps: rewrite a `behind` pin to its line's latest patch, in place, touching only
// the version token on the finding's line. End-of-life findings are never patched: moving to another
// release line can break things and needs an owner decision. Pure; imports only sibling modules.

import type { Finding } from './versions.ts';

export interface Patch { file: string; line: number; from: string; to: string; }

export const planPatches = (findings: Finding[]): Patch[] => findings.flatMap(f =>
  f.kind === 'behind' ? [{ file: f.file, line: f.line, from: f.pinned, to: f.latest }] : []);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replaces `from` only as a whole version token: `3.4.1` never matches inside `3.4.12`.
function bumpLine(text: string, patch: Patch): string {
  const token = new RegExp(`(^|[^0-9.])${escapeRegExp(patch.from)}(?![0-9.])`);
  return text.replace(token, (_match, before: string) => `${before}${patch.to}`);
}

// `patches` are for one file; line numbers are 1-based. Line endings are preserved. `applied` lists only
// the patches that changed their line, so a pin that moved is never reported as patched.
export function applyPatches(content: string, patches: Patch[]): { content: string; applied: Patch[] } {
  const lines = content.split('\n');
  const applied = patches.filter(patch => {
    const before = lines[patch.line - 1] ?? '';
    lines[patch.line - 1] = bumpLine(before, patch);
    return lines[patch.line - 1] !== before;
  });
  return { content: lines.join('\n'), applied };
}
