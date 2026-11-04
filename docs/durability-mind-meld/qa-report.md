# QA: executable understanding and architectural contribution

Date: 4 November 2026. Isolated synthetic data only.

## Exercised surfaces

- Started `scripts/queue-console.ts` with a temporary `QUEUE_FILE` on loopback.
  Browser probes added a model-led task and executable contract references,
  checked canonical guidance, edited to builder-led and a new contract, then
  reloaded and verified persisted API state. No page errors.
- Generated a real Mind Meld demo through Docker, verified the source snapshot,
  rendered its offline viewer and served only the generated artifact on loopback
  for this browser environment. Navigated tour steps, changed recorded runs,
  inspected source highlights and filtered state changes. Desktop and 390px
  screenshots were inspected; no page overflow or console errors.
- Bootstrapped an empty consumer from local managed source. Its own boundary
  policy survived; the installed indexer and both positive/negative import probes
  were reachable through shipped files.

## Found and fixed

| ID | Severity | Surface | Finding | Verification |
|---|---|---|---|---|
| QA-001 | medium | Queue editor | New architectural explanation squeezed narrow editor controls | Single-column labels/controls; repeated add/edit/reload probes and inspected screenshot |

Screenshots and probe scripts remain in session temporary storage rather than
tracked product files. No deployment or production endpoint was exercised.

QA found 1 issue, fixed 1 (verified 1), deferred 0, blocked 0.

## Limits

The reference proves its TypeScript example. Rust/Godot adapters and Voidhorizon
tours require that child repository; no such child implementation is claimed.
Offline bundles prove a consistent snapshot, not an authenticated production run
or current checkout freshness. Run `verify` against the desired checkout.
