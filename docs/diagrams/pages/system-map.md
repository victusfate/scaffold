# Scaffold at a glance

Scaffold gives AI coding agents shared skills, rules and workflows. Click any skill link below the map for its own page; each page starts high level and drills down to the full detail.

```mermaid
flowchart LR
  subgraph run["Run the work"]
    orchestration["Orchestration"]
    queue["Queue"]
    loop["Loop tick"]
    continuity["Save, pause, resume"]
  end
  subgraph build["Build"]
    feature["Feature chain"]
    tdd["TDD"]
    pr["PR workflow"]
  end
  subgraph quality["Quality"]
    gates["Review gates"]
    qa["QA"]
    investigate["Investigate"]
    prune["Prune"]
    linter["Add linter"]
  end
  subgraph share["Share and improve"]
    sync["Scaffold sync"]
    skillify["Skillify"]
    retro["Retro"]
  end
  subgraph tools["Specialist tools"]
    council["Council"]
    mindmeld["Mind meld"]
    voice["Voice chat"]
  end
  queue --> orchestration
  orchestration --> feature
  feature --> pr
  pr --> sync
  tdd --> gates
  gates --> qa
  retro --> skillify
  skillify --> sync
```

- [Orchestration](#orchestration): One orchestrator per session owns the plan and the branch; subagents do one task each in their own worktree.
- [Queue](#queue): A visible, editable task list that agents drain one task at a time or in parallel.
- [Loop tick](#loop-tick): The heartbeat that picks the next queue task and keeps work moving.
- [Save, pause, resume](#save-pause-resume): Checkpoint a long session into git so it survives a close and resumes anywhere.
- [Feature chain](#feature-chain): Design, PRD, TDD, refine and QA, ending in a PR for the owner.
- [TDD](#tdd): Build in thin vertical slices: failing test, minimal code, refactor.
- [PR workflow](#pr-workflow): One task per PR, real CI checks, squash merge only with owner approval.
- [Review gates](#review-gates): Independent correctness and structure reviews, one fix pass, re-verified.
- [QA](#qa): Drive the real app the way a user would and fix what breaks.
- [Investigate](#investigate): Find the root cause before changing code.
- [Prune](#prune): Run every quality lens, then fix the findings through the feature chain.
- [Add linter](#add-linter): Add linter configs and CI workflows for each language in a repo.
- [Scaffold sync](#scaffold-sync): Sync skills down to consumer repos, upstream improvements, hoist skills out.
- [Skillify](#skillify): Turn finished work into a reusable, registered skill.
- [Retro](#retro): An evidence-backed look back at a session that proposes concrete fixes.
- [Council](#council): Five advisors, anonymous peer review and a chairman verdict for hard decisions.
- [Mind meld](#mind-meld): A repo-owned learning IDE built from code indexes and real runs.
- [Voice chat](#voice-chat): A hands-free voice loop with the coding agent.

## Orchestration

One orchestrator per session owns the plan and the branch; subagents do one task each in their own worktree.

Goes deeper: [Orchestration](orchestration.md)

## Queue

A visible, editable task list that agents drain one task at a time or in parallel.

Goes deeper: [Queue task lifecycle](queue-lifecycle.md)

## Loop tick

The heartbeat that picks the next queue task and keeps work moving.

Goes deeper: [One loop tick](loop-tick.md)

## Save, pause, resume

Checkpoint a long session into git so it survives a close and resumes anywhere.

Goes deeper: [Session continuity](session-continuity.md)

## Feature chain

Design, PRD, TDD, refine and QA, ending in a PR for the owner.

Goes deeper: [Feature chain](feature-chain.md)

## TDD

Build in thin vertical slices: failing test, minimal code, refactor.

Goes deeper: [TDD](tdd.md)

## PR workflow

One task per PR, real CI checks, squash merge only with owner approval.

Goes deeper: [PR workflow](pr-workflow.md)

## Review gates

Independent correctness and structure reviews, one fix pass, re-verified.

Goes deeper: [Review gates](review-gates.md)

## QA

Drive the real app the way a user would and fix what breaks.

Goes deeper: [QA](qa.md)

## Investigate

Find the root cause before changing code.

Goes deeper: [Investigate](investigate.md)

## Prune

Run every quality lens, then fix the findings through the feature chain.

Goes deeper: [Prune](prune.md)

## Add linter

Add linter configs and CI workflows for each language in a repo.

Goes deeper: [Add linter](add-linter.md)

## Scaffold sync

Sync skills down to consumer repos, upstream improvements, hoist skills out.

Goes deeper: [Scaffold sync](scaffold-sync.md)

## Skillify

Turn finished work into a reusable, registered skill.

Goes deeper: [Skillify](skillify.md)

## Retro

An evidence-backed look back at a session that proposes concrete fixes.

Goes deeper: [Retro](retro.md)

## Council

Five advisors, anonymous peer review and a chairman verdict for hard decisions.

Goes deeper: [Council](council.md)

## Mind meld

A repo-owned learning IDE built from code indexes and real runs.

Goes deeper: [Mind meld](mind-meld.md)

## Voice chat

A hands-free voice loop with the coding agent.

Goes deeper: [Voice chat](voice-chat.md)

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants an overview of scaffold, a template that gives AI coding agents shared skills, rules and workflows, and how its skills fit together.

Scaffold at a glance: Scaffold gives AI coding agents shared skills, rules and workflows. Click any skill link below the map for its own page; each page starts high level and drills down to the full detail.
- Orchestration: One orchestrator per session owns the plan and the branch; subagents do one task each in their own worktree.
- Queue: A visible, editable task list that agents drain one task at a time or in parallel.
- Loop tick: The heartbeat that picks the next queue task and keeps work moving.
- Save, pause, resume: Checkpoint a long session into git so it survives a close and resumes anywhere.
- Feature chain: Design, PRD, TDD, refine and QA, ending in a PR for the owner.
- TDD: Build in thin vertical slices: failing test, minimal code, refactor.
- PR workflow: One task per PR, real CI checks, squash merge only with owner approval.
- Review gates: Independent correctness and structure reviews, one fix pass, re-verified.
- QA: Drive the real app the way a user would and fix what breaks.
- Investigate: Find the root cause before changing code.
- Prune: Run every quality lens, then fix the findings through the feature chain.
- Add linter: Add linter configs and CI workflows for each language in a repo.
- Scaffold sync: Sync skills down to consumer repos, upstream improvements, hoist skills out.
- Skillify: Turn finished work into a reusable, registered skill.
- Retro: An evidence-backed look back at a session that proposes concrete fixes.
- Council: Five advisors, anonymous peer review and a chairman verdict for hard decisions.
- Mind meld: A repo-owned learning IDE built from code indexes and real runs.
- Voice chat: A hands-free voice loop with the coding agent.
```
