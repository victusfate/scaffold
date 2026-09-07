# Agent loop implementation plan

1. Implement and test the external CLI lifecycle: interval + argv through timer
   creation, serial execution, bounded retries, status/logs, and stop/cancel.
2. Add the canonical skill and generated harness registrations; include the
   user's lane/queue example and explain natural-language handoff and native routing.
3. Run local gates and harmless systemd smoke; independent correctness and
   structural review; open scaffold PR. Do not merge or install in VoidHorizon.

The supplied example resolves the interface. Tests target the public CLI and
consumer discovery, not copied wording. Keep development on feat/agent-loop.
