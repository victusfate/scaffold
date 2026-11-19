// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/versions.ts
// Classify runtime pins against upstream release data: behind its line's latest patch, on an
// end-of-life line, or unevaluable. Pure: no I/O; the caller passes today's date.
// Imports only sibling modules (shipped verbatim into consumer repos).

import type { Pin, Runtime } from './pins.ts';

export interface RuntimeReleases {
  versions: string[];
  // Release line → EOL date (ISO), or a boolean when endoflife.date gives no date.
  eol: Record<string, string | boolean>;
}
export type Releases = Partial<Record<Runtime, RuntimeReleases>>;

interface FindingSite { runtime: Runtime; file: string; line: number; pinned: string; }
export type Finding =
  | FindingSite & { kind: 'behind'; latest: string }
  | FindingSite & { kind: 'eol'; since: string | null };

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

type VersionedPin = Extract<Pin, { state: 'exact' | 'floating' }>;

const site = (pin: VersionedPin): FindingSite =>
  ({ runtime: pin.runtime, file: pin.file, line: pin.line, pinned: pin.version });

// Returns false when the pin cannot be evaluated (recorded as unchecked), so no EOL check follows.
function checkPatch(pin: Extract<Pin, { state: 'exact' }>, known: RuntimeReleases, result: Classification): boolean {
  const latest = latestInLine(pin.runtime, pin.version, known.versions);
  if (latest === undefined || compareVersions(pin.version, latest) > 0) {
    result.unchecked.push(note(pin, 'version not in upstream releases'));
    return false;
  }
  if (compareVersions(pin.version, latest) < 0) result.findings.push({ ...site(pin), kind: 'behind', latest });
  return true;
}

function checkEol(pin: VersionedPin, known: RuntimeReleases, today: string, result: Classification): void {
  const eol = known.eol[releaseLine(pin.runtime, pin.version)];
  const ended = typeof eol === 'string' ? eol <= today : eol === true;
  if (ended) result.findings.push({ ...site(pin), kind: 'eol', since: typeof eol === 'string' ? eol : null });
}

function classifyVersioned(pin: VersionedPin, releases: Releases, today: string, result: Classification): void {
  const known = releases[pin.runtime];
  if (!known) { result.unchecked.push(note(pin, 'no release data')); return; }
  if (pin.state === 'floating') result.info.push(note(pin, 'floating version; a rebuild picks up the latest patch'));
  else if (!checkPatch(pin, known, result)) return;
  checkEol(pin, known, today, result);
}

// `today` is an ISO date (YYYY-MM-DD); ISO dates compare correctly as strings.
export function classify(pins: Pin[], releases: Releases, today: string): Classification {
  const result: Classification = { findings: [], info: [], unchecked: [] };
  for (const pin of pins) {
    if (pin.state === 'unchecked') result.unchecked.push(note(pin, pin.reason));
    else classifyVersioned(pin, releases, today, result);
  }
  return result;
}
