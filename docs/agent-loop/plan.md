# Agent loop implementation plan

1. Implement and test the external CLI lifecycle: interval + argv through
   supervisor startup, serial execution, bounded retries, status/logs, and stop/cancel.
2. Add the canonical skill and generated harness registrations; include the
   user's lane/queue example and explain natural-language handoff and native routing.
3. Run local gates and harmless cross-platform supervisor smoke; independent correctness and
   structural review; open scaffold PR. Do not merge or install in VoidHorizon.

The supplied example resolves the interface. Tests target the public CLI and
consumer discovery, not copied wording. Keep development on feat/agent-loop.

Cross-OS revision: replace the initial systemd-only implementation before PR,
not alongside it. Keep CLI syntax unchanged and test the same public lifecycle
on Windows, macOS, and Linux through a dedicated CI matrix.

## Steering extension — September 8

User direction: recurring work belongs to the main orchestrator. Interactive
steering should reach that orchestrator by default; workers receive bounded
assignments and are retasked by the main agent.

One vertical slice adds `steer --message TEXT` (or `--message-file PATH`),
`inbox`, and `ack --id ID --outcome applied|deferred|blocked` to the public CLI.
Messages are private, durable, generation-scoped, and retained until explicitly
acknowledged. Polling never consumes them; retries after a crash see the same ID.
Record a note for deferred/blocked decisions so acknowledgment cannot masquerade
as completion. Old-generation records remain inspectable, not silently replayed.
Steering requires a live non-stopping loop; never restart a stopped loop to send it.

Use the existing control lock with bounded contention retries and atomic saves.
Status exposes pending counts, not message text. Preserve arbitrary command argv
exactly. The skill supplies cooperative polling in generated agent instructions:
run start, work boundaries, before publishing and before exit. Interactive agents
route relevant user updates by default after checking status. No claim of native
chat interception or preemption of an in-flight tool call.

Test through the public CLI: enqueue/read/ack, concurrent senders, crash/redelivery,
generation isolation, stop/stale rejection, hostile text preservation, and a real
harmless cooperating child reading and acknowledging a message. Run existing
portable lifecycle tests, skill generation/validation and independent diff review.
Implement in upstream scaffold only; do not replace an active consumer's helper.
