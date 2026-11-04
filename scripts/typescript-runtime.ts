// The TypeScript compiler, for the scaffold tools that parse source (mind meld, import boundaries).
// It is optional: a consumer repo with no root package.json still runs every other scaffold script and
// test. These tools load it only when invoked, and their tests skip when it is absent.
// Usage: const ts = await loadTypeScript();            // null when unavailable
//        const ts = await requireTypeScript('<tool>');  // throws a how-to-install message instead
import { createRequire } from 'node:module';
import { join } from 'node:path';

export type TypeScript = typeof import('typescript');

/** typescript from normal resolution, else from SCAFFOLD_TYPESCRIPT_DIR (a node_modules folder that has it). */
export async function loadTypeScript(): Promise<TypeScript | null> {
  try { return (await import('typescript')).default; } catch { /* not installed beside this repo */ }
  const dir = process.env.SCAFFOLD_TYPESCRIPT_DIR;
  if (dir) {
    try { return createRequire(join(dir, 'resolve.js'))('typescript') as TypeScript; } catch { /* not in that folder */ }
  }
  return null;
}

export async function requireTypeScript(tool: string): Promise<TypeScript> {
  const ts = await loadTypeScript();
  if (!ts) {
    throw new Error(`${tool} needs the typescript package: install it (npm i -D typescript) or set `
      + 'SCAFFOLD_TYPESCRIPT_DIR to a node_modules folder that contains it');
  }
  return ts;
}
