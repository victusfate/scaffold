import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry, type Language } from './registry.ts';

// Content hash of a language's pristine scaffold template: first 12 hex chars of
// the sha256 over the template file's bytes. Returns null when the language has
// no config file, or the template is unreachable (graceful degradation — callers
// treat a null current-hash as "cannot determine staleness").
const HASH_PREFIX_LEN = 12;

export function templateHash(srcRoot: string, lang: Language): string | null {
  const entry = registry[lang];
  if (!entry?.configFile) return null;
  const tplPath = join(srcRoot, 'lib', 'linters', lang, entry.configFile);
  if (!existsSync(tplPath)) return null;
  return createHash('sha256').update(readFileSync(tplPath)).digest('hex').slice(0, HASH_PREFIX_LEN);
}
