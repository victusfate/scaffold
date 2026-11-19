---
name: dependency-watch
description: |
  Install a scheduled dependency and runtime vulnerability watch in this repo. It runs osv-scanner and a runtime-pin check (Ruby, Node, Python, Go behind the latest patch or end-of-life) into one tracking issue, and sets up security-only Dependabot PRs. Use when asked to scan dependencies on a schedule, catch new vulnerabilities faster, auto-patch vulnerable dependencies, or set up Dependabot.
license: MIT
metadata:
  author: victusfate
  version: "1.0"
---

Read and follow the complete skill instructions in [`skills/dependency-watch.md`](../../../skills/dependency-watch.md).
