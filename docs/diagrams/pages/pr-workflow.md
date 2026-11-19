[← Scaffold at a glance](system-map.md)

# PR workflow

How one task becomes one merged PR: local gates first, real checks on GitHub, and a merge only the owner authorizes.

```mermaid
flowchart LR
  branch["Branch"] --> local["Local gates"]
  local["Local gates"] --> open["Open the PR"]
  open["Open the PR"] --> checks["Verify checks"]
  checks["Verify checks"] --> merge["Owner merges"]
```

- [Branch](#branch): Pull the latest main and cut a fresh branch for one independent task.
- [Local gates](#local-gates): Run the integration tests and make ci before opening anything.
- [Open the PR](#open-the-pr): /create-pr opens the PR with a structured body and starts watching its checks.
- [Verify checks](#verify-checks): Read the actual check conclusions on the final head, not the merge button.
- [Owner merges](#owner-merges): The owner authorizes the merge; it lands on main as one squash commit.

## Branch

Pull the latest main and cut a fresh branch for one independent task.

- One task per PR and merge cycle.

## Local gates

Run the integration tests and make ci before opening anything.

Goes deeper: [/create-pr skill](../../../skills/create-pr.md)

- Start from a clean tree with commits ahead of main.
- When a gate fails
  - Auto-correct up to 2 rounds.
  - Still red: open the PR as a DRAFT and list the red gates.
- Then bump the version and push.

## Open the PR

/create-pr opens the PR with a structured body and starts watching its checks.

Goes deeper: [Review gates](review-gates.md)

- /simplify scores every file 10/10 before opening.
- The body has a Summary, Critical changes, gate status and Quality Scores.
- Subscribe to the PR, or run gh pr checks --watch.

## Verify checks

Read the actual check conclusions on the final head, not the merge button.

Goes deeper: [Session continuity](session-continuity.md)

- Remove the handoff file, push, and run check-handoff --pre-merge.
- Capture the watch command's own exit code.
- The Security scan check must pass.

**Where it breaks**

- GitHub counts a skipped required check as passing; treat a skip as suspect.

## Owner merges

The owner authorizes the merge; it lands on main as one squash commit.

- A PR is not approval.
- The squash merge uses --match-head-commit, so only the commit whose checks were read can land.
- Confirm the PR is MERGED, pull main, and cut a fresh branch before the next task.

<details>
<summary>Detailed flow</summary>

![PR workflow, detailed](../generated/pr-workflow.svg)

</details>

## Glossary

- **make ci**: The local pre-merge gate: unit and heavy integration checks.
- **Critical changes**: Up to five path:line notes of what changed and what depends on it.
- **Squash merge**: One PR lands as one commit on main.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's agents take a task from branch to a merged PR safely.

PR workflow: How one task becomes one merged PR: local gates first, real checks on GitHub, and a merge only the owner authorizes.
- Branch: Pull the latest main and cut a fresh branch for one independent task.
- Local gates: Run the integration tests and make ci before opening anything.
- Open the PR: /create-pr opens the PR with a structured body and starts watching its checks.
- Verify checks: Read the actual check conclusions on the final head, not the merge button.
- Owner merges: The owner authorizes the merge; it lands on main as one squash commit.

Questions worth asking:
- Why isn't a green merge button enough?
```
