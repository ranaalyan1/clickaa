# Sandbox workers (next milestone)

Browser and heavy tasks run in ephemeral, disposable workers — the Grok Bot
per-bot-container pattern, with Muse's live-view + takeover UX.

Planned worker:
- Container image with Playwright + Node
- Speaks the Clickaa protocol over WS
- Streams `viewport` / `a11y-diff` frames for live viewing
- Honors `takeover` / `cancel` control commands
- No host mounts, no host credentials, per-task lifetime
