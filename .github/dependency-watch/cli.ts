// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/cli.ts
// Shared CLI plumbing for runtime-check.ts and report.ts. Imports only node: builtins.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

export const todayIso = (): string => new Date().toISOString().slice(0, ISO_DATE_LENGTH);

// True when the module at `moduleUrl` was started directly (`node file.ts`), not imported.
// Node resolves symlinks for import.meta.url but not for argv[1], so compare real paths.
export function isEntryPoint(moduleUrl: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try { return pathToFileURL(realpathSync(script)).href === moduleUrl; } catch { return false; }
}
