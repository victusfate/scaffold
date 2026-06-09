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

### Step 2 — check CI workflow exists

```bash
ls .github/workflows/ci.yml 2>/dev/null && echo "exists" || echo "missing"
```

If missing: warn that the `verify` status check won't exist until `.github/workflows/ci.yml` is present and has run on at least one PR targeting main.

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

**Require status checks:**

1. Enable **Require status checks to pass**
2. Expand **Hide additional settings** and enable **Require branches to be up to date before merging**
3. Click **+ Add checks**, type `verify`, select **verify — GitHub Actions**

> **`verify` not appearing in the dropdown?** It only shows up after at least one PR has run the CI workflow. Open a draft PR, wait for CI to run, then come back here and add it.

**Bypass list:** Add `Repository admin` → Always allow (lets admins push hotfixes directly).

---

### Step 5 — report

Confirm the URL was opened (or printed). Note if `ci.yml` is missing. Remind the user to close any draft PR opened just to trigger the check registration.
