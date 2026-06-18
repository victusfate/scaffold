import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { registry } from './registry.mjs';

export async function emit(language, targetRepo, srcRoot) {
  const entry = registry[language];
  if (!entry) throw new Error(`Unknown language: ${language}`);

  const srcDir = join(srcRoot, 'lib', 'linters', language);
  const written = [];
  const skipped = [];
  const sidecars = [];

  const files = [];
  if (entry.configFile) files.push({ src: entry.configFile, dest: entry.configFile });
  files.push({ src: entry.workflowFile, dest: join('.github', 'workflows', entry.workflowFile) });

  for (const { src, dest } of files) {
    const srcPath = join(srcDir, src);
    const destPath = join(targetRepo, dest);

    if (!existsSync(srcPath)) continue;

    mkdirSync(dirname(destPath), { recursive: true });

    if (existsSync(destPath)) {
      const existing = readFileSync(destPath, 'utf8');
      // already has scaffold marker — skip
      if (existing.includes(entry.marker)) {
        skipped.push(dest);
        continue;
      }
      // foreign config — write sidecar, leave original untouched
      copyFileSync(srcPath, `${destPath}.scaffold-new`);
      sidecars.push(dest);
      continue;
    }

    copyFileSync(srcPath, destPath);
    written.push(dest);
  }

  return { written, skipped, sidecars };
}
