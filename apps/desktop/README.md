# Clickaa desktop overlay

The Clicky-style interface: a frameless, always-on-top floating panel.

```bash
cd apps/desktop
npm install
CLICKAA_MODEL_KEY=sk-... CLICKAA_MODEL=gpt-4o-mini npm start
```

It spawns the panel server (apps/server) and loads the UI in a
transparent, draggable overlay window. External links open in your
system browser, never inside the overlay.
