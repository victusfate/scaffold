## Instructions

Open the GitHub branch protection settings for the current repo and present a targeted checklist of what still needs to be configured. Direct-push protection for non-admins is assumed to already be in place — this skill focuses on the remaining items.

### Step 1 — detect repo

```bash
git remote get-url origin
```

Parse the output to extract `<owner>/<repo>`:
- SSH: `git@github.com:<owner>/<repo>.git`
- HTTPS: `https://github.com/<owner>/<repo>[.git]`

Construct the settings URL:
```
https://github.com/<owner>/<repo>/settings/branches
```

If the remote is not a GitHub URL, print the URL pattern and tell the user to substitute manually, then skip Step 2.

### Step 2 — check CI workflow exists

```bash
ls .github/workflows/ci.yml 2>/dev/null && echo "exists" || echo "missing"
```

If missing: warn that `CI / verify` won't appear as an available status check until `.github/workflows/ci.yml` is committed and a PR has run against it at least once. Tell the user to add the workflow first (the branch-protection setup doc in README.md has it).

### Step 3 — open the URL

```bash
open "<url>" 2>/dev/null || xdg-open "<url>" 2>/dev/null || true
```

Silently ignore failures — the URL is printed in Step 4 regardless.

### Step 4 — print the checklist

Output exactly:

---

**Branch protection settings:** <url>

Go to **Settings → Branches** and edit (or create) the rule for `main`.

The following are the remaining items to configure:

| Setting | Value |
|---|---|
| Require a pull request before merging | ✓ |
| Require status checks to pass before merging | ✓ |
| Required status check | `CI / verify` |
| Require branches to be up to date before merging | ✓ |
| Do not allow bypassing the above settings | ✓ (recommended) |

**Already in place:** direct pushes to `main` blocked for non-admins.

**Status check name** — `CI / verify` is the workflow name (`CI`) + job id (`verify`) from `.github/workflows/ci.yml`. If you rename either, update this required check to match.

**`CI / verify` not appearing in the dropdown?** It only shows up after at least one PR has run the workflow. Open a draft PR, let it run, close the PR, then come back here.

> **Future:** this skill will eventually call the GitHub API to apply these settings automatically (needs an admin token). For now the settings page is the fastest path.

---

### Step 5 — report

Confirm the URL was opened (or printed), note if the CI workflow was missing, and remind the user that `CI / verify` must have run at least once before it appears in the status-check dropdown.
