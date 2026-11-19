// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/releases.ts
// Upstream release data: where each runtime publishes its releases, and parsers that turn those
// payloads into final-release version lists. Latest-patch truth comes from the runtime's own list
// (endoflife.date lagged the Ruby2Shell fix on disclosure day); endoflife.date supplies only EOL dates.
// Pure: parsers throw on malformed input so a bad payload is an error, never "no releases".

import type { Runtime } from './pins.ts';

export const RELEASE_URLS: Record<Runtime, string> = {
  ruby: 'https://cache.ruby-lang.org/pub/ruby/index.txt',
  node: 'https://nodejs.org/dist/index.json',
  python: 'https://www.python.org/api/v2/downloads/release/?is_published=true',
  go: 'https://go.dev/dl/?mode=json&include=all',
};

const EOL_PRODUCTS: Record<Runtime, string> = { ruby: 'ruby', node: 'nodejs', python: 'python', go: 'go' };
export const eolUrl = (runtime: Runtime): string => `https://endoflife.date/api/${EOL_PRODUCTS[runtime]}.json`;

const FINAL_RELEASE = /^\d+\.\d+\.\d+$/;

// Each extractor maps one raw entry name to a candidate version; non-final ones are filtered after.
const RUBY_TARBALL = /^ruby-(.+)$/;
const PYTHON_RELEASE = /^Python (.+)$/;

function jsonArray(text: string): Record<string, unknown>[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('expected a JSON array');
  return data as Record<string, unknown>[];
}

const field = (entry: Record<string, unknown>, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value : '';
};

const EXTRACTORS: Record<Runtime, (text: string) => string[]> = {
  ruby: text => text.split('\n').slice(1).map(line => RUBY_TARBALL.exec(line.split('\t')[0])?.[1] ?? ''),
  node: text => jsonArray(text).map(e => field(e, 'version').replace(/^v/, '')),
  go: text => jsonArray(text).map(e => field(e, 'version').replace(/^go/, '')),
  python: text => jsonArray(text)
    .filter(e => e.pre_release === false)
    .map(e => PYTHON_RELEASE.exec(field(e, 'name'))?.[1] ?? ''),
};

export function parseReleases(runtime: Runtime, text: string): string[] {
  const versions = [...new Set(EXTRACTORS[runtime](text).filter(v => FINAL_RELEASE.test(v)))];
  if (versions.length === 0) throw new Error(`${runtime}: no final releases in upstream payload`);
  return versions;
}

// endoflife.date `eol` is a date string, or a boolean when the line has no date.
export function parseEol(text: string): Record<string, string | boolean> {
  return Object.fromEntries(jsonArray(text).map(e => {
    const eol = e.eol;
    return [field(e, 'cycle'), typeof eol === 'boolean' ? eol : field(e, 'eol')];
  }));
}
