// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/pins.ts
// Runtime pins: find the runtime versions a repo declares in its version files and Dockerfiles.
// Pure: no I/O. Imports only node: builtins (shipped verbatim into consumer repos).

import { basename } from 'node:path';

export type Runtime = 'ruby' | 'node' | 'python' | 'go';

export interface RepoFile { path: string; content: string; }

interface PinSite { file: string; line: number; raw: string; }

// exact: full major.minor.patch, comparable to upstream releases.
// floating: a line, a major or `latest` (`3.4`, `26`); a rebuild picks up the latest patch.
// unchecked: cannot be evaluated (alias, digest, build arg); reported, never treated as clean.
export type Pin =
  | PinSite & { state: 'exact'; runtime: Runtime; version: string }
  | PinSite & { state: 'floating'; runtime: Runtime; version: string }
  | PinSite & { state: 'unchecked'; runtime?: Runtime; reason: string };

// A final release (major.minor.patch); upstream release lists are filtered to the same shape.
export const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const FLOATING_VERSION = /^\d+(\.\d+)?$/;

// Version-file name → runtime it pins. `.tool-versions` and Dockerfiles name the runtime per line.
const VERSION_FILES: Record<string, Runtime> = {
  '.ruby-version': 'ruby',
  '.node-version': 'node',
  '.nvmrc': 'node',
  '.python-version': 'python',
};

// asdf names (nodejs, golang), mise aliases (node, go) and official Docker image names → runtime.
const TOOL_NAMES: Record<string, Runtime> = { ruby: 'ruby', nodejs: 'node', node: 'node', python: 'python', golang: 'go', go: 'go' };
const IMAGE_NAMES: Record<string, Runtime> = { ruby: 'ruby', node: 'node', python: 'python', golang: 'go' };

// Prefixes some version managers put before the number (`ruby-3.4.1`, `v26.1.0`).
const VERSION_PREFIX = /^(ruby-|v)/;
const OFFICIAL_IMAGE_PREFIX = /^(docker\.io\/)?(library\/)?/;
const DOCKERFILE = /^Dockerfile([.-].*)?$|\.Dockerfile$/;
const FROM_LINE = /^\s*FROM\s+(.+)$/i;
const COMMENT = /^#/;

function pinFromVersion(site: PinSite, runtime: Runtime, text: string): Pin {
  const version = text.replace(VERSION_PREFIX, '');
  if (EXACT_VERSION.test(version)) return { ...site, state: 'exact', runtime, version };
  if (FLOATING_VERSION.test(version)) return { ...site, state: 'floating', runtime, version };
  return { ...site, state: 'unchecked', runtime, reason: 'not a version number' };
}

// Every pin file is read line by line; `pinOf` turns one trimmed, non-comment line into a pin.
function linePins(file: RepoFile, pinOf: (site: PinSite) => Pin | undefined): Pin[] {
  return file.content.split('\n').flatMap((text, i): Pin[] => {
    const raw = text.trim();
    if (!raw || COMMENT.test(raw)) return [];
    const pin = pinOf({ file: file.path, line: i + 1, raw });
    return pin ? [pin] : [];
  });
}

// One version per line; pyenv's .python-version may list several.
const versionFilePins = (file: RepoFile, runtime: Runtime): Pin[] =>
  linePins(file, site => pinFromVersion(site, runtime, site.raw));

function toolVersionsPin(site: PinSite): Pin | undefined {
  const [tool, version] = site.raw.split(/\s+/);
  const runtime = TOOL_NAMES[tool];
  return runtime && version ? pinFromVersion(site, runtime, version) : undefined;
}

// `FROM [--flag=value ...] image[:tag|@digest] [AS stage]` → the image reference.
function imageOf(fromArgs: string): string {
  return fromArgs.trim().split(/\s+/).find(token => !token.startsWith('--')) ?? '';
}

function dockerfilePin(site: PinSite, image: string): Pin | undefined {
  if (image.includes('$')) return { ...site, state: 'unchecked', reason: 'image set by a build arg' };
  const ref = image.replace(OFFICIAL_IMAGE_PREFIX, '');
  const [name, digest] = ref.split('@');
  const [repo, tag] = name.split(':');
  const runtime = IMAGE_NAMES[repo];
  if (!runtime) return undefined;
  if (digest) return { ...site, state: 'unchecked', runtime, reason: 'pinned by digest' };
  if (!tag) return { ...site, state: 'floating', runtime, version: 'latest' };
  return pinFromVersion(site, runtime, tag.split('-')[0]);
}

function dockerfileLinePin(site: PinSite): Pin | undefined {
  const from = FROM_LINE.exec(site.raw);
  return from ? dockerfilePin(site, imageOf(from[1])) : undefined;
}

function parserFor(path: string): ((file: RepoFile) => Pin[]) | undefined {
  const name = basename(path);
  const runtime = VERSION_FILES[name];
  if (runtime) return file => versionFilePins(file, runtime);
  if (name === '.tool-versions') return file => linePins(file, toolVersionsPin);
  if (DOCKERFILE.test(name)) return file => linePins(file, dockerfileLinePin);
  return undefined;
}

// Lets a caller read only the files that can hold pins.
export const isPinFile = (path: string): boolean => parserFor(path) !== undefined;

export function parsePins(files: RepoFile[]): Pin[] {
  return files.flatMap(file => parserFor(file.path)?.(file) ?? []);
}
