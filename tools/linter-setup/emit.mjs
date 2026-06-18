import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { registry } from './registry.mjs';
import { templateHash } from './hash.mjs';

// Stamp the template hash into the config's marker line, so detection can later
// tell a current scaffold config from a stale one. First occurrence only.
function stampMarker(content, marker, hash) {
  return content.replace(marker, `${marker} sha256:${hash}`);
}

export async function emit(language, targetRepo, srcRoot) {
  const entry = registry[language];
  if (!entry) throw new Error(`Unknown language: ${language}`);

  const srcDir = join(srcRoot, 'lib', 'linters', language);
  const hash = templateHash(srcRoot, language);
  const written = [];
  const skipped = [];
  const sidecars = [];

  const files = [];
  if (entry.configFile) files.push({ src: entry.configFile, dest: entry.configFile });
  files.push({ src: entry.workflowFile, dest: join('.github', 'workflows', entry.workflowFile) });
  // Extra files (e.g. tsconfig.json) ship verbatim to the repo root; they carry
  // no marker, so a pre-existing copy is preserved as a sidecar rather than skipped.
  for (const extra of entry.extraFiles ?? []) files.push({ src: extra, dest: extra });

  for (const { src, dest } of files) {
    const srcPath = join(srcDir, src);
    const destPath = join(targetRepo, dest);

    if (!existsSync(srcPath)) continue;

    mkdirSync(dirname(destPath), { recursive: true });

    // The config file gets its marker hash-stamped; workflows are copied verbatim.
    const isConfig = entry.configFile && src === entry.configFile;
    const write = (to) => {
      if (isConfig && hash) {
        writeFileSync(to, stampMarker(readFileSync(srcPath, 'utf8'), entry.marker, hash));
      } else {
        copyFileSync(srcPath, to);
      }
    };

    if (existsSync(destPath)) {
      const existing = readFileSync(destPath, 'utf8');
      if (existing.includes(entry.marker)) {
        skipped.push(dest);
        continue;
      }
      write(`${destPath}.scaffold-new`);
      sidecars.push(dest);
      continue;
    }

    write(destPath);
    written.push(dest);
  }

  return { written, skipped, sidecars };
}
