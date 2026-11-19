# Scaffold at a glance

Scaffold gives AI coding agents shared skills, rules and workflows. Click any skill link below the map for its own page; each page starts high level and drills down to the full detail.

```mermaid
flowchart LR
  subgraph l_run["Run the work"]
    n_orchestration["Orchestration"]
    n_queue["Queue"]
    n_loop["Loop tick"]
    n_continuity["Save, pause, resume"]
  end
  subgraph l_build["Build"]
    n_feature["Feature chain"]
    n_tdd["TDD"]
    n_pr["PR workflow"]
  end
  subgraph l_quality["Quality"]
    n_gates["Review gates"]
    n_qa["QA"]
    n_investigate["Investigate"]
    n_prune["Prune"]
    n_linter["Add linter"]
  end
  subgraph l_share["Share and improve"]
    n_sync["Scaffold sync"]
    n_skillify["Skillify"]
    n_retro["Retro"]
  end
  subgraph l_tools["Specialist tools"]
    n_council["Council"]
    n_mindmeld["Mind meld"]
  end
  n_queue --> n_orchestration
  n_orchestration --> n_feature
  n_feature --> n_pr
  n_pr --> n_sync
  n_tdd --> n_gates
  n_gates --> n_qa
  n_retro --> n_skillify
  n_skillify --> n_sync
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  classDef lane2 fill:#ddd6fe,stroke:#6d28d9,color:#1f2937
  classDef lane3 fill:#fde68a,stroke:#b45309,color:#1f2937
  classDef lane4 fill:#fecaca,stroke:#b91c1c,color:#1f2937
  class n_orchestration,n_queue,n_loop,n_continuity lane0
  class n_feature,n_tdd,n_pr lane1
  class n_gates,n_qa,n_investigate,n_prune,n_linter lane2
  class n_sync,n_skillify,n_retro lane3
  class n_council,n_mindmeld lane4
  style l_run fill:#f9fafb,stroke:#d1d5db,color:#374151
  style l_build fill:#f9fafb,stroke:#d1d5db,color:#374151
  style l_quality fill:#f9fafb,stroke:#d1d5db,color:#374151
  style l_share fill:#f9fafb,stroke:#d1d5db,color:#374151
  style l_tools fill:#f9fafb,stroke:#d1d5db,color:#374151
```

- [Orchestration](orchestration.md): One orchestrator per session owns the plan and the branch; subagents do one task each in their own worktree.
- [Queue](queue-lifecycle.md): A visible, editable task list that agents drain one task at a time or in parallel.
- [Loop tick](loop-tick.md): The heartbeat that picks the next queue task and keeps work moving.
- [Save, pause, resume](session-continuity.md): Checkpoint a long session into git so it survives a close and resumes anywhere.
- [Feature chain](feature-chain.md): Design, PRD, TDD, refine and QA, ending in a PR for the owner.
- [TDD](tdd.md): Build in thin vertical slices: failing test, minimal code, refactor.
- [PR workflow](pr-workflow.md): One task per PR, real CI checks, squash merge only with owner approval.
- [Review gates](review-gates.md): Independent correctness and structure reviews, one fix pass, re-verified.
- [QA](qa.md): Drive the real app the way a user would and fix what breaks.
- [Investigate](investigate.md): Find the root cause before changing code.
- [Prune](prune.md): Run every quality lens, then fix the findings through the feature chain.
- [Add linter](add-linter.md): Add linter configs and CI workflows for each language in a repo.
- [Scaffold sync](scaffold-sync.md): Sync skills down to consumer repos, upstream improvements, hoist skills out.
- [Skillify](skillify.md): Turn finished work into a reusable, registered skill.
- [Retro](retro.md): An evidence-backed look back at a session that proposes concrete fixes.
- [Council](council.md): Five advisors, anonymous peer review and a chairman verdict for hard decisions.
- [Mind meld](mind-meld.md): A repo-owned learning IDE built from code indexes and real runs.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants an overview of scaffold, a template that gives AI coding agents
shared skills, rules and workflows, and how its skills fit together.
Read this page:
https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/system-map.md
Scaffold: https://github.com/victusfate/scaffold
```
