# SYNDICATE.OS

A browser prototype of a command deck for AI operatives that run a digital business: marketing, lead gen, support and finance. Dark, sharp-edged, neon. Everything is simulated in the browser; there is no backend and nothing leaves the page.

This is a standalone app. It lives in the Business OS repository but shares no code, styles or dependencies with it.

## Run it

```bash
cd syndicate-os
npm install
npm run dev      # http://localhost:3000
```

`npm run build` makes the production build, `npm run start` serves it, `npm run lint` checks the code.

## What you can do

| Action | How |
| --- | --- |
| Deploy or recall an operative | The card's **Deploy / Recall** button, or keys `1`–`4` |
| Wake or stop the whole crew | **Deploy all** and **Kill switch** in the header |
| Tune an operative | **Configure**: power state, clock speed, verbosity, auto-requeue, inject a directive |
| Drive it from the keyboard | Press `/` and type. `Tab` completes, `↑` recalls history |
| Read back through the feed | Scroll up. It holds position and counts what you are missing |

### Commands

```
help                            list commands
status                          report on every operative
deploy <operative|all>          put an operative to work
recall <operative|all>          pull an operative back to idle
boot <operative|all>            bring an offline node up to idle
kill <operative|all>            take a node offline
assign <operative> <directive>  inject a directive and deploy
clock <operative> <1-5>         set clock speed
clear                           flush the feed
```

Operatives answer to a name, a fragment or a number: `deploy hype`, `kill 4`, `assign fixer Refund order 9912`.

## How it is built

Next.js (App Router, TypeScript), Tailwind CSS v4, Framer Motion, Lucide icons.

```
src/
  app/
    layout.tsx        fonts (Inter + JetBrains Mono via next/font), metadata
    page.tsx          the dashboard: header, stats, operative grid, feed
    globals.css       colour tokens, .crt-scanline overlay, glitch-anim keyframes
  components/
    AgentCard.tsx     one operative: status, CURRENT_DIRECTIVE, progress, Deploy / Configure
    TerminalLog.tsx   the feed: auto-scroll, filters, command line
    ConfigPanel.tsx   slide-out settings for one operative
    GlitchText.tsx    Framer Motion text tear, rolled fresh on every hover
    Header.tsx  StatStrip.tsx  Sparkline.tsx  BootOverlay.tsx
  lib/
    mock-data.ts      the four operatives, their playbooks and feed chatter
    engine.ts         the simulation: one pure reducer plus the command parser
    use-syndicate.ts  the hook that ticks the engine once a second
    types.ts          every type in one place
```

All behaviour lives in `engine.ts` as a pure reducer. The buttons, the hotkeys and the command line all dispatch the same actions, so they cannot drift apart. Clocks and random numbers are rolled in `use-syndicate.ts` and passed in, which keeps the reducer deterministic and the server-rendered page identical to the first browser render.

To change what the operatives do, edit `mock-data.ts`. To wire in real agents, replace the tick in `use-syndicate.ts` with events from your backend and keep the reducer.

## Design rules

- Void black `#050505`, off-white text `#EAEAEA`, three accents: pink `#FF0055`, acid green `#39FF14`, cyan `#00F0FF`.
- No rounded corners. Monospace for every label, status and number.
- Status is never colour alone: each state has its own label and marker shape.
- Motion is switched off for anyone who asks their system for reduced motion.
