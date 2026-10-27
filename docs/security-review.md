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

The launcher exports the gate, the scanner and their configs (`GATE_FILES` in `scripts/security-gate.ts`:
`security-scan.ts`, `security-new-deps.ts`, `security-rules.sha256`, `security/approved-deps.txt`,
`.gitleaks.toml`, `deny.toml`, `.semgrep/`, `security/checks/`) **from `origin/main`** into a temp dir and runs
that copy, so a branch cannot weaken its own gate; changes to them take effect only after they merge. If
`origin/main` has no gate yet (the gate's own first merge into a repo), run the branch's copy once with
`SECURITY_GATE_BOOTSTRAP=1 node scripts/security-gate.ts <pr-body-file>`; it is ignored once main has a gate.
Exit 0 = may merge; 4 = refused.

## 1. Machine half — `scripts/security-scan.ts`

Runs inside the gate over the merged diff (`--base origin/main`); run it on demand with
`node scripts/security-scan.ts [--base <ref>] [--report <file.json>]`.
Install the pinned tools once per machine: `scripts/setup-security-tools.sh` (into the main checkout's
untracked `.tooling/security/`; binary sha256 pinned in the script, Semgrep rule-pack sha256 tracked in
`scripts/security-rules.sha256` and verified on every scan; known gap: the PyPI tools' (semgrep, zizmor)
transitive dependencies are version-resolved, not hash-pinned). `SECURITY_TOOLS_DIR` / `SECURITY_RULES_DIR`
point the scan at tools installed elsewhere.

| Check | Tool | Fails on (finding id) |
|---|---|---|
| Secrets in the merged commits | gitleaks (`.gitleaks.toml`) | any credential pattern, values redacted (`secret:<fingerprint>`) |
| Static analysis of changed files | Semgrep: pinned registry packs + the repo's `.semgrep/` rules | ERROR/WARNING findings introduced by this diff (`sast:<rule>@<file>:<line>`); a file it could not parse (`sast-error:<type>@<file>`) |
| Known-vulnerable dependencies | osv-scanner | a vulnerable package/version the diff adds (`vuln:<id>:<pkg>@<version>`) |
| Rust crate sources | cargo-deny (`deny.toml`, `--locked`) | any non-crates.io source, lockfile drift (`cargo-deny:sources-bans`) |
| GitHub Actions | zizmor | medium+ workflow issues when workflows change (`actions:<rule>@<file>:<line>`) |
| New dependency names | `scripts/security-new-deps.ts` | a new crate/npm name that does not exist, is < 90 days old, or has little adoption → **held for the owner** (`newdep:<eco>:<name>`, exit 3) |
| Gate and approval files | the scan itself | any change to a `GATE_FILES` path → **held for the owner** (`gate-change:<path>`, exit 3) |
| Project checks | `security/checks/*` | whatever the project's own checks report (`check:<file>:<id>`) |

Exit codes: 0 clean, 1 findings, 2 setup/scanner error, 3 held. A missing tool, a scanner error or an invalid
report fails closed (exit 2, no merge). A finding is either **fixed**, or acknowledged in the PR body on its own
line as `security-ack: <finding id> — <why it is safe>` (a false positive, or a reviewed and justified use); the
line must start with `security-ack: ` and the id must match exactly.

Held findings need the owner, not just an ack:

- **New dependency** (`newdep:*`): also a line `<ecosystem>:<name> — <owner's words, date>` in
  `security/approved-deps.txt` **as merged on `origin/main`** (the gate reads it from there, so a branch cannot
  approve its own dependency). Approve in a small PR of its own, merged first.
- **Gate change** (`gate-change:<path>`): the ack line itself quotes the owner:
  `security-ack: gate-change:<path> — owner sign-off: "<owner words>"`.

### Extending the gate in your project

Scaffold ships the gate; projects add their own checks without forking it. Both extension points are gate files
(read from `origin/main`, changes held for owner sign-off):

- **`.semgrep/`** — your own Semgrep rules (a directory of rule YAML), loaded alongside the pinned packs when
  present. Use it for framework- or engine-specific patterns (unsafe deserializers, dynamic loaders, your own
  dangerous APIs).
- **`security/checks/`** — any extra tool. Each file runs with the repo as cwd and arguments
  `--base <merge-base> -- <changed paths...>` (`.ts` files run with `node`; anything else must be executable)
  and must print a JSON array of `{ "id", "at", "msg" }` and exit 0. Findings are recorded as
  `check:<file>:<id>` and acknowledged like any other; a non-zero exit or invalid output fails the scan closed.

Scaffold sync ships `deny.toml`, `.gitleaks.toml` and `security/approved-deps.txt` as starting points. Once you
customise one (an allowlist entry, an approval), add it to `.scaffold-keep` so sync never overwrites it.
`.semgrep/` and `security/checks/` are never shipped by scaffold, so they are always yours.

## 2. Human half — the line-by-line review

The PR body carries a `## Security review` section that **names every changed file as `` `path` ``**
(backticked, exact; the gate checks every path of the merged diff) and, per file, what the change does from a
security point of view. Rules (the first is a rule, not machine-checked):

- **The reviewer is not the author.** Lane code is reviewed by the orchestrator. Code the orchestrator
  wrote is reviewed by an independent review agent given only the diff and this checklist.
- **Read every changed line**, including tests, scripts, CI, configs and docs that agents will read.
- Record findings and their resolution; "no security impact" is a valid conclusion for a file, stated
  with the reason.

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
