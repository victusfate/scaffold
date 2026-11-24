[← Scaffold at a glance](system-map.md)

# Add linter

How /add-linter adds linter configs and CI workflows for the languages in a repo, without changing a config you already have until you approve a merge.

```mermaid
flowchart LR
  n_detect["Detect"] --> n_ask["Ask once"]
  n_ask["Ask once"] --> n_emit["Emit"]
  n_emit["Emit"] --> n_merge["Merge"]
  n_merge["Merge"] --> n_finish["Tune and commit"]
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  class n_detect,n_ask lane0
  class n_emit,n_merge,n_finish lane1
```

- [Detect](#detect): Find each language in the repo and whether it already has a linter config.
- [Ask once](#ask-once): One multi-select question covers every language that needs action.
- [Emit](#emit): A deterministic CLI writes new configs and workflows, and never edits an existing config.
- [Merge](#merge): The agent merges the sidecar into your config, keeping your rules, and writes only on approval.
- [Tune and commit](#tune-and-commit): Optionally match settings to your existing code, report per language, and offer to commit.

## Detect

Find each language in the repo and whether it already has a linter config.

- Runs node tools/linter-setup/run --detect-only.
- If every language is already current, it stops: nothing to do.

**Config states**

| State | Meaning | Offer |
|---|---|---|
| none | No config yet | Fresh add |
| foreign | A config without scaffold's marker | Merge |
| stale | From an older scaffold template | Re-merge |
| scaffold | Current | Skip |

## Ask once

One multi-select question covers every language that needs action.

- If the user confirms none, nothing is written.

## Emit

A deterministic CLI writes new configs and workflows, and never edits an existing config.

- For an existing config
  - It writes the template beside it as a .scaffold-new sidecar.
  - The original is left untouched.
- Adopted configs (fresh or already current) add the linter's missing npm packages to package.json devDependencies; sidecars don't. js/ts also get lint and lint:fix scripts.

## Merge

The agent merges the sidecar into your config, keeping your rules, and writes only on approval.

- Missing scaffold thresholds are added and the marker line is carried over.
- On approval the original is backed up to .bak (an existing .bak is never overwritten) and the sidecar removed.

**Where it breaks**

- On a conflict your value is kept and the conflict is listed, so you see what scaffold would have changed.

## Tune and commit

Optionally match settings to your existing code, report per language, and offer to commit.

- Tuning proposes values seen in your code, for example line length; you confirm, override or decline.
- The commit never includes .bak or .scaffold-new files.

## Detailed flow

![Add linter, detailed](../generated/add-linter.svg)

## Code walkthrough

Detect and Emit are fully code: the tools/linter-setup CLI (run, detect.ts, emit.ts, hash.ts, deps.ts, registry.ts) with templates in lib/linters/. Asking the user, merging a sidecar into an existing config, tuning and committing are all done by the agent from the skill text; the CLI never edits an existing config and has no merge or tune command.

Each excerpt is read from the repo when this page is built. The explanations were written by an agent; `npm test` fails when the lines they explain change.

### Detect: code

#### detect: which languages does the repo use?

*Carries out the step.* It lists the files git tracks and skips the linter templates and setup tool themselves. Each remaining file extension is looked up in the registry to get a language. A tsconfig.json adds TypeScript even with no .ts files, and when TypeScript is present plain JS is dropped because both would write the same ESLint config.

```ts
export function detect(repoPath: string, srcRoot = DEFAULT_SRC_ROOT): DetectResult[] {
  const files = execSync('git ls-files', { cwd: repoPath })
    .toString().trim().split('\n').filter(Boolean);

  // Vendored linter templates and setup tooling ship example configs in many
  // languages (e.g. a .credo.exs for Elixir). When scaffold lints itself these
  // would be detected as repo source, so exclude them from language detection.
  const VENDORED = /^(lib\/linters|tools\/linter-setup)\//;

  const detected = new Set<Language>();
  for (const file of files) {
    if (VENDORED.test(file)) continue;
    const lang = extMap.get(extname(file));
    if (lang) detected.add(lang);
  }

  // A tsconfig.json signals a TypeScript project even when only .js files are
  // tracked (JS-with-checkJs setups), so promote to the ts variant.
  if (existsSync(join(repoPath, 'tsconfig.json'))) detected.add('ts');

  // ts supersedes js: the ts ESLint config lints plain JS via fall-through, and
  // both variants emit the same eslint.config.mjs — emitting both would collide.
  if (detected.has('ts')) detected.delete('js');
```

[`tools/linter-setup/detect.ts:34-56`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/detect.ts#L34-L56)

**Why it matters.** This is the first half of the Detect stage. The skip list stops scaffold from detecting its own sample configs as languages in use.

**Methods and helpers used here**

<details>
<summary><code>DetectResult</code> · interface · tools/linter-setup/detect.ts:9</summary>

One detected language paired with the state of its linter config in the repo. detect returns an array of these.

```ts
export interface DetectResult {
  language: Language;
  state: DetectState;
}
```

[`tools/linter-setup/detect.ts:9-12`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/detect.ts#L9-L12)

</details>

<details>
<summary><code>DEFAULT_SRC_ROOT</code> · const · tools/linter-setup/detect.ts:14</summary>

The absolute path two directories above the detect.ts file, which is the scaffold repo root. detect uses it as the default place to find linter templates when no srcRoot is passed.

```ts
const DEFAULT_SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
```

[`tools/linter-setup/detect.ts:14`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/detect.ts#L14)

</details>

<details>
<summary><code>extMap</code> · const · tools/linter-setup/detect.ts:16</summary>

A Map from file extension (such as '.py' or '.ts') to the Language that owns it, built at module load from every registry entry's extensions. detect uses it to map tracked files to languages.

```ts
const extMap = new Map<string, Language>();
```

[`tools/linter-setup/detect.ts:16`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/detect.ts#L16)

</details>

<details>
<summary><code>Language</code> · type · tools/linter-setup/registry.ts:1</summary>

The union of supported language ids: js, ts, python, go, rust, ruby, shell, elixir, zig and mojo. It is the key type of the linter registry.

```ts
export type Language =
  | 'js' | 'ts' | 'python' | 'go' | 'rust'
  | 'ruby' | 'shell' | 'elixir' | 'zig' | 'mojo';
```

[`tools/linter-setup/registry.ts:1-3`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/registry.ts#L1-L3)

</details>

#### detect: give each language one of four states

*Carries out the step.* For each language it looks for the config file named in the registry. No file means none. A file without the scaffold marker line means foreign. With a marker, it compares the hash stamped on that line to the hash of the current template: equal, unstamped or uncomputable means scaffold, and a different hash means stale.

```ts
  return Array.from(detected).map(language => {
    const entry = registry[language];
    const configPath = entry.configFile ? join(repoPath, entry.configFile) : null;
    let state: DetectState = 'none';
    if (configPath && existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      const stamped = stampedHash(content, entry.marker);
      if (stamped === undefined) {
        state = 'foreign';
      } else {
        // Legacy (unstamped) marker or unreachable template → treat as current.
        const current = templateHash(srcRoot, language);
        state = (stamped === null || current === null || stamped === current)
          ? 'scaffold'
          : 'stale';
      }
    }
    return { language, state };
  });
}
```

[`tools/linter-setup/detect.ts:58-77`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/detect.ts#L58-L77)

**Why it matters.** These four states decide what the skill offers: fresh add, merge, re-merge or skip. Treating an unknown hash as current avoids nagging about a config that may be fine.

**Methods and helpers used here**

<details>
<summary><code>DetectState</code> · type · tools/linter-setup/detect.ts:8</summary>

The union 'none' | 'foreign' | 'scaffold' | 'stale' describing a language's linter config: no config file, a config without the scaffold marker, a config with the marker that is current or unstamped, or a config whose stamped hash differs from the current template.

```ts
export type DetectState = 'none' | 'foreign' | 'scaffold' | 'stale';
```

[`tools/linter-setup/detect.ts:8`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/detect.ts#L8)

</details>

<details>
<summary><code>stampedHash</code> · function · tools/linter-setup/detect.ts:25</summary>

Takes a config file's text and a marker string and returns the hex digits after 'sha256:' on the line where the marker first appears. Returns null when the marker is present but that line has no hash, and undefined when the marker is absent.

Comment in the source: Read the hash stamped into a config's marker line.   undefined → marker absent (foreign)   null      → marker present but unstamped (legacy — treated as current)   &lt;hex&gt;     → stamped hash

```ts
function stampedHash(content: string, marker: string): string | null | undefined {
  const idx = content.indexOf(marker);
  if (idx === -1) return undefined;
  const nl = content.indexOf('\n', idx);
  const line = content.slice(idx, nl === -1 ? content.length : nl);
  const m = line.match(/sha256:([0-9a-f]+)/);
  return m ? m[1] : null;
}
```

[`tools/linter-setup/detect.ts:25-32`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/detect.ts#L25-L32)

</details>

<details>
<summary><code>registry</code> · const · tools/linter-setup/registry.ts:17</summary>

A table keyed by language id that holds each language's file extensions, linter name, optional config file name, workflow file name, marker comment, metricsOnly flag, and optionally extra files to ship plus devDependencies and scripts to add to package.json. Detection, emission, hashing and package.json merging all read from it.

```ts
export const registry: Record<Language, RegistryEntry> = {
  js: {
    extensions: ['.js', '.mjs', '.cjs'],
    linter: 'ESLint',
    configFile: 'eslint.config.mjs',
    workflowFile: 'lint-js.yml',
    extraFiles: ['.prettierrc.json', '.prettierignore'],
    marker: '// scaffold-linter: js',
    metricsOnly: false,
    // npm packages the shipped config imports — added to the consumer's
    // package.json devDependencies on adopt, so the starter runs locally.
    devDependencies: {
      eslint: '^10.5.0',
      '@eslint/js': '^10.0.1',
      globals: '^17.6.0',
      prettier: '^3.8.1',
    },
    // package.json scripts added on adopt. Plain JS has no type-checker, so
    // `lint:fix` is a bare autofix.
    scripts: {
      lint: 'eslint . --max-warnings 0',
      'format:check': 'prettier . --check',
      format: 'prettier . --write',
      'lint:fix': 'eslint . --fix',
```

[`tools/linter-setup/registry.ts:17-40`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/registry.ts#L17-L40) (first 24 lines shown)

</details>

<details>
<summary><code>templateHash</code> · function · tools/linter-setup/hash.ts:12</summary>

Takes the scaffold root and a language and returns the first 12 hex characters of the sha256 of that language's config template at lib/linters/&lt;lang&gt;/&lt;configFile&gt;. Returns null when the language has no config file or the template file does not exist.

```ts
export function templateHash(srcRoot: string, lang: Language): string | null {
  const entry = registry[lang];
  if (!entry?.configFile) return null;
  const tplPath = join(srcRoot, 'lib', 'linters', lang, entry.configFile);
  if (!existsSync(tplPath)) return null;
  return createHash('sha256').update(readFileSync(tplPath)).digest('hex').slice(0, HASH_PREFIX_LEN);
}
```

[`tools/linter-setup/hash.ts:12-18`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/hash.ts#L12-L18)

</details>

#### templateHash: the stamp that marks staleness

*Carries out the step.* It finds the language's template config under lib/linters/. It returns the first 12 hex characters of the sha256 of that file. It returns null when the language has no config file or the template cannot be found.

```ts
// Content hash of a language's pristine scaffold template: first 12 hex chars of
// the sha256 over the template file's bytes. Returns null when the language has
// no config file, or the template is unreachable (graceful degradation — callers
// treat a null current-hash as "cannot determine staleness").
const HASH_PREFIX_LEN = 12;

export function templateHash(srcRoot: string, lang: Language): string | null {
  const entry = registry[lang];
  if (!entry?.configFile) return null;
  const tplPath = join(srcRoot, 'lib', 'linters', lang, entry.configFile);
  if (!existsSync(tplPath)) return null;
  return createHash('sha256').update(readFileSync(tplPath)).digest('hex').slice(0, HASH_PREFIX_LEN);
}
```

[`tools/linter-setup/hash.ts:6-18`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/hash.ts#L6-L18)

**Why it matters.** Detect compares this value with the one stamped in the repo's config. It tracks the template, not the user's edits, so tuning a config never makes it stale.

**Methods and helpers used here**

<details>
<summary><code>Language</code> · type · tools/linter-setup/registry.ts:1</summary>

The union of supported language ids: js, ts, python, go, rust, ruby, shell, elixir, zig and mojo. It is the key type of the linter registry.

```ts
export type Language =
  | 'js' | 'ts' | 'python' | 'go' | 'rust'
  | 'ruby' | 'shell' | 'elixir' | 'zig' | 'mojo';
```

[`tools/linter-setup/registry.ts:1-3`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/registry.ts#L1-L3)

</details>

<details>
<summary><code>registry</code> · const · tools/linter-setup/registry.ts:17</summary>

A table keyed by language id that holds each language's file extensions, linter name, optional config file name, workflow file name, marker comment, metricsOnly flag, and optionally extra files to ship plus devDependencies and scripts to add to package.json. Detection, emission, hashing and package.json merging all read from it.

```ts
export const registry: Record<Language, RegistryEntry> = {
  js: {
    extensions: ['.js', '.mjs', '.cjs'],
    linter: 'ESLint',
    configFile: 'eslint.config.mjs',
    workflowFile: 'lint-js.yml',
    extraFiles: ['.prettierrc.json', '.prettierignore'],
    marker: '// scaffold-linter: js',
    metricsOnly: false,
    // npm packages the shipped config imports — added to the consumer's
    // package.json devDependencies on adopt, so the starter runs locally.
    devDependencies: {
      eslint: '^10.5.0',
      '@eslint/js': '^10.0.1',
      globals: '^17.6.0',
      prettier: '^3.8.1',
    },
    // package.json scripts added on adopt. Plain JS has no type-checker, so
    // `lint:fix` is a bare autofix.
    scripts: {
      lint: 'eslint . --max-warnings 0',
      'format:check': 'prettier . --check',
      format: 'prettier . --write',
      'lint:fix': 'eslint . --fix',
```

[`tools/linter-setup/registry.ts:17-40`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/registry.ts#L17-L40) (first 24 lines shown)

</details>

#### run --detect-only: print the states as JSON

*Carries out the step.* When the --detect-only flag is present, the CLI runs detect on the target path and prints the list of language and state pairs as JSON. It then returns without reading stdin or writing any file.

```bash
async function main() {
  if (detectOnly) {
    const results = await detect(INTO, srcRoot);
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }
```

[`tools/linter-setup/run:38-43`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/run#L38-L43)

**Why it matters.** This is the exact command Step 1 runs. The agent parses this JSON and stops when every state is scaffold.

#### sync: the hint that sends users to /add-linter

*Carries out the step.* After a real sync (not a dry run) it runs the same detect function on the repo. If any language is not in the scaffold state it prints a hint naming those languages and says to run /add-linter. If detect throws, for example outside a git repo, the hint is skipped.

```ts
  // Suggest /add-linter for any detected language not yet using scaffold thresholds
  if (!check) {
    try {
      const langs = detect(INTO, srcRoot);
      const actionable = langs.filter(l => l.state !== 'scaffold');
      if (actionable.length > 0) {
        const names = actionable.map(l => l.language).join(', ');
        console.log('');
        console.log(`hint: languages detected without scaffold linter config: ${names}`);
        console.log('  Run /add-linter to add quality thresholds for each language.');
      }
    } catch {
      // non-fatal: skip hint if detect fails (e.g. not a git repo)
    }
  }
```

[`tools/sync/run.ts:206-220`](https://github.com/victusfate/scaffold/blob/main/tools/sync/run.ts#L206-L220)

**Why it matters.** This is the second way the flow starts. It reuses detect, so the hint and the skill always agree on what needs action.

**Methods and helpers used here**

<details>
<summary><code>check</code> · const · tools/sync/run.ts:34</summary>

A boolean that is true when --check was passed on the command line. The sync script reads it to report what would change without writing files or the ledger.

```ts
const check      = has('--check');
```

[`tools/sync/run.ts:34`](https://github.com/victusfate/scaffold/blob/main/tools/sync/run.ts#L34)

</details>

<details>
<summary><code>srcRoot</code> · const · tools/sync/run.ts:38</summary>

The absolute path of the scaffold source tree to sync from: the --scaffold-root=&lt;path&gt; argument when given, otherwise the SYNC_SCAFFOLD_ROOT environment variable, otherwise the directory two levels above the script.

```ts
const srcRoot    = srcRootArg ? resolve(srcRootArg) : SCAFFOLD_ROOT;
```

[`tools/sync/run.ts:38`](https://github.com/victusfate/scaffold/blob/main/tools/sync/run.ts#L38)

</details>

<details>
<summary><code>INTO</code> · const · tools/sync/run.ts:39</summary>

The absolute path of the directory being synced into, resolved from the --into command-line argument, or the current directory when the flag is absent.

```ts
const INTO       = resolve(intoRaw);
```

[`tools/sync/run.ts:39`](https://github.com/victusfate/scaffold/blob/main/tools/sync/run.ts#L39)

</details>

<details>
<summary><code>detect</code> · function · tools/linter-setup/detect.ts:34</summary>

Takes a repo path and an optional scaffold root, runs git ls-files in the repo, and returns one { language, state } per language found by file extension, ignoring files under lib/linters and tools/linter-setup; a tsconfig.json adds ts, and ts removes js. State comes from reading the language's config file and comparing its stamped hash with the current template hash. It throws if the git command fails and writes nothing.

```ts
export function detect(repoPath: string, srcRoot = DEFAULT_SRC_ROOT): DetectResult[] {
  const files = execSync('git ls-files', { cwd: repoPath })
    .toString().trim().split('\n').filter(Boolean);

  // Vendored linter templates and setup tooling ship example configs in many
  // languages (e.g. a .credo.exs for Elixir). When scaffold lints itself these
  // would be detected as repo source, so exclude them from language detection.
  const VENDORED = /^(lib\/linters|tools\/linter-setup)\//;

  const detected = new Set<Language>();
  for (const file of files) {
    if (VENDORED.test(file)) continue;
    const lang = extMap.get(extname(file));
    if (lang) detected.add(lang);
  }

  // A tsconfig.json signals a TypeScript project even when only .js files are
  // tracked (JS-with-checkJs setups), so promote to the ts variant.
  if (existsSync(join(repoPath, 'tsconfig.json'))) detected.add('ts');

  // ts supersedes js: the ts ESLint config lints plain JS via fall-through, and
  // both variants emit the same eslint.config.mjs — emitting both would collide.
  if (detected.has('ts')) detected.delete('js');

```

[`tools/linter-setup/detect.ts:34-57`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/detect.ts#L34-L57) (first 24 lines shown)

</details>

### Ask once: code

No code here: The agent asks one multi-select question covering every language with state none, foreign or stale, and stops if the user confirms none.

### Emit: code

#### run: read the confirmed list and emit each language

*Carries out the step.* Without --detect-only the CLI reads stdin and exits with an error if it is empty or not a JSON array. It then calls emit once per language in the list, and exits with an error if any emit throws.

```bash
  const raw = await readStdin();
  if (!raw) {
    console.error('linter-setup: expected confirmed languages JSON on stdin');
    console.error('  Example: echo \'["js","python"]\' | linter-setup --into /path/to/repo');
    process.exit(1);
  }

  let languages;
  try {
    languages = JSON.parse(raw);
    if (!Array.isArray(languages)) throw new Error('expected array');
  } catch (e) {
    console.error(`linter-setup: invalid JSON on stdin — ${e.message}`);
    process.exit(1);
  }

  for (const lang of languages) {
    let result;
    try {
      result = await emit(lang, INTO, srcRoot);
    } catch (e) {
      console.error(`linter-setup: emit failed for ${lang} — ${e.message}`);
      process.exit(1);
    }
```

[`tools/linter-setup/run:45-68`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/run#L45-L68)

**Why it matters.** This is the hand-off from Ask to Emit: only languages the user confirmed are in the list. The CLI itself does not ask anyone anything.

#### emit: write, skip, or write a sidecar

*Enforces the rule.* For the config, the workflow and any extra files, it finds the template and the destination. If the destination exists and already has the scaffold marker, it is skipped. If it exists without the marker, the template is written beside it as &lt;file&gt;.scaffold-new and the original is not touched. If nothing is there, the file is written; a new Prettier config also becomes a sidecar when the repo already has another Prettier setup.

```ts
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
```

[`tools/linter-setup/emit.ts:49-86`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/emit.ts#L49-L86)

**Why it matters.** This is the rule that the CLI never edits an existing config. Without the sidecar branch, a user's own lint rules would be overwritten.

**Methods and helpers used here**

<details>
<summary><code>stampMarker</code> · function · tools/linter-setup/emit.ts:17</summary>

Takes a config file's text, a marker string and a hash, and returns the text with ' sha256:&lt;hash&gt;' appended after the first occurrence of the marker. The text is returned unchanged if the marker does not appear.

Comment in the source: Stamp the template hash into the config's marker line, so detection can later tell a current scaffold config from a stale one. First occurrence only.

```ts
function stampMarker(content: string, marker: string, hash: string): string {
  return content.replace(marker, `${marker} sha256:${hash}`);
}
```

[`tools/linter-setup/emit.ts:17-19`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/emit.ts#L17-L19)

</details>

<details>
<summary><code>alternateFormatter</code> · function · tools/linter-setup/emit.ts:21</summary>

Takes a target repo path and returns true if the repo has any Prettier config file other than .prettierrc.json (such as .prettierrc, .prettierrc.yml or prettier.config.js) or a 'prettier' key in package.json. It also returns true when package.json exists but cannot be parsed, and false when none of these is found.

```ts
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
```

[`tools/linter-setup/emit.ts:21-30`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/emit.ts#L21-L30)

</details>

#### stampMarker: put the template hash on the marker line

*Carries out the step.* When a config is written, the first occurrence of the marker comment is replaced with the marker followed by sha256: and the template hash. Workflows and extra files are copied without a stamp.

```ts
// Stamp the template hash into the config's marker line, so detection can later
// tell a current scaffold config from a stale one. First occurrence only.
function stampMarker(content: string, marker: string, hash: string): string {
  return content.replace(marker, `${marker} sha256:${hash}`);
}
```

[`tools/linter-setup/emit.ts:15-19`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/emit.ts#L15-L19)

**Why it matters.** Detect later reads this stamp to tell a current scaffold config from a stale one. The Merge step must carry this line over by hand for the same reason.

#### emit: add packages and scripts only when the config is adopted

*Enforces the rule.* A config counts as adopted when the language has one and it did not end up as a sidecar. Only then does emit call the two package.json merges for devDependencies and scripts. For a sidecar both results are returned with status sidecar and nothing is added.

```ts
  // Add devDependencies only once the config is actually adopted — i.e. it was
  // written fresh or was already current. A sidecar means the consumer hasn't
  // merged our config yet, so injecting deps would be premature.
  const adopted = Boolean(entry.configFile) && !sidecars.includes(entry.configFile ?? '');
  const deps: MergeResult = adopted ? mergeDevDependencies(targetRepo, language) : { added: [], status: 'sidecar' };
  const scripts: MergeResult = adopted ? mergeScripts(targetRepo, language) : { added: [], status: 'sidecar' };

  return { written, skipped, sidecars, deps, scripts };
```

[`tools/linter-setup/emit.ts:88-95`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/emit.ts#L88-L95)

**Why it matters.** This keeps packages out of package.json until the user has actually taken the config. The agent adds them later when it applies a merge.

**Methods and helpers used here**

<details>
<summary><code>MergeResult</code> · interface · tools/linter-setup/deps.ts:15</summary>

The result of a package.json merge: added lists the names that were newly inserted, and status is one of 'none', 'no-package-json', 'unparsable', 'satisfied', 'written' or 'sidecar'. mergeDevDependencies and mergeScripts return it.

```ts
export interface MergeResult {
  added: string[];
  status: MergeStatus;
}
```

[`tools/linter-setup/deps.ts:15-18`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/deps.ts#L15-L18)

</details>

<details>
<summary><code>mergeDevDependencies</code> · const · tools/linter-setup/deps.ts:70</summary>

Takes a target repo path and a language and adds that language's registry devDependencies to the repo's package.json, skipping any name already in dependencies or devDependencies; the file is rewritten with its existing indentation only if something was added. Returns { added, status }, with status 'none', 'no-package-json', 'unparsable' or 'satisfied' when nothing was written and 'written' otherwise.

Comment in the source: dependencies and devDependencies — never changes a version the repo already pins. Existing key order is preserved; new keys are appended. Returns { added: string[], status } where status is one of:   'none'            — language declares no devDependencies   'no-package-json' — target has no package.json (nothing written)   'unparsable'      — package.json exists but is not valid JSON   'satisfied'       — every package already present (nothing written)   'written'         — added packages were written

```ts
export const mergeDevDependencies = (targetRepo: string, language: Language): MergeResult =>
  mergeInto(targetRepo, 'devDependencies', registry[language]?.devDependencies ?? {});
```

[`tools/linter-setup/deps.ts:70-71`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/deps.ts#L70-L71)

</details>

<details>
<summary><code>mergeScripts</code> · const · tools/linter-setup/deps.ts:77</summary>

Takes a target repo path and a language and adds that language's registry scripts to the repo's package.json scripts, skipping any script name already defined; the file is rewritten with its existing indentation only if something was added. Returns { added, status }, with status 'none', 'no-package-json', 'unparsable' or 'satisfied' when nothing was written and 'written' otherwise.

Comment in the source: Idempotently add a language's lint scripts (lint, lint:fix) to the target repo's package.json. Only fills in script names the repo hasn't already defined — never overwrites a consumer's own `lint` command. Returns the same { added, status } shape as mergeDevDependencies.

```ts
export const mergeScripts = (targetRepo: string, language: Language): MergeResult =>
  mergeInto(targetRepo, 'scripts', registry[language]?.scripts ?? {});
```

[`tools/linter-setup/deps.ts:77-78`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/deps.ts#L77-L78)

</details>

#### mergeInto: add missing package.json entries, change nothing else

*Carries out the step.* It returns early if there is nothing to add, no package.json, or the file does not parse. It collects the names already present (for packages, in both dependencies and devDependencies). Each missing name is appended; present names are left as they are. If anything was added, the file is rewritten with its original indentation and trailing newline.

```ts
// Shared merge engine: idempotently add entries to a package.json section.
// For devDependencies, also checks dependencies to avoid duplicates.
// Returns { added, status } — same shape for both public exports below.
function mergeInto(targetRepo: string, section: Section, entries: Record<string, string>): MergeResult {
  if (!entries || Object.keys(entries).length === 0) return { added: [], status: 'none' };
  const pkgPath = join(targetRepo, 'package.json');
  if (!existsSync(pkgPath)) return { added: [], status: 'no-package-json' };
  const raw = readFileSync(pkgPath, 'utf8');
  let pkg: PackageJson;
  try { pkg = JSON.parse(raw) as PackageJson; } catch { return { added: [], status: 'unparsable' }; }

  const present = section === 'devDependencies'
    ? new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
    : new Set(Object.keys(pkg.scripts ?? {}));

  const target = (pkg[section] ?? {}) as Record<string, string>;
  const added: string[] = [];
  for (const [name, val] of Object.entries(entries)) {
    if (present.has(name)) continue;
    target[name] = val;
    added.push(name);
  }
  if (added.length === 0) return { added: [], status: 'satisfied' };

  pkg[section] = target as never;
  const trailingNL = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, detectIndent(raw)) + trailingNL);
  return { added, status: 'written' };
}
```

[`tools/linter-setup/deps.ts:29-57`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/deps.ts#L29-L57)

**Why it matters.** This is why running the CLI twice is safe and why an existing version or lint script is never changed.

**Methods and helpers used here**

<details>
<summary><code>PackageJson</code> · interface · tools/linter-setup/deps.ts:6</summary>

The part of a package.json this module reads and writes: optional dependencies, devDependencies and scripts maps of string to string.

Comment in the source: The subset of package.json this tool reads and writes.

```ts
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}
```

[`tools/linter-setup/deps.ts:6-10`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/deps.ts#L6-L10)

</details>

<details>
<summary><code>MergeResult</code> · interface · tools/linter-setup/deps.ts:15</summary>

The result of a package.json merge: added lists the names that were newly inserted, and status is one of 'none', 'no-package-json', 'unparsable', 'satisfied', 'written' or 'sidecar'. mergeDevDependencies and mergeScripts return it.

```ts
export interface MergeResult {
  added: string[];
  status: MergeStatus;
}
```

[`tools/linter-setup/deps.ts:15-18`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/deps.ts#L15-L18)

</details>

<details>
<summary><code>detectIndent</code> · function · tools/linter-setup/deps.ts:22</summary>

Takes the text of a JSON file and returns the whitespace that precedes the first quoted key on its own line. Returns the number 2 when no such indented line is found; the value is passed to JSON.stringify as the indent.

Comment in the source: Indentation of an existing JSON file, so we don't reflow the consumer's package.json. Falls back to two spaces.

```ts
function detectIndent(text: string): string | number {
  const m = text.match(/\n([ \t]+)"/);
  return m ? m[1] : 2;
}
```

[`tools/linter-setup/deps.ts:22-25`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/deps.ts#L22-L25)

</details>

<details>
<summary><code>Section</code> · type · tools/linter-setup/deps.ts:27</summary>

The union 'devDependencies' | 'scripts', naming which package.json section a merge writes to.

```ts
type Section = 'devDependencies' | 'scripts';
```

[`tools/linter-setup/deps.ts:27`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/deps.ts#L27)

</details>

#### registry: the TypeScript lint scripts

*Carries out the step.* The registry entry for TypeScript lists the scripts added on adopt: lint, format:check, format and lint:fix. lint:fix runs the ESLint autofix and then tsc --noEmit.

```ts
    // package.json scripts added on adopt. Type-aware autofix can rewrite code
    // in ways tsc rejects, so `lint:fix` re-runs `tsc --noEmit` as the gate —
    // the fix is only trustworthy if the type-checker still passes.
    scripts: {
      lint: 'eslint . --max-warnings 0',
      'format:check': 'prettier . --check',
      format: 'prettier . --write',
      'lint:fix': 'eslint . --fix && tsc --noEmit',
    },
```

[`tools/linter-setup/registry.ts:63-71`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/registry.ts#L63-L71)

**Why it matters.** The skill forbids a bare autofix on a type-aware config. Shipping the type-check inside the script makes the safe form the default.

#### run: one result line per file

*Carries out the step.* After each emit the CLI prints a line for every written file, every sidecar (marked original unchanged) and every skipped file. It prints the packages it added with a reminder to run npm install, or the npm i -D command to run by hand when there is no package.json. Added scripts are not printed.

```bash
    for (const f of result.written)   console.log(`  written   ${lang}  ${f}`);
    for (const f of result.sidecars)  console.log(`  sidecar   ${lang}  ${f}  (original unchanged)`);
    for (const f of result.skipped)   console.log(`  skipped   ${lang}  ${f}  (scaffold already present)`);

    const deps = result.deps;
    if (deps?.added.length) {
      console.log(`  deps      ${lang}  package.json += ${deps.added.join(', ')}  (run npm install)`);
    } else if (deps?.status === 'no-package-json') {
      const names = Object.keys(registry[lang]?.devDependencies ?? {}).join(' ');
      console.log(`  deps      ${lang}  no package.json — install manually: npm i -D ${names}`);
    }
```

[`tools/linter-setup/run:70-80`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/run#L70-L80)

**Why it matters.** The agent builds its Step 6 report from these lines. The merged, tuned and declined rows of that report have no CLI output and come from the agent.

#### Test: an existing config is left alone

*Test that pins it.* The test writes its own eslint.config.mjs into a temporary repo and runs emit for JS. It then checks the file is byte-for-byte unchanged and that eslint.config.mjs.scaffold-new now exists beside it.

```bash
// emit: conflict → sidecar written, original untouched
{
  const dir = makeTmp();
  const existing = 'export default []; // existing config\n';
  writeFileSync(join(dir, 'eslint.config.mjs'), existing);
  await emit('js', dir, srcRoot);
  const original = readFileSync(join(dir, 'eslint.config.mjs'), 'utf8');
  original === existing
    ? ok('emit: original untouched on conflict')
    : fail_('emit: original was overwritten on conflict');
  existsSync(join(dir, 'eslint.config.mjs.scaffold-new'))
    ? ok('emit: sidecar written on conflict')
    : fail_('emit: sidecar not written on conflict');
}
```

[`tools/linter-setup/test:230-243`](https://github.com/victusfate/scaffold/blob/main/tools/linter-setup/test#L230-L243)

**Why it matters.** It pins the promise the Merge stage depends on: the original and the sidecar both exist for the agent to compare.

### Merge: code

No code here: The agent reads the config and its .scaffold-new sidecar, proposes a merge that keeps the user's values and the stamped marker line, shows the diff and conflicts, and on approval backs up to .bak, writes and removes the sidecar.

### Tune and commit: code

No code here: The agent proposes tuning values from the repo's code, reports per language, and offers the commit while leaving out .bak and .scaffold-new files; nothing in the repo blocks those files from being committed.

## Checked against the source

The flow matches skills/add-linter.md well: all six stages, their order and the stop conditions are stated in the source. Three claims are loose: the sidecar glossary says the file is never overwritten although an approved merge does write over it, the merge-to-finish step names only merged configs although fresh adds are tuned too, and the legend says workflows run on each push or PR, which the doc does not state. The main omission is the TypeScript lint:fix type-check gate, along with the no-package.json, format-only-language and CLI-missing branches.

| Confirmed | Partly | Not found | Contradicted | In the source, not shown in the flow | Code excerpts |
|---:|---:|---:|---:|---:|---:|
| 28 | 3 | 0 | 0 | 8 | 13 |

An agent judged each claim against the source; each quote is found in its file when this page is built.

### Detect: checks

<details>
<summary>8 confirmed, with the supporting line</summary>

- **Confirmed**: Find each language in the repo and whether it already has a linter config.
  > Parse the JSON array \`\[{ language, state }\]\`. \`state\` is one of \`none\`, \`foreign\`,
  >
  > [`skills/add-linter.md:20`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L20)

- **Confirmed**: Runs node tools/linter-setup/run --detect-only.
  > node tools/linter-setup/run --detect-only --into .
  >
  > [`skills/add-linter.md:17`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L17)

- **Confirmed**: If every language is already current, it stops: nothing to do.
  > If all languages are \`"scaffold"\` (or no languages detected), report:
  >
  > [`skills/add-linter.md:30`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L30)

- **Confirmed**: Config states table: none = No config yet -&gt; Fresh add
  > \- \`state: "none"\` → no linter config found; offer a \*\*fresh add\*\*
  >
  > [`skills/add-linter.md:25`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L25)

- **Confirmed**: Config states table: foreign = A config without scaffold's marker -&gt; Merge
  > \- \`state: "foreign"\` → config exists but lacks the scaffold marker; offer a \*\*merge\*\*
  >
  > [`skills/add-linter.md:26`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L26)

- **Confirmed**: Config states table: stale = From an older scaffold template -&gt; Re-merge
  > \- \`state: "stale"\` → scaffold config whose template has since changed; offer a
  >
  > [`skills/add-linter.md:27`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L27)

- **Confirmed**: Config states table: scaffold = Current -&gt; Skip
  > \- \`state: "scaffold"\` → current scaffold config; skip silently
  >
  > [`skills/add-linter.md:24`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L24)

- **Confirmed**: detect -&gt; ask: Actionable languages found (payload: language states)
  > Ask about each language with state \`none\`, \`foreign\`, or \`stale\` exactly once, as
  >
  > [`skills/add-linter.md:37`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L37)

</details>

### Ask once: checks

<details>
<summary>3 confirmed, with the supporting line</summary>

- **Confirmed**: One multi-select question covers every language that needs action.
  > one group (one \`AskUserQuestion\` call) with multi-select so the user can confirm
  >
  > [`skills/add-linter.md:38`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L38)

- **Confirmed**: If the user confirms none, nothing is written.
  > If the user confirms none, stop without writing anything.
  >
  > [`skills/add-linter.md:49`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L49)

- **Confirmed**: ask -&gt; emit: Languages confirmed (payload: confirmed list)
  > Pass the confirmed language list as JSON to the linter-setup CLI:
  >
  > [`skills/add-linter.md:53`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L53)

</details>

### Emit: checks

- **Partly**: Sidecar: A .scaffold-new copy saved beside your file for you to review and merge; your file is never overwritten.
  > existing \`.bak\`; if one exists, surface it and ask), write the merged config to
  >
  > [`skills/add-linter.md:100`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L100)

  Only the CLI never overwrites the file; after the user approves the merge, the merged config is written over the original (which is backed up to .bak).

- **Partly** (from the diagram): Legend L2 workflow: a GitHub Actions file that runs the linter on each push or PR
  > Add linter configs and GitHub Actions workflows for languages detected in the
  >
  > [`skills/add-linter.md:3`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L3)

  The skill doc says the workflows are GitHub Actions workflows but never states when they run; "on each push or PR" is not in skills/add-linter.md.

<details>
<summary>6 confirmed, with the supporting line</summary>

- **Confirmed**: A deterministic CLI writes new configs and workflows, and never edits an existing config.
  > The CLI never edits an existing config; you perform the merge. For each
  >
  > [`skills/add-linter.md:83`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L83)

- **Confirmed**: For an existing config: It writes the template beside it as a .scaffold-new sidecar.
  > \- \`foreign\`/\`stale\` → writes the template to \`\[configFile\].scaffold-new\` (sidecar);
  >
  > [`skills/add-linter.md:61`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L61)

- **Confirmed**: For an existing config: The original is left untouched.
  > the existing config is left untouched
  >
  > [`skills/add-linter.md:62`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L62)

- **Confirmed**: Adopted configs (fresh or already current) add the linter's missing npm packages to package.json devDependencies; sidecars don't. js/ts also get lint and lint:fix scripts.
  > When a config is \*\*adopted\*\* (written fresh, or already current), the CLI also
  >
  > [`skills/add-linter.md:65`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L65)

- **Confirmed**: emit -&gt; merge: Sidecars written for existing configs (payload: .scaffold-new files)
  > \1. Read the existing \`\[configFile\]\` and the \`\[configFile\].scaffold-new\` sidecar.
  >
  > [`skills/add-linter.md:86`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L86)

- **Confirmed** (from the diagram): E2: none → config + workflow
  > \- \`none\` → writes the config (marker hash-stamped) + workflow
  >
  > [`skills/add-linter.md:60`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L60)

</details>

### Merge: checks

- **Partly**: merge -&gt; finish: Merges approved or declined (payload: merged configs)
  > For each language whose config was written (fresh add) or merged, offer an optional
  >
  > [`skills/add-linter.md:106`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L106)

  Tuning takes freshly written configs as well as merged ones, and a declined merge is neither merged nor tuned; the payload names only merged configs.

<details>
<summary>5 confirmed, with the supporting line</summary>

- **Confirmed**: The agent merges the sidecar into your config, keeping your rules, and writes only on approval.
  > \- \*\*Merge and tune are agent-driven, not tool features.\*\* The
  >
  > [`skills/add-linter.md:160`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L160)

- **Confirmed**: Missing scaffold thresholds are added and the marker line is carried over.
  > \- carry the scaffold marker line from the sidecar (it holds the \`sha256:\` stamp)
  >
  > [`skills/add-linter.md:92`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L92)

- **Confirmed**: On approval the original is backed up to .bak (an existing .bak is never overwritten) and the sidecar removed.
  > \4. On approval: back up the original to \`\[configFile\].bak\` (do \*\*not\*\* overwrite an
  >
  > [`skills/add-linter.md:99`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L99)

- **Confirmed**: On a conflict your value is kept and the conflict is listed, so you see what scaffold would have changed.
  > scaffold-enforced) \*\*keep the user's value\*\* and record the conflict.
  >
  > [`skills/add-linter.md:91`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L91)

- **Confirmed**: Marker: A hash-stamped line that tags a config as scaffold's.
  > \- carry the scaffold marker line from the sidecar (it holds the \`sha256:\` stamp)
  >
  > [`skills/add-linter.md:92`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L92)

</details>

### Tune and commit: checks

<details>
<summary>6 confirmed, with the supporting line</summary>

- **Confirmed**: Optionally match settings to your existing code, report per language, and offer to commit.
  > For each language whose config was written (fresh add) or merged, offer an optional
  >
  > [`skills/add-linter.md:106`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L106)

- **Confirmed**: Tuning proposes values seen in your code, for example line length; you confirm, override or decline.
  > \1. Scan the repo's existing code for that language and propose preference-matched
  >
  > [`skills/add-linter.md:109`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L109)

- **Confirmed**: The commit never includes .bak or .scaffold-new files.
  > \- \*\*Backups and sidecars are local artifacts.\*\* Do not commit \`\[configFile\].bak\` or
  >
  > [`skills/add-linter.md:165`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L165)

- **Confirmed** (from the diagram): T3: Show diff, write on approval
  > \3. Apply confirmed edits to \`\[configFile\]\`, show the diff, write on approval.
  >
  > [`skills/add-linter.md:114`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L114)

- **Confirmed** (from the diagram): F1: Per language: written, deps, scripts, merged, tuned, skipped, declined
  > \| \`skipped\` \| "— \[lang\]: already current (skipped)" \|
  >
  > [`skills/add-linter.md:137`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L137)

- **Confirmed** (from the diagram): F2 --&gt;|yes| F3: git commit: feat: add scaffold linter config
  > git commit -m "feat: add scaffold linter config for \[languages\]"
  >
  > [`skills/add-linter.md:147`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L147)

</details>

## In the source, not shown in the flow

- The TypeScript lint:fix script is gated by the type-checker (`eslint . --fix && tsc --noEmit`); a bare `eslint . --fix` must never be run on a type-aware config.
  > fix is only trusted once the type-checker still passes. Never run a bare
  >
  > [`skills/add-linter.md:78`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L78)

- With no package.json the CLI does not create one; it reports the `npm i -D` one-liner, and the user is reminded to run `npm install` after deps are added.
  > one. Remind the user to run \`npm install\` after deps are added.
  >
  > [`skills/add-linter.md:72`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L72)

- Format-only languages (zig, mojo) get a workflow only and skip the merge and tune steps.
  > \- \*\*Format-only languages\*\* (zig, mojo): no config file, workflow only, so
  >
  > [`skills/add-linter.md:154`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L154)

- If the linter-setup CLI is not available, the skill falls back to copying the language templates from lib/linters/&lt;lang&gt;/ by hand.
  > \- If \`tools/linter-setup/run\` is not available (consumer repo without scaffold
  >
  > [`skills/add-linter.md:168`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L168)

- Tuning never changes the marker stamp, because staleness tracks the template and not the tuned values.
  > \4. Declining keeps scaffold's defaults. Tuning never changes the marker stamp
  >
  > [`skills/add-linter.md:115`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L115)

- When a .bak already exists the agent must surface it and ask, not just avoid overwriting it.
  > existing \`.bak\`; if one exists, surface it and ask), write the merged config to
  >
  > [`skills/add-linter.md:100`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L100)

- If the user declines the commit, the written files are listed so they can stage and commit them manually.
  > If no, list the written files so the user can stage and commit them manually.
  >
  > [`skills/add-linter.md:150`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L150)

- The tune step also covers fixture paths (ESLint ignores plus a root .quality-ignore) and offers an opt-in npm-workspaces TypeScript template.
  > \6. \*\*Multi-package TypeScript.\*\* For an npm-workspaces repo, offer the opt-in
  >
  > [`skills/add-linter.md:122`](https://github.com/victusfate/scaffold/blob/main/skills/add-linter.md#L122)

## Glossary

- **Sidecar**: A .scaffold-new copy saved beside your file for you to review and merge; your file is never overwritten.
- **Marker**: A hash-stamped line that tags a config as scaffold's.
- **Threshold**: A rule limit, such as max line length.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's /add-linter skill sets up linting
for a repo without clobbering existing configs.
Read this page:
https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/add-linter.md
Scaffold: https://github.com/victusfate/scaffold

Questions worth asking:
- Why does the CLI write a sidecar instead of editing my config?
```
