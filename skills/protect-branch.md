## Instructions

Open the GitHub rulesets settings for the current repo and present the exact configuration checklist. All items are safe to enable even if already set.

### Step 1 — detect repo

```bash
git remote get-url origin
```

Parse the output to extract `<owner>/<repo>`:
- SSH: `git@github.com:<owner>/<repo>.git`
- HTTPS: `https://github.com/<owner>/<repo>[.git]`

Construct the settings URL:
```
https://github.com/<owner>/<repo>/settings/rules
```

If the remote is not a GitHub URL, print the URL pattern and tell the user to substitute manually, then skip Step 2.

### Step 2 — check CI workflow and CODEOWNERS exist

```bash
ls .github/workflows/ci.yml 2>/dev/null && echo "ci: exists" || echo "ci: missing"
ls CODEOWNERS 2>/dev/null && echo "codeowners: exists" || echo "codeowners: missing"
```

- If `ci.yml` missing: warn that the `verify` status check won't exist until it's present and has run on at least one PR targeting main.
- If `CODEOWNERS` missing: note it should be added — scaffold ships one at repo root.

### Step 3 — open the URL

```bash
open "<url>" 2>/dev/null || xdg-open "<url>" 2>/dev/null || true
```

Silently ignore failures — the URL is printed in Step 4 regardless.

### Step 4 — print the checklist

Output exactly:

---

**[→ Open branch ruleset settings](<url>)**

Go to **Settings → Rules → Rulesets**, edit (or create) the ruleset targeting `main`, and confirm each item below. All are safe to enable even if already set.

**Restrict pushes:**

| Setting | Value |
|---|---|
| Block force pushes | ✓ |
| Restrict deletions | ✓ |

**Require pull requests:**

| Setting | Value |
|---|---|
| Require a pull request before merging | ✓ |
| Required approvals | `1` |
| Dismiss stale reviews when new commits are pushed | ✓ |
| Require review from Code Owners | ✓ |

> **Required approvals: 1** — the GitHub API rejects merge calls with no approval on record. Agents can't auto-merge without an explicit approval step.

> **Dismiss stale reviews** — if new commits are pushed after an approval, the approval is dismissed and must be re-given. Closes the loophole of getting approval then pushing tampered code.

> **Require review from Code Owners** — `CODEOWNERS` requires `@<owner>` approval on any PR touching `.github/workflows/`. An agent can't quietly weaken CI and then merge — workflow changes always need explicit human sign-off. Normal PRs just need 1 approval from any reviewer.

> **Known limitation — agents share your GitHub token.** Agents in this workflow run as your GitHub account. GitHub has no way to distinguish an agent approval from a human one — "Required approvals: 1" can technically be satisfied by the agent approving its own PR via the API. The practical guards are: (1) CI must pass, (2) any workflow change requires your sign-off via CODEOWNERS, (3) an agent would need to be explicitly instructed to self-approve, which is detectable. The clean long-term fix is a dedicated bot GitHub account for the agent — then "prevent authors from approving their own PRs" works correctly and you can still approve agent PRs as yourself.

**Require status checks:**

1. Enable **Require status checks to pass**
2. Expand **Hide additional settings** and enable **Require branches to be up to date before merging**
3. Click **+ Add checks**, type `verify`, select **verify — GitHub Actions**

> **`verify` not appearing in the dropdown?** It only shows up after at least one PR has run the CI workflow. Open a draft PR, wait for CI to run, then come back here and add it.

**Bypass list:** Add `Repository admin` → Always allow (for emergency hotfixes).

---

### Step 5 — report

Confirm the URL was opened (or printed). Note any missing files. Remind the user to close any draft PR opened just to trigger the check registration.
