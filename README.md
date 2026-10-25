# Clickaa

**One open-source AI agent that sees and acts across your PC, the web, and your phone.**

Clickaa is a clean-room agent built from scratch, combining the best
architectural patterns we extracted from reverse-engineering four
production agents — HeyClicky, OpenAI Dots, Grok Bot, and Meta's Muse
(see [`docs/CAPABILITY-MAP.md`](docs/CAPABILITY-MAP.md) for exactly what
each one contributed).

```
                     ┌───────────────────────────┐
                     │        CLICKAA CORE       │
                     │  model-agnostic executor  │
                     │  typed tool registry      │
                     │  HITL approval engine      │
                     │  proactive triggers        │
                     └────────────┬──────────────┘
                  one typed protocol (protocol/*.proto)
        ┌───────────────┬─────────┴────────┬───────────────┐
   ┌────┴─────┐   ┌─────┴─────┐   ┌──────────┴──┐   ┌────────┴───┐
   │ PC HOST  │   │ BROWSER   │   │ ANDROID     │   │ CONNECTOR  │
   │ capture, │   │ SANDBOX   │   │ RUNTIME    │   │ GATEWAY    │
   │ input,   │   │ (isolated │   │ (planned)   │   │ (planned)  │
   │ a11y     │   │  workers) │   │             │   │            │
   └──────────┘   └───────────┘   └─────────────┘   └────────────┘
```

## Design rules (hard-won from four RE studies)

1. **Typed, versioned commands** — every capability is a `CommandSpec` with
   `v1`-style versions. No free-form shell strings, ever.
2. **The core plans only against advertised capabilities** — runtimes
   publish a `CapabilitySnapshot`; unknown tools are rejected, not guessed.
3. **HITL gates are protocol objects** — sensitive actions (typing, clicking,
   sending) carry an approval mode (`AUTO` / `ASK_ONCE` / `ASK_ALWAYS` /
   `NEVER`), surface a redacted approval card, and record scoped grants.
4. **Browser and heavy work runs in disposable sandboxes** — never on your
   host; live-viewable and take-over-able (arriving with the worker).
5. **Model-agnostic** — any OpenAI-compatible endpoint; local models are a
   config change, not a rewrite.
6. **Web content is data, never instructions** — standard anti-injection
   posture baked into the system prompt and approval rules.

## Quickstart

```bash
git clone https://github.com/ranaalyan1/clickaa.git
cd clickaa
npm install
npm run build && npm test

# chat with your agent
CLICKAA_MODEL_BASE_URL=https://api.openai.com/v1 \
CLICKAA_MODEL_KEY=sk-... \
CLICKAA_MODEL=gpt-4o-mini \
npm run start -w cli
```

The CLI ships with two runtimes wired to the protocol today: the **PC host**
(capture/input/a11y contract; native backends landing next) and the
**browser sandbox** (worker contract). Approval prompts appear right in the
terminal — try asking the agent to "click something" and watch the gate work.

## Status

- [x] Protocol v1 (`protocol/clickaa/v1/*.proto` + TS mirror)
- [x] Core: executor loop, tool registry, HITL engine, model adapter
- [x] CLI with terminal approvals
- [x] Tests (6) — tool loop, gating, grant memory, redaction
- [ ] PC host native backends (Windows first)
- [ ] Browser sandbox worker (containerized, live view + takeover)
- [ ] Android runtime (command catalog app)
- [ ] Connector gateway (OAuth + API keys + scopes)

## Repository layout

```
protocol/     .proto source of truth (core and every runtime speak it)
core/         agent brain + HITL + runtime contracts (TypeScript)
cli/          terminal client
docs/         architecture + capability map from the RE studies
```

## License

MIT © 2026 Muhammad Alyan Ashraf
