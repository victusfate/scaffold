import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registry } from './registry.mjs';
import { templateHash } from './hash.mjs';

const DEFAULT_SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const extMap = new Map();
for (const [lang, entry] of Object.entries(registry)) {
  for (const ext of entry.extensions) extMap.set(ext, lang);
}

// Read the hash stamped into a config's marker line.
//   undefined → marker absent (foreign)
//   null      → marker present but unstamped (legacy — treated as current)
//   <hex>     → stamped hash
function stampedHash(content, marker) {
  const idx = content.indexOf(marker);
  if (idx === -1) return undefined;
  const nl = content.indexOf('\n', idx);
  const line = content.slice(idx, nl === -1 ? content.length : nl);
  const m = line.match(/sha256:([0-9a-f]+)/);
  return m ? m[1] : null;
}

export async function detect(repoPath, srcRoot = DEFAULT_SRC_ROOT) {
  const files = execSync('git ls-files', { cwd: repoPath })
    .toString().trim().split('\n').filter(Boolean);

  const detected = new Set();
  for (const file of files) {
    const lang = extMap.get(extname(file));
    if (lang) detected.add(lang);
  }

  // A tsconfig.json signals a TypeScript project even when only .js files are
  // tracked (JS-with-checkJs setups), so promote to the ts variant.
  if (existsSync(join(repoPath, 'tsconfig.json'))) detected.add('ts');

  // ts supersedes js: the ts ESLint config lints plain JS via fall-through, and
  // both variants emit the same eslint.config.mjs — emitting both would collide.
  if (detected.has('ts')) detected.delete('js');

  return Array.from(detected).map(language => {
    const entry = registry[language];
    const configPath = entry.configFile ? join(repoPath, entry.configFile) : null;
    let state = 'none';
    if (configPath && existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      const stamped = stampedHash(content, entry.marker);
      if (stamped === undefined) {
        state = 'foreign';
      } else {
        // Legacy (unstamped) marker or unreachable template → treat as current.
        const current = templateHash(srcRoot, language);
        state = (stamped === null || current === null || stamped === current)
          ? 'scaffold'
          : 'stale';
      }
    }
    return { language, state };
  });
}
