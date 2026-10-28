# Security review — before every merge

Code written by AI agents fails in its own ways: plausible-but-wrong logic, hallucinated packages, secrets
pasted from context, instructions smuggled in through data. Every merge therefore passes a **machine half**
(pinned third-party scanners) and a **human half** (a line-by-line review against the checklist below).

`scripts/security-gate.ts` checks both and refuses the merge unless both are satisfied. Run **origin/main's
copy** of it, never the branch's (a branch could edit its own launcher), after the PR body is written and
before every merge; run it before pushing too, so findings are fixed while they are cheap:

```bash
git fetch -q origin main
tmp=$(mktemp -d) && git show origin/main:scripts/security-gate.ts > "$tmp/security-gate.ts" \
  && node "$tmp/security-gate.ts" <pr-body-file>; echo "gate exit=$?"; rm -rf "$tmp"
```

Write the PR body to that file with a file-write tool or a quoted heredoc (`<<'EOF'`); never `printf`/`echo` it
inside double quotes, where its backticked paths would run as commands.

The launcher exports the gate, the scanner and their configs (`GATE_FILES` in `scripts/security-gate.ts`: the
`security-scan*.ts`, `security-eslint.ts` and `security-new-deps.ts` scripts, the `security-eslint-stack/` lockfile,
`security-rules.sha256`, `security-tools.sha256`, `setup-security-tools.sh`, `security/approved-deps.txt`,
`security/eslint-tuning.json`, `.gitleaks.toml`, `deny.toml`, `.semgrep/`, `security/checks/`) **from `origin/main`** into a temp dir and runs
that copy, so a branch cannot weaken its own gate; changes to them take effect only after they merge. If
`origin/main` has no gate yet (the gate's own first merge into a repo), run the branch's copy once with
`SECURITY_GATE_BOOTSTRAP=1 node scripts/security-gate.ts <pr-body-file>`; it is ignored once main has a gate.
Exit 0 = may merge; 4 = refused. Merge exactly the commit the gate judged: `gh pr merge --match-head-commit <sha>`
after checking `gh pr view --json headRefOid` equals that `HEAD` (the `create-pr` skill does both).

## 1. Machine half — `scripts/security-scan.ts`

Runs inside the gate over the merged diff (`--base origin/main`); run it on demand with
`node scripts/security-scan.ts [--base <ref>] [--report <file.json>]`.
Install the pinned tools once per machine with **origin/main's copy** of the setup script (it is a gate file):

```bash
tmp=$(mktemp -d) && git show origin/main:scripts/setup-security-tools.sh > "$tmp/setup.sh" && bash "$tmp/setup.sh"; rm -rf "$tmp"
```

It installs into the main checkout's untracked `.tooling/security/`: release binaries verified against pinned
sha256 values, semgrep and zizmor in a venv, Semgrep rule packs checked against the tracked
`scripts/security-rules.sha256`, and the ESLint stack (`eslint`, `typescript-eslint`, `typescript`,
`eslint-plugin-security`, `eslint-plugin-no-unsanitized`) installed with `npm ci --ignore-scripts` from the gate's
`scripts/security-eslint-stack/package-lock.json` into `.tooling/security/eslint`. **Every scan re-hashes** each
scanner binary (semgrep: its native `semgrep-core`) and the ESLint stack's tree against
`scripts/security-tools.sha256`, so a binary swapped after install fails the scan. Updating a tool version means
updating the script's pins and that file together, in a gate-change PR. Known gap: the PyPI tools' transitive
Python dependencies (and semgrep's Python layer) are version-resolved, not hash-pinned. `SECURITY_TOOLS_DIR`,
`SECURITY_RULES_DIR` and `SECURITY_ESLINT_DIR` point the scan at tools installed elsewhere.

| Check | Tool | Fails on (finding id) |
|---|---|---|
| Secrets in the merged commits | gitleaks (`.gitleaks.toml`) | any credential pattern, values redacted (`secret:<fingerprint>`) |
| Static analysis of changed files | Semgrep: pinned registry packs (`default`, `secrets`, `r2c-security-audit`, `typescript`, `nodejsscan`) + the repo's `.semgrep/` rules | ERROR/WARNING findings introduced by this diff (`sast:<rule>@<file>:<line>`); a file it could not parse (`sast-error:<type>@<file>`) |
| Known-vulnerable dependencies | osv-scanner | a vulnerable package/version the diff adds (`vuln:<id>:<pkg>@<version>`) |
| Rust crate sources | cargo-deny (`deny.toml`, `--frozen`) on an isolated copy of HEAD | any non-crates.io source or ban, lockfile drift (`cargo-deny:<code>`) |
| JS/TS security lint, changed lines only | ESLint via `scripts/security-eslint.ts` and the pinned stack: eslint-plugin-security, eslint-plugin-no-unsanitized, typescript-eslint type-aware rules | an error on a line this diff added or changed, or a file it cannot parse (`eslint:<rule>@<file>:<line>`) |
| GitHub Actions | zizmor | medium+ workflow issues when workflows change (`actions:<rule>@<file>:<line>`) |
| New dependency names | `scripts/security-new-deps.ts` | a new crate/npm name that does not exist, is < 90 days old, or has little adoption → **held for the owner** (`newdep:<eco>:<name>`, exit 3) |
| Gate and approval files | the scan itself | any change to a `GATE_FILES` path or a `.semgrepignore` / `.gitleaksignore`, deletions and renames included → **held for the owner** (`gate-change:<path>`, exit 3) |
| Scan inputs | the scan itself | any change to a `package.json`, `package-lock.json`, `tsconfig*.json`, `jsconfig.json` or `.gitattributes` (they steer the ESLint pass and the exports) → **held for the owner** (`gate-input:<path>`, exit 3) |
| Lockfiles the dependency guard cannot read | the scan itself | any change to `yarn.lock`, `pnpm-lock.yaml`, `bun.lock[b]`, `uv.lock`, `Pipfile.lock`, `Gemfile.lock`, `poetry.lock`, `go.sum`, `requirements*.txt` → **held for the owner** (`lockfile:<path>`, exit 3) |
| Project checks | `security/checks/*` | whatever the project's own checks report (`check:<file>:<id>`) |

Exit codes: 0 clean, 1 findings, 2 setup/scanner error, 3 held.

**The branch cannot switch the scanners off.** Scanners judge committed content only: gitleaks reads the merged
commits, and Semgrep, ESLint, zizmor and cargo-deny read a `git archive` export of HEAD (Semgrep's baseline is
the same scan of an export of the merge base, matched by rule, file and matched text), made with no
`.gitattributes` applied, so an uncommitted edit, an untracked file or a branch `export-ignore` cannot change
what is judged. The scan refuses a HEAD that commits a `node_modules` directory or symlink anywhere. Every scanner and project
check runs with a minimal environment
(`PATH`, locale, temp dir, proxy/CA settings and a throwaway `HOME`; no tokens), and in-repo suppressions are
disabled: gitleaks ignores `gitleaks:allow` comments and the branch's `.gitleaksignore`, and always uses the
gate's `.gitleaks.toml` (missing → exit 2); Semgrep runs with `--disable-nosem` and no file-size limit; zizmor
runs with `--no-config --no-ignores`; every `.semgrepignore` is removed from the exports; ESLint ignores
`eslint-disable` comments, never loads the branch's `eslint.config.*`, and imports nothing from the repo. For
type information the export gets HEAD's **committed** root `package.json` + `package-lock.json` installed with
`npm ci --ignore-scripts` (cached under `.tooling/security/types/<lockfile sha256>`), never the worktree's
`node_modules`, so an uncommitted `.d.ts` edit cannot change the types; without a committed root lockfile the
pass runs without dependency types. cargo-deny runs `cargo metadata`, which would honour the branch's `.cargo/config.toml`
(`rustc-wrapper`, credential providers, source replacement) and `rust-toolchain` files, so it judges a `git archive`
copy of HEAD with those removed, an isolated `CARGO_HOME` holding a copy of the crates.io index (tens of MB) and
only the crate archives the lockfiles pin, no wrapper, offline and locked. It runs once per touched workspace root
(the nearest directory above a changed `Cargo.toml`/`Cargo.lock` holding both files); a manifest with no lockfile
above it is skipped. A cargo-deny crash (it could not resolve the graph) fails the scan (exit 2); only a
policy diagnostic is an acknowledgeable finding. Known limitation: a git-sourced crate cannot be resolved
offline, so it fails the scan rather than being judged. A missing tool, a scanner error or an invalid
report fails closed (exit 2, no merge). A finding is either **fixed**, or acknowledged in the PR body on its own
line as `security-ack: <finding id> — <why it is safe>` (a false positive, or a reviewed and justified use); the
line must start with `security-ack: ` and the id must match exactly.

Held findings need the owner, not just an ack:

- **New dependency** (`newdep:*`): also a line `<ecosystem>:<name> — <owner's words, date>` in
  `security/approved-deps.txt` **as merged on `origin/main`** (the gate reads it from there, so a branch cannot
  approve its own dependency). Approve in a small PR of its own, merged first.
- **Gate change** (`gate-change:<path>`), **scan input** (`gate-input:<path>`) or **unparseable lockfile** (`lockfile:<path>`): the ack line itself
  quotes the owner: `security-ack: <id> — owner sign-off: "<owner words>"` (opening and closing quote).

An ack needs a non-blank reason after ` — `.

### Extending the gate in your project

Scaffold ships the gate; projects add their own checks and tuning without forking it. All three extension points are gate files
(read from `origin/main`, changes held for owner sign-off):

- **`.semgrep/`** — your own Semgrep rules (a directory of rule YAML), loaded alongside the pinned packs when
  present. Use it for framework- or engine-specific patterns (unsafe deserializers, dynamic loaders, your own
  dangerous APIs).
- **`security/checks/`** — any extra tool. Each file runs with the repo as cwd and arguments
  `--base <merge-base> -- <changed paths...>` (`.ts` files run with `node`; anything else must be executable)
  and must print a JSON array of `{ "id", "at", "msg" }` and exit 0. Findings are recorded as
  `check:<file>:<id>` and acknowledged like any other; a non-zero exit or invalid output fails the scan closed.
- **`security/eslint-tuning.json`** — tune the security ESLint pass: `{ "rules": { "<rule>": "off" | "error" },
  "ignores": ["<glob>"] }`, applied last (e.g. `"security/detect-possible-timing-attacks": "off"`, or
  `"security/detect-non-literal-fs-filename": "error"` to turn on a rule left off for noise). Without the pinned
  ESLint stack a change to a JS/TS file fails the scan closed. Type-aware rules
  need the file in a `tsconfig.json` project; a file outside one is reported as `eslint:parse@<file>:<line>`.

Scaffold sync ships `deny.toml` and `.gitleaks.toml` as starting points. Once you customise one (an allowlist
entry), add it to `.scaffold-keep` so sync never overwrites it. `security/approved-deps.txt`, `.semgrep/`,
`security/checks/` and `security/eslint-tuning.json` are never shipped by scaffold, so they are always yours; create
`security/approved-deps.txt` (one `<ecosystem>:<name> — <owner words, date>` line per approval) when the owner
first approves a held dependency.

### What the gate cannot prove

- **An owner sign-off is text, not authentication.** `owner sign-off: "…"` on an ack line, and a line in
  `security/approved-deps.txt`, are checked for their shape only. While agents run with the owner's own
  credentials (git push, `gh`, the PR body), an agent can write those lines and the gate cannot tell. The
  approvals record a decision and make it reviewable after the fact. They do not stop an agent that ignores the
  rules. The real fix is sandboxed agents without the owner's credentials (separate bot accounts that cannot
  edit `main`, protected branches requiring a human approving review, CODEOWNERS on the gate files).
- **The gate is a check agents run, not a barrier.** It is enforced only as far as the workflow runs it before
  merging (the `create-pr` skill does). A server-side required check or branch protection is what enforces it.
- **The ESLint pass runs JavaScript** (ESLint, the plugins, TypeScript) in-process with the operator's rights. It
  loads only the pinned stack (installed from the gate's lockfile without install scripts, tree-hash verified every
  scan) and never imports from the repo; TypeScript reads type declarations from HEAD's committed lockfile,
  installed without scripts.
- **PyPI dependencies of semgrep and zizmor** are version-resolved, not hash-pinned (see setup).

## 2. Human half — the line-by-line review

The PR body carries a `## Security review` section that **names every changed file as `` `path` ``**
(backticked, exact; the gate checks every path of the merged diff) and, per file, what the change does from a
security point of view. Rules (the first is a rule, not machine-checked):

- **The reviewer is not the author.** Lane code is reviewed by the orchestrator. Code the orchestrator
  wrote is reviewed by an independent review agent given only the diff and this checklist.
- **Read every changed line**, including tests, scripts, CI, configs and docs that agents will read.
- Record findings and their resolution; "no security impact" is a valid conclusion for a file, stated
  with the reason.
- **End with `### Human review focus`** inside the section: a short Q&A for the owner naming the few hunks
  where a person's judgment changes the merge (product intent, durable contracts, data or security blast
  radius, anything marked `[unverified]`), each as `` `path:line` — <specific question> ``, ranked by blast
  radius. The agent review stays line by line; this list is what a human reads first. "None — leaf change;
  every check is machine-decided" is valid when true. (AGENTS.md, *Review economics*.)

### Checklist (OWASP Top 10 / CWE Top 25)

**Untrusted input** — users, peers, bug reports, shared files and saves, downloaded manifests, web requests,
environment, user-writable directories.
- [ ] Every value from an untrusted source is validated (type, length, range, charset) before use.
- [ ] No unbounded allocation, loop or recursion driven by input sizes (DoS); decoders never panic or index
      unchecked on untrusted bytes.
- [ ] No engine/framework deserialization that can construct objects, and no dynamic code or resource loading,
      from user-writable or downloaded paths.
- [ ] Text from users or peers is shown as plain text (no markup/HTML interpretation).

**Injection and execution**
- [ ] No shell strings built from data; commands use argument arrays (`execFile`/`spawn` with a fixed program)
      and no data reaches them unless validated.
- [ ] No `eval`, dynamic `import()` of data, `curl | sh`, or downloaded code run without a pinned hash.
- [ ] Paths built from data are confined (no `..`, absolute paths, symlinks); no fixed `/tmp` paths in
      shipped code.
- [ ] HTML/XML/JSON/SQL output escapes data for its context.

**Secrets and auth**
- [ ] No secret, token, key or access code in code, tests, logs, docs, PR text or public posts.
- [ ] Auth checks on every new endpoint; constant-time comparison for secrets; tokens stored hashed.
- [ ] Rate limits and size caps on anything anonymous or cheap to call; uniform errors (no existence
      oracles).
- [ ] Credentials are read from their files at use, never copied into env for child processes that do
      not need them.

**Supply chain**
- [ ] New dependencies are necessary, real, maintained and pinned; lockfiles committed; vendored files
      have a recorded source and hash.
- [ ] Downloads in scripts verify a pinned checksum; GitHub Actions pinned by commit SHA.

**Shipped client and updates**
- [ ] Anything an installer or updater downloads and runs is integrity-checked against data we signed or pinned.
- [ ] Install paths are per-user and not writable by other local users.
- [ ] Debug/developer surfaces are off in release builds.

**Agents and prompt injection**
- [ ] Untrusted text (user reports, chat, web content, issue text) never becomes an agent instruction:
      not a task title, not a prompt block, not a file agents treat as rules, unless the owner approved
      it, and then only quoted as evidence.
- [ ] Changes to `AGENTS.md`, `skills/`, `.githooks/`, `.github/`, the gate's own
      files, release and deploy scripts get extra scrutiny: they steer agents or run with credentials.
- [ ] Lanes never gain push, deploy, release or credential access through the change.

## Recording

Keep audit findings in a private location your project chooses (not linked from public pages: keep the
security surface obscure). New findings from a review that are not fixed in the same PR get a queue task
tagged `SECURITY`.
