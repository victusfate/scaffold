## Instructions

Open the GitHub branch protection settings for the current repo and present a targeted checklist of what needs to be configured. All items are safe to enable even if already set.

### Step 1 — detect repo

```bash
git remote get-url origin
```

Parse the output to extract `<owner>/<repo>`:
- SSH: `git@github.com:<owner>/<repo>.git`
- HTTPS: `https://github.com/<owner>/<repo>[.git]`

Construct two settings URLs:
```
Rulesets (new UI): https://github.com/<owner>/<repo>/settings/rules
Classic (old UI):  https://github.com/<owner>/<repo>/settings/branches
```

If the remote is not a GitHub URL, print the URL patterns and tell the user to substitute manually, then skip Step 2.

### Step 2 — check CI workflow exists

```bash
ls .github/workflows/ci.yml 2>/dev/null && echo "exists" || echo "missing"
```

If missing: warn that `CI / verify` won't appear as an available status check until `.github/workflows/ci.yml` is committed and a PR has run against it at least once.

### Step 3 — open the URL

Try the rulesets URL first (new UI):
```bash
open "<rulesets-url>" 2>/dev/null || xdg-open "<rulesets-url>" 2>/dev/null || true
```

Silently ignore failures — both URLs are printed in Step 4 regardless.

### Step 4 — print the checklist

Output exactly:

---

**Branch ruleset settings:**
- New UI (rulesets): `<rulesets-url>`
- Classic UI:        `<classic-url>`

Go to **Settings → Rules → Rulesets** (or Settings → Branches for the classic UI) and edit (or create) the rule targeting `main`.

Check or confirm each of the following — all are safe to enable even if already set:

**Restrict who can push / update refs:**

| Setting | Value |
|---|---|
| Restrict updates | ✓ — blocks direct pushes to `main` for non-admins |
| Block force pushes | ✓ — prevents force-push even from admins |
| Restrict deletions | ✓ — prevents accidental branch deletion |

**Pull request requirements:**

| Setting | Value |
|---|---|
| Require a pull request before merging | ✓ |
| Require status checks to pass | ✓ |
| Required status check | `CI / verify` |
| Require branches to be up to date before merging | ✓ |

**Bypass list:** add `Repository admin` role with "Always allow" if you need to merge hotfixes directly in emergencies.

---

**Status check name** — `CI / verify` is the workflow name (`CI`) + job id (`verify`) from `.github/workflows/ci.yml`. If you rename either, update the required check to match.

**`CI / verify` not appearing in the dropdown?** It only shows up after at least one PR has run the workflow. Open a draft PR, let it run, close the PR, then come back here.

> **Future:** this skill will eventually call the GitHub API to apply these settings automatically (needs an admin token). For now the settings page is the fastest path.

---

### Step 5 — report

Confirm the URL was opened (or printed). Note if `ci.yml` is missing. Remind the user that all settings are idempotent — safe to tick even if already enabled.
