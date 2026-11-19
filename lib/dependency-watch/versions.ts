// Runtime pins: parse them from repo files and classify them against upstream release data.
// Pure: no I/O, no clock. Imports only node: builtins (shipped verbatim into consumer repos).

export type Runtime = 'ruby';

export interface RepoFile { path: string; content: string; }

export interface Pin {
  runtime: Runtime;
  file: string;
  line: number;
  version: string;
}

export interface RuntimeReleases {
  versions: string[];
  eol: Record<string, string | false>;
}
export type Releases = Partial<Record<Runtime, RuntimeReleases>>;

export interface Finding {
  runtime: Runtime;
  file: string;
  line: number;
  pinned: string;
  kind: 'behind';
  latest: string;
}

export interface Note { runtime?: Runtime; file: string; line: number; raw: string; reason: string; }

export interface Classification { findings: Finding[]; info: Note[]; unchecked: Note[]; }

const RUBY_VERSION_FILE = /(^|\/)\.ruby-version$/;
const RUBY_PREFIX = /^ruby-/;

export function parsePins(files: RepoFile[]): Pin[] {
  const pins: Pin[] = [];
  for (const file of files) {
    if (!RUBY_VERSION_FILE.test(file.path)) continue;
    const version = file.content.trim().replace(RUBY_PREFIX, '');
    pins.push({ runtime: 'ruby', file: file.path, line: 1, version });
  }
  return pins;
}

const parts = (v: string): number[] => v.split('.').map(Number);

function compareVersions(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// A release line is major.minor (Ruby, Python, Go).
const releaseLine = (v: string): string => parts(v).slice(0, 2).join('.');

function latestInLine(version: string, versions: string[]): string | undefined {
  const line = releaseLine(version);
  return versions.filter(v => releaseLine(v) === line).sort(compareVersions).at(-1);
}

export function classify(pins: Pin[], releases: Releases): Classification {
  const result: Classification = { findings: [], info: [], unchecked: [] };
  for (const pin of pins) {
    const known = releases[pin.runtime];
    if (!known) continue;
    const latest = latestInLine(pin.version, known.versions);
    if (latest && compareVersions(pin.version, latest) < 0) {
      result.findings.push({ ...locate(pin), pinned: pin.version, kind: 'behind', latest });
    }
  }
  return result;
}

const locate = (pin: Pin) => ({ runtime: pin.runtime, file: pin.file, line: pin.line });
