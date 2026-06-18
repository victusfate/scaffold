import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { registry } from './registry.mjs';

const extMap = new Map();
for (const [lang, entry] of Object.entries(registry)) {
  for (const ext of entry.extensions) extMap.set(ext, lang);
}

export async function detect(repoPath) {
  const files = execSync('git ls-files', { cwd: repoPath })
    .toString().trim().split('\n').filter(Boolean);

  const detected = new Set();
  for (const file of files) {
    const lang = extMap.get(extname(file));
    if (lang) detected.add(lang);
  }

  return Array.from(detected).map(language => {
    const entry = registry[language];
    const configPath = entry.configFile ? join(repoPath, entry.configFile) : null;
    let state = 'none';
    if (configPath && existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      state = content.includes(entry.marker) ? 'scaffold' : 'foreign';
    }
    return { language, state };
  });
}
