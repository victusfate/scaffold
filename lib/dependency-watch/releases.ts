// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/releases.ts
// Upstream release data: where each runtime publishes its releases, and parsers that turn those
// payloads into final-release version lists. Latest-patch truth comes from the runtime's own list
// (endoflife.date lagged the Ruby2Shell fix on disclosure day); endoflife.date supplies only EOL dates.
// Pure: parsers throw on malformed input so a bad payload is an error, never "no releases".

import { EXACT_VERSION, type Runtime } from './pins.ts';

export const RELEASE_URLS: Record<Runtime, string> = {
  ruby: 'https://cache.ruby-lang.org/pub/ruby/index.txt',
  node: 'https://nodejs.org/dist/index.json',
  python: 'https://www.python.org/api/v2/downloads/release/?is_published=true',
  go: 'https://go.dev/dl/?mode=json&include=all',
};

const EOL_PRODUCTS: Record<Runtime, string> = { ruby: 'ruby', node: 'nodejs', python: 'python', go: 'go' };
const EOL_SITE = 'https://endoflife.date';
export const eolUrl = (runtime: Runtime): string => `${EOL_SITE}/api/${EOL_PRODUCTS[runtime]}.json`;
export const eolPageUrl = (runtime: Runtime): string => `${EOL_SITE}/${EOL_PRODUCTS[runtime]}`;

// Where an owner reads up on a release, built from fixed templates (no third-party text).
const RELEASE_NOTES: Record<Runtime, (version: string) => string> = {
  ruby: v => `https://github.com/ruby/ruby/releases/tag/v${v.replace(/\./g, '_')}`,
  node: v => `https://github.com/nodejs/node/releases/tag/v${v}`,
  python: v => `https://www.python.org/downloads/release/python-${v.replace(/\./g, '')}/`,
  go: v => `https://go.dev/doc/devel/release#go${v}`,
};
export const releaseNotesUrl = (runtime: Runtime, version: string): string => RELEASE_NOTES[runtime](version);

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

// Each extractor maps one raw entry name to a candidate version; non-final ones are filtered after.
const EXTRACTORS: Record<Runtime, (text: string) => string[]> = {
  ruby: text => text.split('\n').slice(1).map(line => RUBY_TARBALL.exec(line.split('\t')[0])?.[1] ?? ''),
  node: text => jsonArray(text).map(e => field(e, 'version').replace(/^v/, '')),
  go: text => jsonArray(text).map(e => field(e, 'version').replace(/^go/, '')),
  python: text => jsonArray(text)
    .filter(e => e.pre_release === false)
    .map(e => PYTHON_RELEASE.exec(field(e, 'name'))?.[1] ?? ''),
};

export function parseReleases(runtime: Runtime, text: string): string[] {
  const versions = [...new Set(EXTRACTORS[runtime](text).filter(v => EXACT_VERSION.test(v)))];
  if (versions.length === 0) throw new Error(`${runtime}: no final releases in upstream payload`);
  return versions;
}

// endoflife.date `eol` is an ISO date, or a boolean when the line has no date. Anything else is a
// malformed payload: it throws rather than becoming a false (or missed) end-of-life finding.
export function parseEol(text: string): Record<string, string | boolean> {
  return Object.fromEntries(jsonArray(text).map(e => {
    const eol = e.eol;
    if (typeof eol !== 'boolean' && !(typeof eol === 'string' && ISO_DATE.test(eol))) {
      throw new Error(`endoflife.date: unexpected eol ${JSON.stringify(eol)} for cycle ${field(e, 'cycle')}`);
    }
    return [field(e, 'cycle'), eol];
  }));
}
