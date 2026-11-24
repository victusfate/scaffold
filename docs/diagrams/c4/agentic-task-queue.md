# Agentic task queue: C4

Takes work from several sources and has one worker run each task in isolation. A design: not every part is built.

Generated from [`agentic-task-queue.explorer.json`](../explorer/agentic-task-queue.explorer.json) by `scripts/render-c4.ts`; edit that, not this page. The same model as a Structurizr workspace: [`agentic-task-queue.dsl`](agentic-task-queue.dsl).

## Containers

```mermaid
flowchart LR
    p_owner(["Owner<br/>[Person]<br/>Adds work with /queue ingest<br/>and selects which assistant<br/>proposals enter the queue."])
    s_github["GitHub<br/>[Software system]<br/>Holds the queue: one task is<br/>one issue, with status,<br/>priority and project labels."]
    s_target["Target repo<br/>[Software system]<br/>The repository a task changes;<br/>work merges back into its<br/>integration branch."]
    subgraph sys["Agentic task queue [Software system]"]
        subgraph g_1["Dispatch"]
            c_ING["Ingestion sources<br/>[Container]<br/>Three ways work enters the<br/>queue as issues: a person<br/>running /queue ingest,<br/>automated watchers and cron<br/>hooks, and assistant proposals<br/>that wait for a human to<br/>select them."]
            c_DISP["Dispatch layer<br/>[Container]<br/>Stores every task as a GitHub<br/>issue for all projects,<br/>triggers workers by schedule<br/>or by event, and hands each<br/>task to one worker through an<br/>assign, verify and lease<br/>claim; a rare double claim is<br/>possible."]
        end
        subgraph g_2["Execution"]
            c_WORK["Workers<br/>[Container]<br/>The agents that claim and<br/>execute tasks: Claude routines<br/>and manual pulls in phase 1,<br/>with GitHub Action crons added<br/>in phase 2."]
            c_EXEC["Execution layer<br/>[Container]<br/>Runs one claimed task in its<br/>own worktree in the task's<br/>target repo, validates it, and<br/>merges it back into the<br/>integration branch, sending<br/>conflicts to an agent-driven<br/>reconciliation task."]
        end
    end
    p_owner -->|"Asks for work"| c_ING
    c_ING -->|"Work enters the queue"| c_DISP
    c_DISP -->|"Stores each task as an issue"| s_github
    c_DISP -->|"Claimed by one worker"| c_WORK
    c_WORK -->|"Target repo checked out"| c_EXEC
    c_EXEC -->|"Merges back into the integration branch"| s_target
    c_EXEC -->|"Marks the issue completed"| s_github
    classDef person fill:#08427b,stroke:#052e56,color:#ffffff;
    class p_owner person;
    classDef external fill:#999999,stroke:#6b6b6b,color:#ffffff;
    class s_github,s_target external;
    classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff;
    class c_ING,c_DISP,c_WORK,c_EXEC container;
```

<details>
<summary>Mermaid's native C4 syntax</summary>

```mermaid
C4Container
    title Agentic task queue: containers
    Person(p_owner, "Owner", "Adds work with /queue ingest and selects which assistant proposals enter the queue.")
    System_Ext(s_github, "GitHub", "Holds the queue: one task is one issue, with status, priority and project labels.")
    System_Ext(s_target, "Target repo", "The repository a task changes; work merges back into its integration branch.")
    System_Boundary(sys, "Agentic task queue") {
        Container(c_ING, "Ingestion sources", "", "Three ways work enters the queue as issues: a person running /queue ingest, automated watchers and cron hooks, and assistant proposals that wait for a human to select them.")
        Container(c_DISP, "Dispatch layer", "", "Stores every task as a GitHub issue for all projects, triggers workers by schedule or by event, and hands each task to one worker through an assign, verify and lease claim; a rare double claim is possible.")
        Container(c_WORK, "Workers", "", "The agents that claim and execute tasks: Claude routines and manual pulls in phase 1, with GitHub Action crons added in phase 2.")
        Container(c_EXEC, "Execution layer", "", "Runs one claimed task in its own worktree in the task's target repo, validates it, and merges it back into the integration branch, sending conflicts to an agent-driven reconciliation task.")
    }
    Rel(p_owner, c_ING, "Asks for work")
    Rel(c_ING, c_DISP, "Work enters the queue")
    Rel(c_DISP, s_github, "Stores each task as an issue")
    Rel(c_DISP, c_WORK, "Claimed by one worker")
    Rel(c_WORK, c_EXEC, "Target repo checked out")
    Rel(c_EXEC, s_target, "Merges back into the integration branch")
    Rel(c_EXEC, s_github, "Marks the issue completed")
```

</details>

## Ingestion to merge-back

```mermaid
flowchart LR
    p_owner(["Owner<br/>[Person]<br/>Adds work with /queue ingest<br/>and selects which assistant<br/>proposals enter the queue."])
    s_github["GitHub<br/>[Software system]<br/>Holds the queue: one task is<br/>one issue, with status,<br/>priority and project labels."]
    s_target["Target repo<br/>[Software system]<br/>The repository a task changes;<br/>work merges back into its<br/>integration branch."]
    subgraph sys["Agentic task queue [Software system]"]
        c_ING["Ingestion sources<br/>[Container]<br/>Three ways work enters the<br/>queue as issues: a person<br/>running /queue ingest,<br/>automated watchers and cron<br/>hooks, and assistant proposals<br/>that wait for a human to<br/>select them."]
        c_DISP["Dispatch layer<br/>[Container]<br/>Stores every task as a GitHub<br/>issue for all projects,<br/>triggers workers by schedule<br/>or by event, and hands each<br/>task to one worker through an<br/>assign, verify and lease<br/>claim; a rare double claim is<br/>possible."]
        c_WORK["Workers<br/>[Container]<br/>The agents that claim and<br/>execute tasks: Claude routines<br/>and manual pulls in phase 1,<br/>with GitHub Action crons added<br/>in phase 2."]
        c_EXEC["Execution layer<br/>[Container]<br/>Runs one claimed task in its<br/>own worktree in the task's<br/>target repo, validates it, and<br/>merges it back into the<br/>integration branch, sending<br/>conflicts to an agent-driven<br/>reconciliation task."]
    end
    p_owner -->|"1. Asks for work"| c_ING
    c_ING -->|"2. Work enters the queue"| c_DISP
    c_DISP -->|"3. Stores each task as an issue"| s_github
    c_DISP -->|"4. Claimed by one worker"| c_WORK
    c_WORK -->|"5. Target repo checked out"| c_EXEC
    c_EXEC -->|"6. Merges back into the integration branch"| s_target
    c_EXEC -->|"7. Marks the issue completed"| s_github
    classDef person fill:#08427b,stroke:#052e56,color:#ffffff;
    class p_owner person;
    classDef external fill:#999999,stroke:#6b6b6b,color:#ffffff;
    class s_github,s_target external;
    classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff;
    class c_ING,c_DISP,c_WORK,c_EXEC container;
```

<details>
<summary>Mermaid's native C4 syntax</summary>

```mermaid
C4Dynamic
    title Agentic task queue: Ingestion to merge-back
    Person(p_owner, "Owner", "Adds work with /queue ingest and selects which assistant proposals enter the queue.")
    System_Ext(s_github, "GitHub", "Holds the queue: one task is one issue, with status, priority and project labels.")
    System_Ext(s_target, "Target repo", "The repository a task changes; work merges back into its integration branch.")
    System_Boundary(sys, "Agentic task queue") {
        Container(c_ING, "Ingestion sources", "", "Three ways work enters the queue as issues: a person running /queue ingest, automated watchers and cron hooks, and assistant proposals that wait for a human to select them.")
        Container(c_DISP, "Dispatch layer", "", "Stores every task as a GitHub issue for all projects, triggers workers by schedule or by event, and hands each task to one worker through an assign, verify and lease claim; a rare double claim is possible.")
        Container(c_WORK, "Workers", "", "The agents that claim and execute tasks: Claude routines and manual pulls in phase 1, with GitHub Action crons added in phase 2.")
        Container(c_EXEC, "Execution layer", "", "Runs one claimed task in its own worktree in the task's target repo, validates it, and merges it back into the integration branch, sending conflicts to an agent-driven reconciliation task.")
    }
    Rel(p_owner, c_ING, "Asks for work")
    Rel(c_ING, c_DISP, "Work enters the queue")
    Rel(c_DISP, s_github, "Stores each task as an issue")
    Rel(c_DISP, c_WORK, "Claimed by one worker")
    Rel(c_WORK, c_EXEC, "Target repo checked out")
    Rel(c_EXEC, s_target, "Merges back into the integration branch")
    Rel(c_EXEC, s_github, "Marks the issue completed")
```

</details>
