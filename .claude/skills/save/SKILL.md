---
description: Lightweight incremental checkpoint for a long autonomous run — refresh the handoff, commit converged work, and push, fired frequently (after each subagent merge, periodically, and when nearing the rate-limit → then ScheduleWakeup past the window reset). Complements /pause (deliberate one-shot handoff) and /resume (the reader). Use on "save", "save progress", "checkpoint this step", or /save.
---

@../../../skills/save.md
