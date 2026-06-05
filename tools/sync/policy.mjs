// Minimal parser for .sync/policy.yaml — fixed schema only.
// Supports exactly the policy structure; not a general YAML parser.

export function parsePolicy(text) {
  const lines = text.split('\n');

  function unquote(s) {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  // State
  let ref = null;
  const copy = [];
  const guarded = [];
  const protected_ = [];
  let skillsManifest = null;

  // Section: null | 'files.copy' | 'files.guarded' | 'files.protected' | 'skills'
  let section = null;
  // For multi-line guarded objects
  let pendingGuarded = null;

  function indentOf(line) {
    let i = 0;
    while (i < line.length && line[i] === ' ') i++;
    return i;
  }

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const ind = indentOf(raw);

    // Top-level keys (indent 0)
    if (ind === 0) {
      if (pendingGuarded) { flushGuarded(); }
      if (trimmed === 'files:') { section = 'files'; continue; }
      if (trimmed === 'skills:') { section = 'skills'; continue; }
      if (trimmed.startsWith('ref: ')) { ref = trimmed.slice(5).trim(); continue; }
      // ignore unknown top-level keys (future-compat)
      section = null;
      continue;
    }

    // files sub-keys (indent 2)
    if (section === 'files' || section?.startsWith('files.')) {
      if (ind === 2) {
        if (pendingGuarded) { flushGuarded(); }
        if (trimmed === 'copy:') { section = 'files.copy'; continue; }
        if (trimmed === 'guarded:') { section = 'files.guarded'; continue; }
        if (trimmed === 'protected:') { section = 'files.protected'; continue; }
        continue;
      }

      if (ind === 4 && trimmed.startsWith('- ')) {
        const val = trimmed.slice(2).trim();

        if (section === 'files.copy') {
          copy.push(val);
          continue;
        }
        if (section === 'files.protected') {
          protected_.push(val);
          continue;
        }
        if (section === 'files.guarded') {
          if (pendingGuarded) flushGuarded();
          // Could be inline: "- path: CLAUDE.md" or start of block
          if (val.startsWith('path: ')) {
            pendingGuarded = { path: unquote(val.slice(6).trim()), keep_marker: null };
          } else if (val.startsWith('keep_marker: ')) {
            pendingGuarded = { path: null, keep_marker: unquote(val.slice(13).trim()) };
          } else {
            // plain string path shorthand not in schema — error
            throw new Error(`policy: guarded entry must have "path" and "keep_marker": ${val}`);
          }
          continue;
        }
      }

      // Continuation lines for guarded object (indent 6)
      if (ind === 6 && section === 'files.guarded' && pendingGuarded) {
        if (trimmed.startsWith('path: ')) {
          pendingGuarded.path = unquote(trimmed.slice(6).trim());
        } else if (trimmed.startsWith('keep_marker: ')) {
          pendingGuarded.keep_marker = unquote(trimmed.slice(13).trim());
        }
        continue;
      }
    }

    // skills sub-keys (indent 2)
    if (section === 'skills') {
      if (ind === 2 && trimmed.startsWith('manifest: ')) {
        skillsManifest = trimmed.slice(10).trim();
        continue;
      }
    }
  }

  if (pendingGuarded) flushGuarded();

  function flushGuarded() {
    if (!pendingGuarded.path) throw new Error(`policy: guarded entry missing "path": ${JSON.stringify(pendingGuarded)}`);
    if (!pendingGuarded.keep_marker) throw new Error(`policy: guarded entry missing "keep_marker": ${JSON.stringify(pendingGuarded)}`);
    guarded.push(pendingGuarded);
    pendingGuarded = null;
  }

  if (!lines.some(l => l.trim() === 'files:' || l.trim().startsWith('files:'))) {
    throw new Error('policy: missing required key "files"');
  }
  if (!skillsManifest) {
    throw new Error('policy: missing required key "skills.manifest"');
  }

  return {
    ref: ref ?? 'main',
    files: { copy, guarded, protected: protected_ },
    skills: { manifest: skillsManifest },
  };
}
