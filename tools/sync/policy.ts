// Minimal parser for .sync/policy.yaml — fixed schema only.
// Supports exactly the policy structure; not a general YAML parser.

// A validated guarded entry — both fields are present (flushGuarded enforces it).
export interface GuardedEntry {
  path: string;
  keep_marker: string;
}

// During parsing the two fields arrive on separate lines, so accumulate nullable.
interface PendingGuarded {
  path: string | null;
  keep_marker: string | null;
}

export interface Policy {
  ref: string;
  files: { copy: string[]; guarded: GuardedEntry[]; protected: string[] };
  skills: { manifest: string };
}

export function parsePolicy(text: string): Policy {
  const lines = text.split('\n');

  function indentOf(line: string): number {
    let i = 0;
    while (i < line.length && line[i] === ' ') i++;
    return i;
  }

  const PATH_PREFIX = 'path: ';
  const KEEP_MARKER_PREFIX = 'keep_marker: ';
  const MANIFEST_PREFIX = 'manifest: ';

  function unquote(s: string): string {
    if (s.length >= 2 &&
        ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
      return s.slice(1, -1);
    }
    return s;
  }

  function flushGuarded(): void {
    if (!pendingGuarded) return;
    if (!pendingGuarded.path) throw new Error(`policy: guarded entry missing "path": ${JSON.stringify(pendingGuarded)}`);
    if (!pendingGuarded.keep_marker) throw new Error(`policy: guarded entry missing "keep_marker": ${JSON.stringify(pendingGuarded)}`);
    guarded.push({ path: pendingGuarded.path, keep_marker: pendingGuarded.keep_marker });
    pendingGuarded = null;
  }

  // State
  let ref: string | null = null;
  let sawFiles = false;
  const copy: string[] = [];
  const guarded: GuardedEntry[] = [];
  const protected_: string[] = [];
  let skillsManifest: string | null = null;
  let section: string | null = null;
  let pendingGuarded: PendingGuarded | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const ind = indentOf(raw);

    // Top-level keys (indent 0)
    if (ind === 0) {
      if (pendingGuarded) flushGuarded();
      if (trimmed === 'files:') { section = 'files'; sawFiles = true; continue; }
      if (trimmed === 'skills:') { section = 'skills'; continue; }
      if (trimmed.startsWith('ref: ')) { ref = unquote(trimmed.slice(5).trim()); continue; }
      if (trimmed === 'ref:' || trimmed.startsWith('ref:')) {
        throw new Error(`policy: "ref" requires a value: ${trimmed}`);
      }
      throw new Error(`policy: unknown top-level key: ${trimmed}`);
    }

    // files sub-keys (indent 2)
    if (section === 'files' || section?.startsWith('files.')) {
      if (ind === 2) {
        if (pendingGuarded) flushGuarded();
        if (trimmed === 'copy:') { section = 'files.copy'; continue; }
        if (trimmed === 'guarded:') { section = 'files.guarded'; continue; }
        if (trimmed === 'protected:') { section = 'files.protected'; continue; }
        throw new Error(`policy: unknown files key: ${trimmed}`);
      }

      if (ind === 4 && trimmed.startsWith('- ')) {
        const val = trimmed.slice(2).trim();

        if (section === 'files.copy') { copy.push(val); continue; }
        if (section === 'files.protected') { protected_.push(val); continue; }

        if (section === 'files.guarded') {
          if (pendingGuarded) flushGuarded();
          if (val.startsWith(PATH_PREFIX)) {
            pendingGuarded = { path: unquote(val.slice(PATH_PREFIX.length).trim()), keep_marker: null };
          } else if (val.startsWith(KEEP_MARKER_PREFIX)) {
            pendingGuarded = { path: null, keep_marker: unquote(val.slice(KEEP_MARKER_PREFIX.length).trim()) };
          } else {
            throw new Error(`policy: guarded entry must have "path" and "keep_marker": ${val}`);
          }
          continue;
        }
      }

      // Continuation lines for guarded object (indent 6)
      if (ind === 6 && section === 'files.guarded' && pendingGuarded) {
        if (trimmed.startsWith(PATH_PREFIX)) {
          pendingGuarded.path = unquote(trimmed.slice(PATH_PREFIX.length).trim());
        } else if (trimmed.startsWith(KEEP_MARKER_PREFIX)) {
          pendingGuarded.keep_marker = unquote(trimmed.slice(KEEP_MARKER_PREFIX.length).trim());
        }
        continue;
      }
    }

    // skills sub-keys (indent 2)
    if (section === 'skills' && ind === 2 && trimmed.startsWith(MANIFEST_PREFIX)) {
      skillsManifest = trimmed.slice(MANIFEST_PREFIX.length).trim();
    }
  }

  if (pendingGuarded) flushGuarded();

  if (!sawFiles) throw new Error('policy: missing required key "files"');
  if (!skillsManifest) throw new Error('policy: missing required key "skills.manifest"');

  return {
    ref: ref ?? 'main',
    files: { copy, guarded, protected: protected_ },
    skills: { manifest: skillsManifest },
  };
}
