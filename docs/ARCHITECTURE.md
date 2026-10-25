# Clickaa architecture

## Core (core/)

- `model.ts` — the only model boundary. OpenAI-compatible today; any
  OpenAI-compatible endpoint or local runtime works via config.
- `registry.ts` — runtimes register and publish a `CapabilitySnapshot`; the
  registry converts `CommandSpec`s into model tool schemas automatically, so
  adding a device never touches the planner.
- `hitl.ts` — the approval engine. Gates: `AUTO`, `ASK_ONCE` (remembers
  `always:` grants), `ASK_ALWAYS`, `NEVER`. Sensitive argument values are
  redacted before display.
- `executor.ts` — the loop: model reply → tool calls → HITL gate →
  runtime invoke → results back to the model, until a plain answer emerges.
  Step-limited; unknown tools are reported, not guessed.

## Runtimes

- `pc-host` — HeyClicky/Dots actuator contract: screenshot, list windows,
  click (coordinate or a11y index), type, press, launch, file read.
  Native backends (Windows first) land next; the stub implements the exact
  contract so the loop is testable end-to-end today.
- `sandbox-browser` — Grok Bot/Muse isolation contract: navigate, click,
  type, a11y state, search — all inside a disposable worker, with
  live view frames and takeover control defined in the protocol.

## Protocol (protocol/clickaa/v1)

Envelope + capability snapshot + command invocation + HITL + events.
The .proto files are the source of truth; TypeScript mirrors them until
codegen is wired in.

## Milestones

1. Protocol + core + CLI + tests (done)
2. PC host native backends — Windows (Win32 + UIA), then Linux (AT-SPI)
3. Sandbox browser worker (container + live view)
4. Android runtime (Muse-style command catalog app)
5. Connector gateway (OAuth flows, scopes)
6. Voice + multi-device sessions
