import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { registry, type Language } from './registry.ts';
import { templateHash } from './hash.ts';
import { mergeDevDependencies, mergeScripts, type MergeResult } from './deps.ts';

export interface EmitResult {
  written: string[];
  skipped: string[];
  sidecars: string[];
  deps: MergeResult;
  scripts: MergeResult;
}

// Stamp the template hash into the config's marker line, so detection can later
// tell a current scaffold config from a stale one. First occurrence only.
function stampMarker(content: string, marker: string, hash: string): string {
  return content.replace(marker, `${marker} sha256:${hash}`);
}

function alternateFormatter(targetRepo: string): boolean {
  const names = ['.prettierrc', '.prettierrc.json5', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.toml',
    '.prettierrc.js', '.prettierrc.ts', '.prettierrc.mjs', '.prettierrc.mts', '.prettierrc.cjs', '.prettierrc.cts',
    'prettier.config.js', 'prettier.config.ts', 'prettier.config.mjs', 'prettier.config.mts', 'prettier.config.cjs', 'prettier.config.cts'];
  if (names.some(name => existsSync(join(targetRepo, name)))) return true;
  const pkg = join(targetRepo, 'package.json');
  if (!existsSync(pkg)) return false;
  try { return Object.hasOwn(JSON.parse(readFileSync(pkg, 'utf8')) as object, 'prettier'); }
  catch { return true; } // Preserve an unparsable consumer manifest for manual repair.
}

export function emit(language: Language, targetRepo: string, srcRoot: string): EmitResult {
  const entry = registry[language];
  if (!entry) throw new Error(`Unknown language: ${language}`);

  const srcDir = join(srcRoot, 'lib', 'linters', language);
  const hash = templateHash(srcRoot, language);
  const written: string[] = [];
  const skipped: string[] = [];
  const sidecars: string[] = [];

  const files: { src: string; dest: string }[] = [];
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
    const write = (to: string): void => {
      if (isConfig && hash) {
        writeFileSync(to, stampMarker(readFileSync(srcPath, 'utf8'), entry.marker, hash));
      } else {
        copyFileSync(srcPath, to);
      }
    };

    if (src === '.prettierrc.json' && !existsSync(destPath) && alternateFormatter(targetRepo)) {
      write(`${destPath}.scaffold-new`);
      sidecars.push(dest);
      continue;
    }

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

  // Add devDependencies only once the config is actually adopted — i.e. it was
  // written fresh or was already current. A sidecar means the consumer hasn't
  // merged our config yet, so injecting deps would be premature.
  const adopted = Boolean(entry.configFile) && !sidecars.includes(entry.configFile ?? '');
  const deps: MergeResult = adopted ? mergeDevDependencies(targetRepo, language) : { added: [], status: 'sidecar' };
  const scripts: MergeResult = adopted ? mergeScripts(targetRepo, language) : { added: [], status: 'sidecar' };

  return { written, skipped, sidecars, deps, scripts };
}
