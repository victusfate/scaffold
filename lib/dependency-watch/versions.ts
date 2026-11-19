// Classify runtime pins against upstream release data: behind its line's latest patch, or unevaluable.
// Pure: no I/O, no clock. Imports only sibling modules (shipped verbatim into consumer repos).

import type { Pin, Runtime } from './pins.ts';

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

const parts = (v: string): number[] => v.split('.').map(Number);

function compareVersions(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Node's release line is its major (26.x); Ruby, Python and Go lines are major.minor.
const LINE_PARTS: Record<Runtime, number> = { node: 1, ruby: 2, python: 2, go: 2 };
const releaseLine = (runtime: Runtime, v: string): string => parts(v).slice(0, LINE_PARTS[runtime]).join('.');

function latestInLine(runtime: Runtime, version: string, versions: string[]): string | undefined {
  const line = releaseLine(runtime, version);
  return versions.filter(v => releaseLine(runtime, v) === line).sort(compareVersions).at(-1);
}

const note = (pin: Pin, reason: string): Note =>
  ({ runtime: pin.runtime, file: pin.file, line: pin.line, raw: pin.raw, reason });

function classifyExact(pin: Extract<Pin, { state: 'exact' }>, releases: Releases, result: Classification): void {
  const known = releases[pin.runtime];
  if (!known) { result.unchecked.push(note(pin, 'no release data')); return; }
  const latest = latestInLine(pin.runtime, pin.version, known.versions);
  const order = latest === undefined ? 1 : compareVersions(pin.version, latest);
  if (order > 0) result.unchecked.push(note(pin, 'version not in upstream releases'));
  else if (order < 0) {
    result.findings.push({ runtime: pin.runtime, file: pin.file, line: pin.line, pinned: pin.version, kind: 'behind', latest: latest! });
  }
}

export function classify(pins: Pin[], releases: Releases): Classification {
  const result: Classification = { findings: [], info: [], unchecked: [] };
  for (const pin of pins) {
    if (pin.state === 'exact') classifyExact(pin, releases, result);
    else if (pin.state === 'floating') result.info.push(note(pin, 'floating version; a rebuild picks up the latest patch'));
    else result.unchecked.push(note(pin, pin.reason));
  }
  return result;
}
